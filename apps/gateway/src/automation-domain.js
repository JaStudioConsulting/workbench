import { WorkflowResumeSchema } from '@ja/shared-types';
import { renderResume } from './after-call.js';

export const INPUT_FIELDS = ['vacation','workStatus','interviewAvailability','startDate','reasonForLeaving','profileSummary','specialty','niche'];
const clean = value => typeof value === 'string' ? value.trim() : '';
const field = (value, source='candidate_record') => ({ value: clean(value) || null, evidence: clean(value) ? [{ source, quote: clean(value) }] : [] });

export function validateAutomationInputs(input, candidate) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Saved fields are required');
  if (input.fields != null && (typeof input.fields !== 'object' || Array.isArray(input.fields))) throw new Error('Template fields must be an object');
  const fields = {};
  for (const [key,value] of Object.entries(input.fields || {})) {
    if (!INPUT_FIELDS.includes(key) || typeof value !== 'string' || value.length > 5000) throw new Error('A template field is invalid or too long');
    fields[key] = value.trim();
  }
  let resume = null;
  if (input.resume != null) {
    resume = WorkflowResumeSchema.parse(input.resume);
    const normalized = value => String(value || '').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
    if (normalized(resume.name.value) !== normalized(candidate.candidate_name)) throw new Error('Resume name must match the selected candidate');
    if (!resume.experience.length && !resume.education.length && !resume.skills.length) throw new Error('Add structured resume sections before saving');
  }
  return { fields, resume };
}

export async function assembleTemplates(payload) {
  const candidate = payload.candidate;
  if (!candidate?.id || !clean(candidate.candidate_name)) throw new Error('Candidate identity is missing');
  const supplied = payload.fields || {};
  const fields = {
    name: field(candidate.candidate_name), title: field(candidate.current_title),
    compensationTarget: field(candidate.compensation_target), currentCompensation: field(candidate.current_compensation),
    location: field(candidate.location),
    ...Object.fromEntries(['vacation','workStatus','interviewAvailability','startDate','reasonForLeaving'].map(key=>[key,field(supplied[key],'candidate_record')])),
    profileSummary: clean(supplied.profileSummary) ? [{ text:clean(supplied.profileSummary),evidence:[{source:'candidate_record',quote:clean(supplied.profileSummary)}] }] : [],
  };
  const provenance = { mode:'template', templateVersion:payload.templateVersion, candidateId:candidate.id, jobId:payload.job?.job_id || null };
  const outputs = [{ type:'candidate_submission', content:{ status:'ready', fields, provenance } }];
  const bullets = [
    ['Industry', candidate.industry], ['Specialty',supplied.specialty], ['Niche',supplied.niche],
    ['Salary expectation',candidate.compensation_target], ['Current compensation',candidate.current_compensation],
    ['Compensation context',candidate.compensation_context], ['Notes',candidate.notes],
    ...(payload.meetings || []).filter(m=>clean(m.notes)).map(m=>['Call notes',m.notes]),
  ].filter(([,value])=>clean(value)).map(([label,value])=>`${label}: ${clean(value)}`);
  outputs.push({type:'loxo_update',content:{status:'ready',bullets:bullets.length?bullets:['Not recorded'],provenance}});
  const missing = Object.entries(fields).filter(([key,value])=>key==='profileSummary'?!value.length:!value.value).map(([key])=>key);
  if (payload.job?.job_id) {
    outputs.push({type:'presentation_email',content:{status:'ready',subject:`Candidate for ${clean(payload.job.job_title) || 'your role'}: ${candidate.candidate_name}`,
      body:`Please review ${candidate.candidate_name} for the ${clean(payload.job.job_title) || 'open'} position.${clean(candidate.current_title)?`\n\nCurrent title: ${candidate.current_title}`:''}${clean(candidate.location)?`\nLocation: ${candidate.location}`:''}${clean(candidate.compensation_target)?`\nCompensation target: ${candidate.compensation_target}`:''}\n\nPlease let me know if you would like to arrange an interview.`,provenance}});
  }
  let resumeStatus='needs_information';
  const resumeIdentityMatches = String(payload.resume?.name?.value || "").normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase() === String(candidate.candidate_name).normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
  if (payload.resume && !resumeIdentityMatches) missing.push("structuredResumeIdentity");
  if (payload.resume && resumeIdentityMatches) {
    const sections=WorkflowResumeSchema.parse(payload.resume);
    const text=renderResume(sections);
    resumeStatus='ready';
    outputs.push({type:'branded_resume',content:{status:'ready',sections,text,provenance,audit:{providedSources:['candidate_record','resume'],missingSources:[],conflicts:[],supportedClaims:[],finalizationBlocked:false,identityReviewRequired:false}}});
  } else missing.push('structuredResume');
  return { outputs, result:{needsInformation:missing.length>0,missing,resumeStatus,readyOutputs:outputs.map(x=>x.type)} };
}
