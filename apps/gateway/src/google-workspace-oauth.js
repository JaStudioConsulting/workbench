import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";

const CONFIG_ERROR_CODE = "GOOGLE_WORKSPACE_OAUTH_CONFIG_INVALID";
const INPUT_ERROR_CODE = "GOOGLE_WORKSPACE_OAUTH_INPUT_INVALID";
const IDENTITY_ERROR_CODE = "GOOGLE_WORKSPACE_IDENTITY_INVALID";
const SCOPE_ERROR_CODE = "GOOGLE_WORKSPACE_SCOPE_INVALID";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const GOOGLE_WORKSPACE_SCOPES = Object.freeze({
  identity: Object.freeze(["openid", "email", "profile"]),
  gmail: Object.freeze(["https://www.googleapis.com/auth/gmail.readonly"]),
  calendar: Object.freeze(["https://www.googleapis.com/auth/calendar.readonly"]),
  drive: Object.freeze(["https://www.googleapis.com/auth/drive.metadata.readonly"]),
});

const KNOWN_STAGES = new Set(Object.keys(GOOGLE_WORKSPACE_SCOPES));
const ALLOWED_FIRST_GRANT_SCOPES = new Set([
  ...GOOGLE_WORKSPACE_SCOPES.identity,
  ...GOOGLE_WORKSPACE_SCOPES.calendar,
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]);

function configurationError(field) {
  return Object.assign(new Error(`Google Workspace OAuth is not configured: ${field}`), { code: CONFIG_ERROR_CODE });
}

function inputError(message) {
  return Object.assign(new Error(message), { code: INPUT_ERROR_CODE });
}

function identityError() {
  return Object.assign(new Error("Google Workspace identity could not be verified"), { code: IDENTITY_ERROR_CODE });
}

function scopeError() {
  return Object.assign(new Error("Google Workspace authorization did not grant the required read-only access"), { code: SCOPE_ERROR_CODE });
}

function requiredEnvironmentValue(env, field) {
  const value = env?.[field];
  if (typeof value !== "string" || value !== value.trim() || !value) throw configurationError(field);
  return value;
}

function validRedirectUri(value) {
  try {
    const url = new URL(value);
    const secure = url.protocol === "https:";
    const local = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
    if ((!secure && !local) || url.username || url.password || url.search || url.hash || url.pathname === "/") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function readGoogleWorkspaceOAuthConfig(env = process.env) {
  const clientId = requiredEnvironmentValue(env, "GOOGLE_WORKSPACE_CLIENT_ID");
  const clientSecret = requiredEnvironmentValue(env, "GOOGLE_WORKSPACE_CLIENT_SECRET");
  const redirectValue = requiredEnvironmentValue(env, "GOOGLE_WORKSPACE_REDIRECT_URI");
  const returnValue = requiredEnvironmentValue(env, "GOOGLE_WORKSPACE_RETURN_URI");
  const redirectUri = validRedirectUri(redirectValue);
  const returnUri = validRedirectUri(returnValue);

  if (!clientId.endsWith(".apps.googleusercontent.com")) throw configurationError("GOOGLE_WORKSPACE_CLIENT_ID");
  if (clientSecret.length < 16) throw configurationError("GOOGLE_WORKSPACE_CLIENT_SECRET");
  if (!redirectUri) throw configurationError("GOOGLE_WORKSPACE_REDIRECT_URI");
  if (!returnUri) throw configurationError("GOOGLE_WORKSPACE_RETURN_URI");

  return Object.freeze({ clientId, clientSecret, redirectUri, returnUri });
}

export function scopesForGoogleWorkspaceStages(stages = ["identity"]) {
  if (!Array.isArray(stages) || stages.length === 0) throw inputError("At least one Google Workspace OAuth stage is required");
  const requestedStages = new Set(["identity"]);
  for (const stage of stages) {
    if (typeof stage !== "string" || !KNOWN_STAGES.has(stage)) throw inputError("Unknown Google Workspace OAuth stage");
    requestedStages.add(stage);
  }
  return Object.freeze([...requestedStages].flatMap((stage) => GOOGLE_WORKSPACE_SCOPES[stage]));
}

export function createGoogleWorkspaceOAuthClient(env = process.env, { OAuth2ClientClass = OAuth2Client } = {}) {
  const { clientId, clientSecret, redirectUri } = readGoogleWorkspaceOAuthConfig(env);
  return new OAuth2ClientClass({ clientId, clientSecret, redirectUri });
}

function validatedState(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 512 || !/^[A-Za-z0-9._~-]+$/.test(value)) {
    throw inputError("A strong OAuth state value is required");
  }
  return value;
}

function validatedLoginHint(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value !== value.trim() || !value || value.length > 320 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw inputError("Google login hint is invalid");
  }
  return value;
}

export function generateGoogleWorkspaceAuthorizationUrl({
  env = process.env,
  stages = ["identity"],
  state,
  loginHint,
} = {}, dependencies) {
  const oauth2Client = createGoogleWorkspaceOAuthClient(env, dependencies);
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: scopesForGoogleWorkspaceStages(stages),
    state: validatedState(state),
    ...(loginHint === undefined ? {} : { login_hint: validatedLoginHint(loginHint) }),
  });
}

function validatedAuthorizationCode(value) {
  if (typeof value !== "string" || value !== value.trim() || !value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw inputError("Google authorization code is invalid");
  }
  return value;
}

function validatedCredentials(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw inputError("Google OAuth credentials are invalid");
  if (!value.access_token && !value.refresh_token) throw inputError("Google OAuth credentials contain no usable token");
  return { ...value };
}

export async function exchangeGoogleWorkspaceAuthorizationCode({ env = process.env, code } = {}, dependencies) {
  const oauth2Client = createGoogleWorkspaceOAuthClient(env, dependencies);
  const result = await oauth2Client.getToken(validatedAuthorizationCode(code));
  const credentials = validatedCredentials(result?.tokens);
  oauth2Client.setCredentials(credentials);
  return Object.freeze({ oauth2Client, credentials: Object.freeze(credentials) });
}

function normalizedGoogleEmail(value) {
  if (typeof value !== "string") throw identityError();
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw identityError();
  return email;
}

function normalizedGrantedScopes(value) {
  if (!Array.isArray(value) || value.some((scope) => typeof scope !== "string" || !scope.trim())) throw scopeError();
  return [...new Set(value.map((scope) => scope.trim()))].sort();
}

export async function verifyGoogleWorkspaceGrant({ env = process.env, oauth2Client, credentials } = {}) {
  if (!oauth2Client || typeof oauth2Client.verifyIdToken !== "function" || typeof oauth2Client.getTokenInfo !== "function") throw identityError();
  if (!credentials || typeof credentials.id_token !== "string" || !credentials.id_token || typeof credentials.access_token !== "string" || !credentials.access_token) throw identityError();
  const { clientId } = readGoogleWorkspaceOAuthConfig(env);
  let payload;
  let tokenInfo;
  try {
    const ticket = await oauth2Client.verifyIdToken({ idToken: credentials.id_token, audience: clientId });
    payload = ticket?.getPayload?.();
    tokenInfo = await oauth2Client.getTokenInfo(credentials.access_token);
  } catch {
    throw identityError();
  }
  if (!payload || payload.email_verified !== true || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255) throw identityError();
  const email = normalizedGoogleEmail(payload.email);
  const scopes = normalizedGrantedScopes(tokenInfo?.scopes);
  if (!scopes.includes(GOOGLE_WORKSPACE_SCOPES.calendar[0]) || scopes.some((scope) => !ALLOWED_FIRST_GRANT_SCOPES.has(scope))) throw scopeError();
  return Object.freeze({ subject: payload.sub, email, scopes: Object.freeze(scopes) });
}

export async function revokeGoogleWorkspaceCredentials({ env = process.env, credentials } = {}, dependencies) {
  const oauth2Client = createGoogleWorkspaceOAuthClient(env, dependencies);
  const safeCredentials = validatedCredentials(credentials);
  const token = safeCredentials.refresh_token || safeCredentials.access_token;
  if (!token || typeof oauth2Client.revokeToken !== "function") throw inputError("Google OAuth credentials cannot be revoked");
  try {
    await oauth2Client.revokeToken(token);
    return Object.freeze({ revoked: true });
  } catch (error) {
    if (error?.response?.status === 400 && error?.response?.data?.error === "invalid_token") {
      return Object.freeze({ revoked: true, alreadyInvalid: true });
    }
    throw Object.assign(new Error("Google Workspace authorization could not be revoked"), { code: "GOOGLE_WORKSPACE_REVOCATION_FAILED" });
  }
}

export function createGoogleWorkspaceApiClients({ env = process.env, credentials } = {}, {
  OAuth2ClientClass = OAuth2Client,
  googleApis = google,
} = {}) {
  const oauth2Client = createGoogleWorkspaceOAuthClient(env, { OAuth2ClientClass });
  oauth2Client.setCredentials(validatedCredentials(credentials));
  return Object.freeze({
    oauth2Client,
    gmail: googleApis.gmail({ version: "v1", auth: oauth2Client }),
    calendar: googleApis.calendar({ version: "v3", auth: oauth2Client }),
    drive: googleApis.drive({ version: "v3", auth: oauth2Client }),
  });
}
