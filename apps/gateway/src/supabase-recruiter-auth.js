import { SupabaseUserIdSchema, errorEnvelope } from "@ja/shared-types";
import {
  extractBearerToken,
  isPrivilegedSupabaseKey,
  resolveCandidateSupabaseConfig,
} from "./candidate-routes.js";

function respond(res, code, message, status) {
  res.set("Cache-Control", "private, no-store");
  return res.status(status).json(errorEnvelope(code, message));
}

export function createSupabaseRecruiterAccess({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = resolveCandidateSupabaseConfig(env);
  return async (req, res, next) => {
    if (!config.enabled) return respond(res, "SUPABASE_UNAVAILABLE", config.reason || "Supabase authentication is unavailable", 503);
    const accessToken = extractBearerToken(req.get("authorization"));
    if (!accessToken) return respond(res, "UNAUTHORIZED", "A valid Supabase bearer token is required", 401);
    if (isPrivilegedSupabaseKey(accessToken)) return respond(res, "FORBIDDEN", "Service role credentials are not allowed", 403);

    const headers = {
      apikey: config.publishableKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };
    try {
      const userResponse = await fetchImpl(`${config.supabaseUrl}/auth/v1/user`, { headers });
      const user = await userResponse.json().catch(() => null);
      if (userResponse.status === 401 || userResponse.status === 403) {
        return respond(res, "UNAUTHORIZED", "Supabase session is invalid or expired", 401);
      }
      if (!userResponse.ok || !user || typeof user !== "object") {
        return respond(res, "SUPABASE_AUTH_FAILED", "Supabase authentication could not be verified", 502);
      }
      const parsedId = SupabaseUserIdSchema.safeParse(user.id);
      if (!parsedId.success || ["service_role", "supabase_admin"].includes(String(user.role || "").toLowerCase())) {
        return respond(res, "UNAUTHORIZED", "A valid Supabase user session is required", 401);
      }

      const authorizationResponse = await fetchImpl(`${config.supabaseUrl}/rest/v1/rpc/is_authorized_recruiter`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: "{}",
      });
      const authorized = await authorizationResponse.json().catch(() => null);
      if (authorizationResponse.status === 401 || authorizationResponse.status === 403) {
        return respond(res, "UNAUTHORIZED", "Supabase session is invalid or expired", 401);
      }
      if (!authorizationResponse.ok) return respond(res, "SUPABASE_AUTH_FAILED", "Recruiter access could not be verified", 502);
      if (authorized !== true) return respond(res, "ACCOUNT_FORBIDDEN", "This account is not authorized for Workbench", 403);

      req.supabaseRecruiter = Object.freeze({
        accessToken,
        ownerId: parsedId.data.toLowerCase(),
        email: typeof user.email === "string" ? user.email.trim().toLowerCase() : null,
      });
      res.set("Cache-Control", "private, no-store");
      return next();
    } catch {
      return respond(res, "SUPABASE_AUTH_FAILED", "Supabase authentication could not be verified", 502);
    }
  };
}
