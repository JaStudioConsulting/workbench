import { gatewayBaseURL } from "../../auth-client.js";

async function post(path, body, { fetchImpl = globalThis.fetch, baseURL = gatewayBaseURL } = {}) {
  try {
    const response = await fetchImpl(new URL(path, baseURL), {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const unavailable = response.status === 503 || payload?.error?.code === "AI_NOT_CONFIGURED";
      return {
        ok: false,
        available: !unavailable,
        result: null,
        error: payload?.error?.message || (unavailable ? "AI check not set up" : "AI request failed"),
      };
    }
    return { ok: true, available: true, result: payload, error: null };
  } catch {
    return { ok: false, available: false, result: null, error: "AI service is unavailable" };
  }
}

export function evaluateFit(job, candidate, options) {
  return post("/api/fit/evaluate", { job, candidate }, options);
}

export function personalizeOutreach({ job, candidate, template, body }, options) {
  return post("/api/outreach/personalize", { job, candidate, template, body }, options);
}

