import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";

const CONFIG_ERROR_CODE = "GOOGLE_WORKSPACE_OAUTH_CONFIG_INVALID";
const INPUT_ERROR_CODE = "GOOGLE_WORKSPACE_OAUTH_INPUT_INVALID";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const GOOGLE_WORKSPACE_SCOPES = Object.freeze({
  identity: Object.freeze(["openid", "email", "profile"]),
  gmail: Object.freeze(["https://www.googleapis.com/auth/gmail.readonly"]),
  calendar: Object.freeze(["https://www.googleapis.com/auth/calendar.readonly"]),
  drive: Object.freeze(["https://www.googleapis.com/auth/drive.metadata.readonly"]),
});

const KNOWN_STAGES = new Set(Object.keys(GOOGLE_WORKSPACE_SCOPES));

function configurationError(field) {
  return Object.assign(new Error(`Google Workspace OAuth is not configured: ${field}`), { code: CONFIG_ERROR_CODE });
}

function inputError(message) {
  return Object.assign(new Error(message), { code: INPUT_ERROR_CODE });
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
  const redirectUri = validRedirectUri(redirectValue);

  if (!clientId.endsWith(".apps.googleusercontent.com")) throw configurationError("GOOGLE_WORKSPACE_CLIENT_ID");
  if (clientSecret.length < 16) throw configurationError("GOOGLE_WORKSPACE_CLIENT_SECRET");
  if (!redirectUri) throw configurationError("GOOGLE_WORKSPACE_REDIRECT_URI");

  return Object.freeze({ clientId, clientSecret, redirectUri });
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
