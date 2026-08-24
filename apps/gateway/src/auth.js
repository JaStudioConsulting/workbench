function exactHttpsOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

export function parseExactHttpsOrigins(value) {
  const origins = String(value || "").split(",").map((item) => exactHttpsOrigin(item.trim()));
  if (!origins.length || origins.some((origin) => !origin)) return null;
  return [...new Set(origins)];
}

export async function createConfiguredAuth(env = process.env) {
  const trustedOrigins = parseExactHttpsOrigins(env.AUTH_TRUSTED_ORIGINS);
  const baseOrigin = exactHttpsOrigin(env.BETTER_AUTH_URL);
  const secret = typeof env.BETTER_AUTH_SECRET === "string" ? env.BETTER_AUTH_SECRET : "";
  if (!env.DATABASE_URL || !baseOrigin || secret.length < 32 || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !trustedOrigins || !trustedOrigins.includes(baseOrigin)) {
    return { enabled: false, reason: "Authentication is not fully configured" };
  }
  try {
    const [{ betterAuth }, { Pool }, { toNodeHandler, fromNodeHeaders }] = await Promise.all([
      import("better-auth"), import("pg"), import("better-auth/node"),
    ]);
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    const auth = betterAuth({
      database: pool,
      baseURL: baseOrigin,
      secret,
      trustedOrigins,
      socialProviders: { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } },
      advanced: { useSecureCookies: true },
    });
    return {
      enabled: true,
      handler: toNodeHandler(auth),
      async getSession(req) {
        try { return await auth.api.getSession({ headers: fromNodeHeaders(req.headers) }); }
        catch { return null; }
      },
    };
  } catch { return { enabled: false, reason: "Authentication could not initialize" }; }
}
