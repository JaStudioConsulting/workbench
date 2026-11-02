// Exact pipeline stages from docs/loxo/true-actions.md in order
export const LOXO_PIPELINE_STAGES = [
  "Applied",
  "Longlist",
  "Shortlist",
  "Outbound",
  "Follow Up",
  "Screening",
  "Internal Submission",
  "Submitted",
  "Interview #1",
  "Interview #2+",
  "Offer",
  "Rejected",
  "Hired",
];

// Stage index mapping for sorting candidates by pipeline stage order
export const PIPELINE_STAGE_ORDER = Object.freeze(
  LOXO_PIPELINE_STAGES.reduce((acc, stage, index) => {
    acc[stage] = index;
    return acc;
  }, {})
);

// Exact loggable activity types and trigger stages from docs/loxo/true-actions.md
// Note: "Update" is unresolved in true-actions.md and left out per specifications.
export const LOXO_LOGGABLE_ACTIVITIES = [
  {
    name: "Phone Call",
    trigger: "Outbound",
    activityId: 1937212,
  },
  {
    name: "Call - No Answer / Left VoiceMail",
    trigger: "Outbound",
    activityId: 1937210,
  },
  {
    name: "Internal Submission",
    trigger: "Internal Submission",
    activityId: 1946548,
  },
  {
    name: "Submitted",
    trigger: "Submitted",
    activityId: 1937220,
  },
  {
    name: "1st Client Interview",
    trigger: "Interview #1",
    activityId: 1937222,
  },
  {
    name: "2nd+ Client Interview",
    trigger: "Interview #2+",
    activityId: 1937223,
  },
  {
    name: "Sent InMail",
    trigger: "Outbound",
    activityId: 1937215,
  },
  {
    name: "LinkedIn Connection Request Sent",
    trigger: "No automatic stage change",
    activityId: 2313276,
  },
  {
    name: "*Note",
    trigger: "No automatic stage change",
    activityId: 1937202,
  },
];

// Resume indicator states
export const RESUME_INDICATOR_STATES = {
  resume_on_file: {
    key: "resume_on_file",
    label: "Resume on file",
    symbol: "●",
    tone: "ink",
  },
  profile_only: {
    key: "profile_only",
    label: "Profile only",
    symbol: "◐",
    tone: "muted",
  },
  no_resume_data: {
    key: "no_resume_data",
    label: "No resume data",
    symbol: "○",
    tone: "amber",
  },
};

