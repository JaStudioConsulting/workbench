// Reasons Ja can pick when passing on a candidate (A1).
export const REJECT_REASONS = [
  "Not interested",
  "Comp / location mismatch",
  "Already engaged by another recruiter",
  "Not qualified on paper",
  "Placed elsewhere",
];

export function buildRejectNote(reason) {
  return `Rejected: ${String(reason || "").trim()}`;
}

// Record the pass decision, then queue the Loxo note. Both calls are injected so this stays testable.
export async function rejectCandidate({ jobId, personId, reason, recordDecision, logActivity }) {
  if (!REJECT_REASONS.includes(reason)) {
    return { ok: false, error: "Pick a reason first." };
  }
  const decision = await recordDecision(jobId, personId, "pass");
  if (decision?.ok === false) return decision;
  const undo = { decision: decision?.undo || null, idempotencyKey: null };
  try {
    const logged = await logActivity(jobId, personId, {
      type: "*Note",
      note: buildRejectNote(reason),
      targetStage: "Rejected",
    });
    if (logged?.ok === false) throw new Error(logged.error || "Loxo note was not queued");
    undo.idempotencyKey = logged?.activity?.idempotencyKey || null;
  } catch (error) {
    return {
      ok: false,
      decisionSaved: true,
      undo,
      error: `Passed, but the Loxo note was not queued: ${error.message}`,
    };
  }
  return { ok: true, status: "Waiting for Loxo", undo };
}
