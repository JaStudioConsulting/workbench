// Synthetic data for Today UI — 8 required scenarios
// All people, companies, and documents are entirely fictional.

const TODAY = new Date();
const fmt = (h, m) => {
  const d = new Date(TODAY);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

export const STAGES = ['New Intake', 'Ready', 'Running', 'Needs Info', 'Review', 'Approved', 'Completed'];

export const ACTIONS = [
  { id: 'vet', label: 'Vet Candidate', requires: ['resume', 'jobDescription'] },
  { id: 'brand-resume', label: 'Brand Resume', requires: ['resume', 'candidateFacts'] },
  { id: 'full-package', label: 'Prepare Full Package', requires: ['resume', 'jobDescription', 'transcript'] },
  { id: 'match-job', label: 'Match to Job', requires: ['candidateProfile', 'jobDescription'] },
  { id: 'ref-check', label: 'Build Reference Check', requires: ['referenceMaterial', 'referenceTemplate'] },
  { id: 'source-similar', label: 'Source Similar Candidates', requires: ['candidateProfile'] },
];

// Scenario 1: Complete after-call case — ready for Full Package
// Scenario 2: Missing JD
// Scenario 3: Missing transcript + call notes
// Scenario 4: Conflicting/unverified info
// Scenario 8: Completed workflow with drafts in review queue
export const cases = [
  {
    id: 'case-001',
    candidate: { name: 'Elara Voss', title: 'Senior Product Manager', location: 'Austin, TX' },
    job: { title: 'VP of Product', client: 'Meridian Health Systems', id: 'job-001' },
    stage: 'Ready',
    workflow: 'Full Package',
    sources: { resume: true, jobDescription: true, transcript: true, callNotes: true, candidateFacts: true, candidateProfile: true },
    blocker: null,
    nextAction: 'Prepare Full Package',
    dueTime: fmt(14, 0),
    draftCount: 0,
    decision: null,
    tags: ['exec-search', 'healthcare'],
  },
  {
    id: 'case-002',
    candidate: { name: 'Marcus Chen', title: 'Staff Software Engineer', location: 'Seattle, WA' },
    job: { title: 'Engineering Director', client: 'Orion Fintech', id: 'job-002' },
    stage: 'Needs Info',
    workflow: 'Vet Candidate',
    sources: { resume: true, jobDescription: false, transcript: true, callNotes: true, candidateFacts: true, candidateProfile: true },
    blocker: 'Missing job description from client',
    nextAction: 'Request JD from Orion Fintech',
    dueTime: fmt(11, 0),
    draftCount: 0,
    decision: null,
    tags: ['fintech', 'engineering'],
  },
  {
    id: 'case-003',
    candidate: { name: 'Priya Sharma', title: 'Director of Operations', location: 'Chicago, IL' },
    job: { title: 'COO', client: 'Apex Logistics Group', id: 'job-003' },
    stage: 'Needs Info',
    workflow: 'Brand Resume',
    sources: { resume: true, jobDescription: true, transcript: false, callNotes: false, candidateFacts: true, candidateProfile: true },
    blocker: 'Missing transcript and call notes',
    nextAction: 'Schedule follow-up call',
    dueTime: fmt(16, 30),
    draftCount: 0,
    decision: null,
    tags: ['logistics', 'c-suite'],
  },
  {
    id: 'case-004',
    candidate: { name: 'Jordan Blake', title: 'Sales Director', location: 'Denver, CO' },
    job: { title: 'Regional VP Sales', client: 'Summit Cloud Solutions', id: 'job-004' },
    stage: 'Needs Info',
    workflow: 'Vet Candidate',
    sources: { resume: true, jobDescription: true, transcript: true, callNotes: true, candidateFacts: false, candidateProfile: true },
    blocker: 'Employment dates conflict between resume and LinkedIn — unverified',
    nextAction: 'Verify employment history',
    dueTime: fmt(10, 0),
    draftCount: 0,
    decision: null,
    tags: ['saas', 'sales'],
  },
  {
    id: 'case-005',
    candidate: { name: 'Samira Osei', title: 'Head of Talent Acquisition', location: 'Atlanta, GA' },
    job: { title: 'VP People & Culture', client: 'Brightpath Education', id: 'job-005' },
    stage: 'Review',
    workflow: 'Full Package',
    sources: { resume: true, jobDescription: true, transcript: true, callNotes: true, candidateFacts: true, candidateProfile: true },
    blocker: null,
    nextAction: 'Review branded resume and submission drafts',
    dueTime: fmt(9, 0),
    draftCount: 3,
    decision: 'Needs Review',
    tags: ['education', 'hr-leadership'],
  },
];

// Scenario 6: Interview/call on today's calendar
export const calendarItems = [
  { id: 'cal-001', type: 'candidate-call', title: 'Intro call — Elara Voss', time: fmt(10, 30), duration: 45, caseId: 'case-001', jobTitle: 'VP of Product' },
  { id: 'cal-002', type: 'client-call', title: 'JD review — Orion Fintech', time: fmt(13, 0), duration: 30, caseId: 'case-002', client: 'Orion Fintech' },
  { id: 'cal-003', type: 'interview', title: 'Panel interview — Samira Osei', time: fmt(15, 0), duration: 60, caseId: 'case-005', jobTitle: 'VP People & Culture' },
  { id: 'cal-004', type: 'follow-up', title: 'Follow-up — Priya Sharma', time: fmt(17, 0), duration: 15, caseId: 'case-003', note: 'Confirm availability and notice period' },
];

// Scenario 5: Sourcing run with verified, possible, rejected, duplicate results
export const sourcingRuns = [
  {
    id: 'src-001',
    job: { title: 'Engineering Director', client: 'Orion Fintech', id: 'job-002' },
    criteria: 'Staff+ engineers, fintech, distributed systems, West Coast',
    status: 'Complete',
    found: 24,
    verified: 8,
    possible: 6,
    rejected: 7,
    duplicates: 3,
    blockedReason: null,
    nextAction: 'Review 8 verified candidates',
  },
  {
    id: 'src-002',
    job: { title: 'COO', client: 'Apex Logistics Group', id: 'job-003' },
    criteria: 'Operations leadership, logistics/supply chain, 10+ yrs',
    status: 'Running',
    found: 11,
    verified: 3,
    possible: 4,
    rejected: 2,
    duplicates: 2,
    blockedReason: null,
    nextAction: 'Awaiting additional results',
  },
];

// Scenario 8: Review queue — drafts from completed workflow
export const reviewItems = [
  { id: 'rev-001', caseId: 'case-005', candidate: 'Samira Osei', type: 'Branded Resume', status: 'Needs Review', createdAt: fmt(8, 15) },
  { id: 'rev-002', caseId: 'case-005', candidate: 'Samira Osei', type: 'Candidate Submission', status: 'Needs Review', createdAt: fmt(8, 20) },
  { id: 'rev-003', caseId: 'case-005', candidate: 'Samira Osei', type: 'Presentation Email', status: 'Changes Requested', createdAt: fmt(8, 25) },
  { id: 'rev-004', caseId: 'case-001', candidate: 'Elara Voss', type: 'Loxo Update Bullets', status: 'Approved', createdAt: fmt(7, 45) },
];

// Scenario 7: Failed/disconnected automation
export const integrations = [
  { id: 'int-recruiter', name: 'Recruiter Workflow', status: 'Connected', note: null },
  { id: 'int-calendar', name: 'Calendar', status: 'Connected', note: null },
  { id: 'int-drive', name: 'Drive', status: 'Read Only', note: 'Write access not configured' },
  { id: 'int-gmail', name: 'Gmail Drafts', status: 'Draft Only', note: 'Send disabled — draft creation only' },
  { id: 'int-loxo', name: 'Loxo', status: 'Error', note: 'Authentication expired — reconnect required' },
  { id: 'int-sourcing', name: 'Sourcing Provider', status: 'Connected', note: null },
];

export const recentActivity = [
  { id: 'act-001', type: 'workflow-started', description: 'Full Package started for Samira Osei', timestamp: fmt(8, 10), caseId: 'case-005' },
  { id: 'act-002', type: 'draft-generated', description: 'Branded resume generated for Samira Osei', timestamp: fmt(8, 15), caseId: 'case-005' },
  { id: 'act-003', type: 'draft-generated', description: 'Submission draft generated for Samira Osei', timestamp: fmt(8, 20), caseId: 'case-005' },
  { id: 'act-004', type: 'changes-requested', description: 'Changes requested on presentation email — Samira Osei', timestamp: fmt(8, 30), caseId: 'case-005' },
  { id: 'act-005', type: 'draft-reviewed', description: 'Loxo bullets approved for Elara Voss', timestamp: fmt(7, 50), caseId: 'case-001' },
  { id: 'act-006', type: 'sourcing-complete', description: 'Sourcing run complete — Engineering Director, Orion Fintech', timestamp: fmt(7, 30), caseId: null },
  { id: 'act-007', type: 'workflow-failed', description: 'Loxo integration disconnected — update failed', timestamp: fmt(6, 45), caseId: null },
  { id: 'act-008', type: 'info-requested', description: 'JD requested from Orion Fintech for Marcus Chen', timestamp: fmt(9, 0), caseId: 'case-002' },
];

// Attention items — derived from cases + integrations
export const attentionItems = [
  { id: 'att-001', type: 'missing-jd', candidate: 'Marcus Chen', job: 'Engineering Director', client: 'Orion Fintech', reason: 'Missing job description', urgency: 'high', dueTime: fmt(11, 0), nextAction: 'Request JD from client', caseId: 'case-002' },
  { id: 'att-002', type: 'missing-transcript', candidate: 'Priya Sharma', job: 'COO', client: 'Apex Logistics Group', reason: 'Missing transcript and call notes', urgency: 'medium', dueTime: fmt(16, 30), nextAction: 'Schedule follow-up call', caseId: 'case-003' },
  { id: 'att-003', type: 'unverified-facts', candidate: 'Jordan Blake', job: 'Regional VP Sales', client: 'Summit Cloud Solutions', reason: 'Employment dates conflict — unverified', urgency: 'high', dueTime: fmt(10, 0), nextAction: 'Verify employment history', caseId: 'case-004' },
  { id: 'att-004', type: 'draft-review', candidate: 'Samira Osei', job: 'VP People & Culture', client: 'Brightpath Education', reason: '3 drafts awaiting review', urgency: 'medium', dueTime: fmt(9, 0), nextAction: 'Review branded resume', caseId: 'case-005' },
  { id: 'att-005', type: 'integration-error', candidate: null, job: null, client: null, reason: 'Loxo authentication expired', urgency: 'high', dueTime: null, nextAction: 'Reconnect Loxo integration', caseId: null },
];
