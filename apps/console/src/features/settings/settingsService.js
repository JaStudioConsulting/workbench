import { getWorkbenchAuthStatus } from "../../google-workspace-client.js";
import { supabase } from "../../supabase-client.js";
import { getMailStatus } from "../mail/mailClient.js";

export const RECRUITING_TEMPLATES = Object.freeze([
  "Branded resume",
  "Candidate submission",
  "Presentation email",
  "Loxo update bullets",
]);

export const CANADA_FILTER_KEY = "workbench.settings.canada-filter.v1";

export function readCanadaFilter(storage = globalThis.localStorage) {
  try { return storage?.getItem(CANADA_FILTER_KEY) !== "false"; }
  catch { return true; }
}

export function saveCanadaFilter(enabled, storage = globalThis.localStorage) {
  try { storage?.setItem(CANADA_FILTER_KEY, enabled ? "true" : "false"); }
  catch { /* Browser storage is optional. */ }
  return Boolean(enabled);
}

export async function loadSettingsStatus({ client = supabase, request = globalThis.fetch } = {}) {
  const [sessionResult, authStatus, mail] = await Promise.all([
    client.auth.getSession().catch(() => ({ data: { session: null }, error: new Error("unavailable") })),
    getWorkbenchAuthStatus({ fetchImpl: request }).catch(() => ({ googleSignIn: "unknown", localDataSession: "unknown" })),
    getMailStatus({ request }),
  ]);
  return {
    supabase: { connected: Boolean(sessionResult?.data?.session), error: Boolean(sessionResult?.error) },
    google: { ...mail, signIn: authStatus.googleSignIn, localDataSession: authStatus.localDataSession },
    loxo: { queued: true, label: "Queued mode: changes wait for you or $recruiter" },
  };
}
