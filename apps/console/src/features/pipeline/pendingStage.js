import { LOXO_PIPELINE_STAGES } from "../candidate-review/constants.js";

// A queued stage move is persisted as an activity with status
// "Waiting for Loxo". Resolve the newest supported target so the pipeline
// shows the same pending state after a reload.
export function resolvePendingStage(candidate = {}, sessionPending = {}) {
  const persisted = (candidate.activityTrail || []).find(
    (item) => item.status === "Waiting for Loxo" && LOXO_PIPELINE_STAGES.includes(item.targetStage)
  );
  return sessionPending[candidate.id] || persisted?.targetStage || null;
}
