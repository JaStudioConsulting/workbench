import { lstat, readFile } from "node:fs/promises";
import { SupabaseUserIdSchema, errorEnvelope } from "@ja/shared-types";

const DEFAULT_SUPABASE_URL = "https://abnfffkmxqixrwzackjf.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_0Y8w6xekEjAr3vHZUMr1hA_-fcvvtq0";

export function isLoopbackAddress(value) {
  const address = typeof value === "string" ? value.trim().split("%")[0].toLowerCase() : "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function loadMachineSecret(path) {
  if (typeof path !== "string" || !path) throw new Error("secret unavailable");
  const metadata = await lstat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error("secret permissions invalid");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) throw new Error("secret owner invalid");
  const value = (await readFile(path, "utf8")).trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("secret format invalid");
  return value;
}

function localSessionConfig(env) {
  const port = Number(env.PORT || 8092);
  const host = env.HOST || "127.0.0.1";
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_PUBLISHABLE_KEY;
  const origins = Number.isInteger(port) && port > 0 && port <= 65535
    ? [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
    : [];
  const ownerId = SupabaseUserIdSchema.safeParse(env.WORKBENCH_LOCAL_SESSION_OWNER_ID);
  const enabled = env.WORKBENCH_LOCAL_SESSION_ENABLED === "1";
  return {
    enabled,
    supabaseUrl: /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl) ? supabaseUrl : "",
    publishableKey: typeof publishableKey === "string" && publishableKey.startsWith("sb_publishable_") ? publishableKey : "",
    origins,
    loopbackBinding: ["127.0.0.1", "localhost", "::1"].includes(host),
    ownerId: ownerId.success ? ownerId.data.toLowerCase() : "",
    secretPath: env.WORKBENCH_LOCAL_SESSION_SECRET_FILE || "",
  };
}

export function getLocalSessionAvailability(env = process.env) {
  const config = localSessionConfig(env);
  const configured = Boolean(
    config.enabled
    && config.supabaseUrl
    && config.publishableKey
    && config.ownerId
    && config.secretPath
    && config.origins.length
    && config.loopbackBinding
  );
  return configured ? "configured" : "unavailable";
}

export function isTrustedLocalSessionRequest(req, { origins }) {
  if (!isLoopbackAddress(req.socket?.remoteAddress) || !isLoopbackAddress(req.socket?.localAddress)) return false;
  const forbiddenHeaders = [
    "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
    "forwarded", "via", "x-real-ip", "tailscale-user-login", "tailscale-user-name",
    "tailscale-user-profile-pic", "tailscale-headers-info",
  ];
  if (forbiddenHeaders.some((name) => Object.hasOwn(req.headers || {}, name))) return false;
  const fetchSite = req.headers?.["sec-fetch-site"];
  if (fetchSite !== undefined && fetchSite !== "same-origin") return false;
  const origin = typeof req.get === "function" ? req.get("origin") || "" : req.headers?.origin || "";
  const host = typeof req.get === "function" ? req.get("host") || "" : req.headers?.host || "";
  let parsedOrigin;
  try { parsedOrigin = new URL(origin); } catch { parsedOrigin = null; }
  if (!parsedOrigin || !origins?.includes(origin) || host !== parsedOrigin.host) return false;
  return true;
}

export function registerLocalSessionRoute(app, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  app.post("/api/auth/local-session", async (req, res) => {
    res.set({ "Cache-Control": "no-store, private", Pragma: "no-cache", Vary: "Origin" });
    const config = localSessionConfig(env);
    if (!config.enabled) return res.status(404).json(errorEnvelope("NOT_FOUND", "Route not found"));
    if (!config.supabaseUrl || !config.publishableKey || !config.ownerId || !config.secretPath || !config.origins.length || !config.loopbackBinding) {
      return res.status(503).json(errorEnvelope("LOCAL_SESSION_UNAVAILABLE", "Private workspace access is not configured"));
    }

    if (!isTrustedLocalSessionRequest(req, config)) {
      return res.status(403).json(errorEnvelope("LOCAL_SESSION_FORBIDDEN", "Private workspace access is not available"));
    }

    try {
      const machineSecret = await loadMachineSecret(config.secretPath);
      const response = await fetchImpl(`${config.supabaseUrl}/functions/v1/workbench-local-session`, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: {
          apikey: config.publishableKey,
          Authorization: `Bearer ${config.publishableKey}`,
          "content-type": "application/json",
          "x-workbench-session-token": machineSecret,
        },
      });
      const payload = await response.json().catch(() => null);
      const session = payload?.session;
      if (!response.ok || session?.user?.id?.toLowerCase() !== config.ownerId || !session?.access_token || !session?.refresh_token) {
        return res.status(503).json(errorEnvelope("LOCAL_SESSION_UNAVAILABLE", "Private workspace access could not be opened. Retry shortly."));
      }
      return res.status(200).json({ session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        expires_at: session.expires_at,
        token_type: session.token_type,
      } });
    } catch {
      return res.status(503).json(errorEnvelope("LOCAL_SESSION_UNAVAILABLE", "Private workspace access could not be opened. Retry shortly."));
    }
  });
}
