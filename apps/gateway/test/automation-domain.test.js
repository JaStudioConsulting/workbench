import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleTemplates, validateAutomationInputs } from '../src/automation-domain.js';

const candidate = {
  id: 'manual:11111111-1111-4111-8111-111111111111', candidate_name: 'Candidate Example',
  current_title: 'Maintenance Technician', location: 'Toronto', industry: 'Manufacturing',
  compensation_target: '$82,000', current_compensation: '$77,000', notes: 'Candidate requested an afternoon call.',
};
const sourceField = (value) => ({ value, evidence: value ? [{ source: 'resume', quote: value }] : [] });
const claim = (text) => ({ text, evidence: [{ source: 'resume', quote: text }] });
function structuredResume(name = candidate.candidate_name) {
  return {
    name: sourceField(name), title: sourceField(candidate.current_title), summary: [], skills: [], experience: [],
    education: [claim('Electrical Engineering Technician Diploma')], certifications: [], additionalInformation: [],
  };
}
const output = (result, type) => result.outputs.find((item) => item.type === type)?.content;

test('template assembly preserves explicit fields and never turns JD requirements into candidate claims', async () => {
  const fields = { vacation: 'One week in December', workStatus: 'Open work permit', interviewAvailability: 'Tuesday after 3 pm', startDate: 'Two weeks after acceptance', reasonForLeaving: 'Plant closure', profileSummary: 'Maintains packaging equipment.', specialty: 'Maintenance', niche: 'Packaging' };
  const result = await assembleTemplates({
    templateVersion: 'no-ai-v1', candidate, fields,
    job: { job_id: 42, job_title: 'Maintenance Supervisor', job_description: 'Must have a Red Seal and manage 20 employees.' },
    meetings: [{ notes: 'Prefers a day shift.', transcript: 'Employer mentions a $120,000 budget.' }],
  });
  const submission = output(result, 'candidate_submission');
  assert.equal(submission.fields.title.value, 'Maintenance Technician');
  assert.equal(submission.fields.compensationTarget.value, '$82,000');
  assert.equal(submission.fields.workStatus.value, fields.workStatus);
  assert.deepEqual(submission.fields.profileSummary, [{ text: fields.profileSummary, evidence: [{ source: 'candidate_record', quote: fields.profileSummary }] }]);
  assert.deepEqual(submission.fields.compensationTarget.evidence, [{ source: 'candidate_record', quote: '$82,000' }]);
  const rendered = JSON.stringify(result.outputs);
  assert.doesNotMatch(rendered, /Red Seal|20 employees|120,000/);
  assert.ok(output(result, 'loxo_update').bullets.includes('Call notes: Prefers a day shift.'));
  assert.ok(output(result, 'loxo_update').bullets.includes('Specialty: Maintenance'));
  assert.equal(submission.provenance.candidateId, candidate.id);
  assert.equal(submission.provenance.jobId, 42);
});

test('missing source fields yield usable partial drafts and explicit information gaps', async () => {
  const result = await assembleTemplates({ candidate: { id: candidate.id, candidate_name: candidate.candidate_name }, fields: {}, meetings: [] });
  const submission = output(result, 'candidate_submission');
  assert.equal(submission.status, 'ready');
  assert.deepEqual(submission.fields.currentCompensation, { value: null, evidence: [] });
  assert.deepEqual(submission.fields.profileSummary, []);
  assert.deepEqual(output(result, 'loxo_update').bullets, ['Not recorded']);
  assert.equal(result.result.needsInformation, true);
  assert.ok(result.result.missing.includes('structuredResume'));
  assert.ok(result.result.missing.includes('interviewAvailability'));
  assert.equal(output(result, 'branded_resume'), undefined);
});

test('presentation email requires an explicit linked job rather than role context or a JD', async () => {
  const payload = { candidate: { ...candidate, role_context: 'Job 42: Maintenance Supervisor' }, fields: {}, jobDescription: 'Maintenance Supervisor opening' };
  const unlinked = await assembleTemplates(payload);
  assert.equal(output(unlinked, 'presentation_email'), undefined);
  const linked = await assembleTemplates({ ...payload, job: { job_id: 42, job_title: 'Maintenance Supervisor' } });
  assert.equal(output(linked, 'presentation_email').subject, 'Candidate for Maintenance Supervisor: Candidate Example');
  assert.match(output(linked, 'presentation_email').body, /Current title: Maintenance Technician/);
  assert.doesNotMatch(output(linked, 'presentation_email').body, /already submitted|sent|attached/i);
});

test('manual structured resume intake rejects identity mismatch and malformed fields', () => {
  const saved = validateAutomationInputs({ fields: { vacation: '  December 20–27  ' }, resume: structuredResume('  CANDIDATE  EXAMPLE ') }, candidate);
  assert.equal(saved.fields.vacation, 'December 20–27');
  assert.equal(saved.resume.education[0].text, 'Electrical Engineering Technician Diploma');
  assert.throws(() => validateAutomationInputs({ resume: structuredResume('Different Candidate') }, candidate), /name must match/);
  assert.throws(() => validateAutomationInputs({ fields: { inventedCredential: 'Red Seal' } }, candidate), /invalid|unsupported/);
  assert.throws(() => validateAutomationInputs({ fields: { profileSummary: 'x'.repeat(5001) } }, candidate), /invalid|too long/);
  assert.throws(() => validateAutomationInputs({ fields: [] }, candidate), /fields|object|invalid/i);
  assert.throws(() => validateAutomationInputs({ resume: { ...structuredResume(), education: [] } }, candidate), /structured resume sections/);
});

test('PDF failure preserves structured resume, text, and other drafts without a model call', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('No model or send request is allowed'); };
  try {
    const resume = structuredResume();
    const result = await assembleTemplates({ candidate, fields: {}, resume }, { renderer: async () => { throw new Error('Renderer offline'); } });
    const branded = output(result, 'branded_resume');
    assert.equal(branded.status, 'ready');
    assert.equal(branded.pdf, null);
    assert.equal(branded.exportStatus, 'not_rendered');
    assert.deepEqual(branded.sections, resume);
    assert.match(branded.text, /Electrical Engineering Technician Diploma/);
    assert.equal(result.result.resumeStatus, 'failed');
    assert.ok(output(result, 'candidate_submission'));
    assert.ok(output(result, 'loxo_update'));
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('candidate name changes block stale resume output while preserving independent drafts', async () => {
  let renderCalls = 0;
  const result = await assembleTemplates({ candidate: { ...candidate, candidate_name: 'Corrected Candidate' }, fields: {}, resume: structuredResume() }, {
    renderer: async () => { renderCalls += 1; throw new Error('Mismatched resume must not render'); },
  });
  assert.equal(renderCalls, 0);
  assert.equal(output(result, 'branded_resume'), undefined);
  assert.equal(output(result, 'candidate_submission').fields.name.value, 'Corrected Candidate');
  assert.ok(output(result, 'loxo_update'));
  assert.equal(result.result.resumeStatus, 'needs_information');
  assert.ok(result.result.missing.includes('structuredResumeIdentity'));
});

test('valid resume rendering preserves the supplied sections and returned PDF', async () => {
  const resume = structuredResume();
  const pdf = { fileName: 'Candidate.pdf', mimeType: 'application/pdf', base64: 'JVBERi0xLjc=', sizeBytes: 8 };
  const result = await assembleTemplates({ candidate, fields: {}, resume }, { renderer: async (sections) => { assert.deepEqual(sections, resume); return pdf; } });
  assert.deepEqual(output(result, 'branded_resume').pdf, pdf);
  assert.equal(output(result, 'branded_resume').exportStatus, 'ready');
  assert.equal(result.result.resumeStatus, 'ready');
});
