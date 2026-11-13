import { gatewayBaseURL } from "../../auth-client.js";
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

async function readAiStatus(request) {
  try {
    const response = await request(new URL("/api/ai/status", gatewayBaseURL), { credentials: "include", headers: { accept: "application/json" } });
    if (!response.ok) return { available: null, label: "AI check not set up" };
    const payload = await response.json();
    return { available: Boolean(payload.available || payload.configured), label: payload.available || payload.configured ? "Fit check ready" : "Fit check not set up" };
  } catch {
    return { available: null, label: "AI check not set up" };
  }
}

export async function loadSettingsStatus({ client = supabase, request = globalThis.fetch, meetingsStatusLoader } = {}) {
  const [sessionResult, mail, ai, meetings] = await Promise.all([
    client.auth.getSession().catch(() => ({ data: { session: null }, error: new Error("unavailable") })),
    getMailStatus({ request }),
    readAiStatus(request),
    typeof meetingsStatusLoader === "function"
      ? meetingsStatusLoader().catch(() => ({ available: null }))
      : Promise.resolve({ available: false }),
  ]);
  return {
    supabase: { connected: Boolean(sessionResult?.data?.session), error: Boolean(sessionResult?.error) },
    google: mail,
    ai,
    loxo: { queued: true, label: "Queued mode: changes wait for you or $recruiter" },
    meetings: {
      available: meetings?.available == null ? null : Boolean(meetings.available),
      label: meetings?.available
        ? "M1 transcription available; recording uses this device's microphone"
        : "Meetings transcription helper unavailable",
    },
  };
}
