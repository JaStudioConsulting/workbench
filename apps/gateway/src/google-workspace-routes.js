import { randomBytes } from "node:crypto";
import { GoogleCalendarUpcomingSchema, GoogleWorkspaceStartSchema, GoogleWorkspaceStatusSchema, errorEnvelope } from "@ja/shared-types";
import { parseExactHttpsOrigins } from "./auth.js";
import { readUpcomingGoogleCalendarEvents } from "./google-calendar.js";
import { createGoogleCredentialStore } from "./google-credential-store.js";
import { createGoogleOAuthStateStore } from "./google-oauth-state-store.js";
import {
  GOOGLE_WORKSPACE_SCOPES,
  exchangeGoogleWorkspaceAuthorizationCode,
  generateGoogleWorkspaceAuthorizationUrl,
  readGoogleWorkspaceOAuthConfig,
  revokeGoogleWorkspaceCredentials,
  verifyGoogleWorkspaceGrant,
} from "./google-workspace-oauth.js";

const CALENDAR_SCOPE = GOOGLE_WORKSPACE_SCOPES.calendar[0];

function noStore(res) {
  res.set("Cache-Control", "private, no-store");
  return res;
}

function respondError(res, code, message, status) {
  return noStore(res).status(status).json(errorEnvelope(code, message));
}

function normalizedSessionEmail(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().toLowerCase();
}

function sessionBinding(req) {
  const sessionId = req.workbenchSession?.session?.id;
  const sessionUserId = req.workbenchSession?.session?.userId;
  const userId = req.workbenchSession?.user?.id;
  const email = normalizedSessionEmail(req.workbenchSession?.user?.email);
  if (!sessionId || !sessionUserId || !userId || userId !== sessionUserId || !email) return null;
  return Object.freeze({ sessionId, userId, email });
}

function fixedReturnLocation(returnUri, outcome) {
  const url = new URL(returnUri);
  url.searchParams.set("googleWorkspace", outcome);
  return url.toString();
}

function integrationErrorCode(error) {
  if (error?.code === "GOOGLE_WORKSPACE_IDENTITY_INVALID") return ["GOOGLE_WORKSPACE_IDENTITY_INVALID", "Google Workspace identity could not be verified", 403];
  if (error?.code === "GOOGLE_WORKSPACE_SCOPE_INVALID") return ["GOOGLE_WORKSPACE_SCOPE_INVALID", "Google Workspace did not grant the required read-only Calendar access", 403];
  if (error?.code === "REFRESH_TOKEN_REQUIRED") return ["GOOGLE_WORKSPACE_REFRESH_REQUIRED", "Google Workspace did not provide durable authorization", 409];
  if (error?.code === "GOOGLE_WORKSPACE_REVOCATION_FAILED") return ["GOOGLE_WORKSPACE_REVOCATION_FAILED", "Google Workspace could not be disconnected safely", 502];
  if (error?.code === "GOOGLE_WORKSPACE_OAUTH_INPUT_INVALID") return ["GOOGLE_WORKSPACE_OAUTH_INPUT_INVALID", "Google Workspace authorization input is invalid", 400];
  return ["GOOGLE_WORKSPACE_UNAVAILABLE", "Google Workspace authorization is unavailable", 503];
}

function calendarErrorCode(error) {
  const status = Number(error?.response?.status ?? error?.code);
  const providerCode = error?.response?.data?.error;
  if (error?.code === "GOOGLE_CALENDAR_CONNECTION_CHANGED") {
    return ["GOOGLE_WORKSPACE_CONNECTION_CHANGED", "Google Workspace connection changed; retry Calendar", 409];
  }
  if (status === 401 || providerCode === "invalid_grant" || error?.code === "invalid_grant") {
    return ["GOOGLE_WORKSPACE_REAUTH_REQUIRED", "Google Calendar must be connected again", 401];
  }
  if (status === 403 || providerCode === "insufficientPermissions") {
    return ["GOOGLE_CALENDAR_SCOPE_REQUIRED", "Google Calendar read-only access is not connected", 403];
  }
  return ["GOOGLE_CALENDAR_UNAVAILABLE", "Upcoming Google Calendar events are unavailable", 502];
}

export function createGoogleWorkspaceHandlers({
  env = process.env,
  auth,
  credentialStore,
  stateStore,
  randomBytesFn = randomBytes,
  oauth = {},
  calendar = {},
} = {}) {
  try {
    if (!auth?.enabled || !auth.pool || typeof auth.isApprovedEmail !== "function") throw new Error("auth unavailable");
    const oauthConfig = readGoogleWorkspaceOAuthConfig(env);
    const trustedOrigins = parseExactHttpsOrigins(env.APP_TRUSTED_ORIGINS || env.AUTH_TRUSTED_ORIGINS);
    if (!trustedOrigins?.includes(new URL(oauthConfig.returnUri).origin)) throw new Error("return origin unavailable");
    const credentials = credentialStore ?? createGoogleCredentialStore({ pool: auth.pool, encryptionKey: env.GOOGLE_TOKEN_ENCRYPTION_KEY });
    const states = stateStore ?? createGoogleOAuthStateStore({ pool: auth.pool });
    const generateAuthorizationUrl = oauth.generateAuthorizationUrl ?? generateGoogleWorkspaceAuthorizationUrl;
    const exchangeCode = oauth.exchangeCode ?? exchangeGoogleWorkspaceAuthorizationCode;
    const verifyGrant = oauth.verifyGrant ?? verifyGoogleWorkspaceGrant;
    const revokeCredentials = oauth.revokeCredentials ?? revokeGoogleWorkspaceCredentials;
    const readUpcomingEvents = calendar.readUpcomingEvents ?? readUpcomingGoogleCalendarEvents;

    return Object.freeze({
      enabled: true,

      async start(req, res) {
        const binding = sessionBinding(req);
        if (!binding) return respondError(res, "UNAUTHORIZED", "A valid session is required", 401);
        try {
          const stateBytes = randomBytesFn(32);
          if (!Buffer.isBuffer(stateBytes) || stateBytes.length !== 32) throw new Error("state unavailable");
          const state = stateBytes.toString("base64url");
          const { expiresAt } = await states.create({ state, accountId: binding.userId, sessionId: binding.sessionId, initiatingEmail: binding.email });
          const authorizationUrl = generateAuthorizationUrl({ env, stages: ["calendar"], state, loginHint: binding.email });
          return noStore(res).json(GoogleWorkspaceStartSchema.parse({ authorizationUrl, expiresAt: expiresAt.toISOString() }));
        } catch (error) {
          const [code, message, status] = integrationErrorCode(error);
          return respondError(res, code, message, status);
        }
      },

      async callback(req, res) {
        const binding = sessionBinding(req);
        if (!binding) return respondError(res, "UNAUTHORIZED", "A valid session is required", 401);
        let consumed;
        try {
          consumed = await states.consume({
            state: req.query.state,
            accountId: binding.userId,
            sessionId: binding.sessionId,
            initiatingEmail: binding.email,
          });
        } catch (error) {
          if (error?.code === "GOOGLE_OAUTH_STATE_INPUT_INVALID") return respondError(res, "GOOGLE_WORKSPACE_STATE_INVALID", "Google Workspace authorization state is invalid", 400);
          return respondError(res, "GOOGLE_WORKSPACE_UNAVAILABLE", "Google Workspace authorization is unavailable", 503);
        }
        if (!consumed) return respondError(res, "GOOGLE_WORKSPACE_STATE_INVALID", "Google Workspace authorization state is invalid", 400);
        if (req.query.error) return noStore(res).redirect(303, fixedReturnLocation(oauthConfig.returnUri, "denied"));
        try {
          const exchanged = await exchangeCode({ env, code: req.query.code });
          const identity = await verifyGrant({ env, oauth2Client: exchanged.oauth2Client, credentials: exchanged.credentials });
          if (!auth.isApprovedEmail(identity.email) || identity.email !== binding.email) {
            return respondError(res, "GOOGLE_WORKSPACE_ACCOUNT_FORBIDDEN", "This Google account is not approved for this Workbench session", 403);
          }
          await credentials.save({
            accountId: binding.userId,
            credentials: exchanged.credentials,
            scopes: identity.scopes,
            expiresAt: exchanged.credentials.expiry_date ?? null,
          });
          return noStore(res).redirect(303, fixedReturnLocation(oauthConfig.returnUri, "connected"));
        } catch (error) {
          const [code, message, status] = integrationErrorCode(error);
          return respondError(res, code, message, status);
        }
      },

      async status(req, res) {
        const binding = sessionBinding(req);
        if (!binding) return respondError(res, "UNAUTHORIZED", "A valid session is required", 401);
        try {
          const connection = await credentials.load(binding.userId);
          const body = connection && Array.isArray(connection.scopes) && connection.scopes.includes(CALENDAR_SCOPE)
            ? { connected: true, account: { email: binding.email }, scopes: [CALENDAR_SCOPE] }
            : { connected: false };
          return noStore(res).json(GoogleWorkspaceStatusSchema.parse(body));
        } catch {
          return respondError(res, "GOOGLE_WORKSPACE_UNAVAILABLE", "Google Workspace authorization is unavailable", 503);
        }
      },

      async upcomingEvents(req, res) {
        const binding = sessionBinding(req);
        if (!binding) return respondError(res, "UNAUTHORIZED", "A valid session is required", 401);
        let connection;
        try {
          connection = await credentials.load(binding.userId);
        } catch {
          return respondError(res, "GOOGLE_WORKSPACE_UNAVAILABLE", "Google Workspace authorization is unavailable", 503);
        }
        if (!connection) return respondError(res, "GOOGLE_WORKSPACE_NOT_CONNECTED", "Google Calendar is not connected", 409);
        if (!Array.isArray(connection.scopes) || !connection.scopes.includes(CALENDAR_SCOPE)) {
          return respondError(res, "GOOGLE_CALENDAR_SCOPE_REQUIRED", "Google Calendar read-only access is not connected", 403);
        }
        try {
          const result = await readUpcomingEvents({
            env,
            credentials: {
              ...connection.credentials,
              ...(connection.expiresAt instanceof Date ? { expiry_date: connection.expiresAt.getTime() } : {}),
            },
            async persistRefresh(tokens) {
              const persisted = await credentials.persistRefresh(binding.userId, { generation: connection.generation, revision: connection.revision, credentials: tokens });
              if (!persisted.persisted) throw Object.assign(new Error("Google Workspace connection changed"), { code: "GOOGLE_CALENDAR_CONNECTION_CHANGED" });
            },
          });
          return noStore(res).json(GoogleCalendarUpcomingSchema.parse(result));
        } catch (error) {
          const [code, message, status] = calendarErrorCode(error);
          return respondError(res, code, message, status);
        }
      },

      async disconnect(req, res) {
        const binding = sessionBinding(req);
        if (!binding) return respondError(res, "UNAUTHORIZED", "A valid session is required", 401);
        let connection;
        try {
          connection = await credentials.load(binding.userId);
        } catch {
          return respondError(res, "GOOGLE_WORKSPACE_UNAVAILABLE", "Google Workspace authorization is unavailable", 503);
        }
        if (!connection) return noStore(res).json(GoogleWorkspaceStatusSchema.parse({ connected: false }));
        try { await revokeCredentials({ env, credentials: connection.credentials }); }
        catch (error) {
          const [code, message, status] = integrationErrorCode(error);
          return respondError(res, code, message, status);
        }
        try {
          const result = await credentials.disconnect(binding.userId, { generation: connection.generation, revision: connection.revision });
          if (!result.disconnected) return respondError(res, "GOOGLE_WORKSPACE_CONNECTION_CHANGED", "Google Workspace connection changed; retry disconnect", 409);
          return noStore(res).json(GoogleWorkspaceStatusSchema.parse({ connected: false }));
        } catch {
          return respondError(res, "GOOGLE_WORKSPACE_UNAVAILABLE", "Google Workspace authorization is unavailable", 503);
        }
      },
    });
  } catch {
    return Object.freeze({ enabled: false, reason: "Google Workspace authorization is not fully configured" });
  }
}
