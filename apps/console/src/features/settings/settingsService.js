import { supabase } from "../../supabase-client.js";

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

export async function loadSettingsStatus({ client = supabase } = {}) {
  const sessionResult = await client.auth.getSession().catch(() => ({ data: { session: null }, error: new Error("unavailable") }));
  return {
    supabase: { connected: Boolean(sessionResult?.data?.session), error: Boolean(sessionResult?.error) },
    loxo: { queued: true, label: "Queued mode: changes wait for you or $recruiter" },
  };
}
