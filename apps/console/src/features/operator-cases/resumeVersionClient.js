import { gatewayBaseURL } from "../../auth-client.js";
import { supabase } from "../../supabase-client.js";

export async function renderBrandedResumeVersion(caseId, { artifactId, expectedUpdatedAt, sections }, {
  fetchImpl = globalThis.fetch,
  baseURL = gatewayBaseURL,
  getAccessToken = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data?.session?.access_token || "";
  },
} = {}) {
  let token;
  try { token = await getAccessToken(); }
  catch { throw new Error("Sign in again before saving resume edits."); }
  if (!token) throw new Error("Sign in again before saving resume edits.");
  let response;
  try {
    response = await fetchImpl(new URL(`/api/operator-cases/${encodeURIComponent(caseId)}/branded-resume/versions`, baseURL), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ artifactId, expectedUpdatedAt, sections }),
    });
  } catch {
    throw new Error("Workbench couldn’t be reached. Your saved resume version is unchanged. Try again.");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const messages = {
      UNAUTHORIZED: "Your sign-in expired. Sign in again, then retry.",
      FORBIDDEN: "This account cannot edit this resume.",
      ARTIFACT_VERSION_CONFLICT: "A newer resume version exists. Reload the case before editing.",
      STALE_ARTIFACT: "A newer resume version exists. Reload the case before editing.",
      INVALID_EVIDENCE: "Use only source quotes already saved with this resume, then try again.",
      STRUCTURED_RESUME_UNAVAILABLE: "This older resume has no editable source sections. Reopen after-call preparation to create a new version.",
      RESUME_RENDER_FAILED: "A new resume PDF could not be rendered. The saved version is unchanged.",
    };
    throw new Error(messages[payload?.error?.code] || payload?.error?.message || "Resume edits could not be saved. The saved version is unchanged.");
  }
  if (!payload?.artifact?.id || payload.artifact.artifact_type !== "branded_resume" || !payload.artifact.content?.pdf) {
    throw new Error("The resume service returned an incomplete version. The saved version is unchanged.");
  }
  return payload.artifact;
}
