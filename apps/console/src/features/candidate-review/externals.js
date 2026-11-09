// Every import from another builder's module lives here, so one file changes if a contract moves.
export { canadianCity, isInCanada, province } from "../pipeline/location.js";
export {
  FIT_LEVELS,
  ROLE_LEVELS,
  compareRoleLevels,
  findBestJobMatches,
  inferRoleLevel,
  isOpenJob,
  matchCandidatesForJob,
  matchCandidatesToOpenJobs,
  matchCandidateToJob,
  matchCandidateToOpenJobs,
  matchOpenJobs,
  scoreFit,
} from "../pipeline/fitScore.js";
export { personalizeOutreach } from "../pipeline/aiClient.js";
export { default as FitBadge } from "../pipeline/FitBadge.jsx";
export { getResumeSource } from "./brandResume.js";
export { logOutreach, saveGmailDraft, getMailStatus } from "../mail/mailClient.js";
export { getProfile } from "../profile/profileService.js";
