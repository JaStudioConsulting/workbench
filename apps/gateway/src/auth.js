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

function normalizedEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  const domain = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  if (!email || email.length > 320 || !new RegExp(`^[^\\s@]+@${domain}(?:\\.${domain})+$`).test(email)) return null;
  return email;
}

export function parseAllowedGoogleEmails(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const emails = value.split(",").map((item) => normalizedEmail(item));
  if (emails.some((email) => !email)) return null;
  return [...new Set(emails)];
}

export async function createConfiguredAuth(env = process.env) {
  const trustedOrigins = parseExactHttpsOrigins(env.AUTH_TRUSTED_ORIGINS);
  const allowedGoogleEmails = parseAllowedGoogleEmails(env.AUTH_ALLOWED_GOOGLE_EMAILS);
  const baseOrigin = exactHttpsOrigin(env.BETTER_AUTH_URL);
  const secret = typeof env.BETTER_AUTH_SECRET === "string" ? env.BETTER_AUTH_SECRET : "";
  if (!env.DATABASE_URL || !baseOrigin || secret.length < 32 || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !trustedOrigins || !trustedOrigins.includes(baseOrigin) || !allowedGoogleEmails) {
    return { enabled: false, reason: "Authentication is not fully configured" };
  }
  const isApprovedEmail = (value) => {
    const email = normalizedEmail(value);
    return Boolean(email && allowedGoogleEmails.includes(email));
  };
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
      socialProviders: { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, requireEmailVerification: true } },
      user: {
        validateUserInfo({ user }) {
          if (isApprovedEmail(user?.email)) return;
          return { error: "email_not_allowed", errorDescription: "This Google account is not approved for this Workbench" };
        },
      },
      advanced: { useSecureCookies: true },
    });
    return {
      enabled: true,
      handler: toNodeHandler(auth),
      isApprovedEmail,
      pool,
      async getSession(req) {
        try { return await auth.api.getSession({ headers: fromNodeHeaders(req.headers) }); }
        catch { return null; }
      },
      async getAuthoritativeSession(req) {
        try {
          return await auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
            query: { disableCookieCache: true },
          });
        } catch { return null; }
      },
    };
  } catch { return { enabled: false, reason: "Authentication could not initialize" }; }
}
