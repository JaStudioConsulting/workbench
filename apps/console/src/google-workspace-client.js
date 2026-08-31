import {
  GoogleCalendarUpcomingSchema,
  GoogleWorkspaceStartSchema,
  GoogleWorkspaceStatusSchema,
} from "@ja/shared-types";
import { gatewayBaseURL } from "./auth-client.js";

const GOOGLE_AUTH_ORIGIN = "https://accounts.google.com";
const GOOGLE_AUTH_PATH = "/o/oauth2/v2/auth";

export class GoogleWorkspaceClientError extends Error {
  constructor(message, { status = 0, code = "GOOGLE_WORKSPACE_UNAVAILABLE" } = {}) {
    super(message);
    this.name = "GoogleWorkspaceClientError";
    this.status = status;
    this.code = code;
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function responseError(response, payload) {
  const code = typeof payload?.error?.code === "string"
    ? payload.error.code
    : "GOOGLE_WORKSPACE_REQUEST_FAILED";

  return new GoogleWorkspaceClientError("Google Workspace request failed.", {
    status: response.status,
    code,
  });
}

async function request(path, schema, {
  method = "GET",
  signal,
  fetchImpl = globalThis.fetch,
  baseURL = gatewayBaseURL,
} = {}) {
  let response;
  try {
    response = await fetchImpl(new URL(path, baseURL), {
      method,
      credentials: "include",
      signal,
      headers: { Accept: "application/json" },
      ...(method === "GET" ? { cache: "no-store" } : {}),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new GoogleWorkspaceClientError("Google Workspace is unavailable.");
  }

  const payload = await readJson(response);
  if (!response.ok) throw responseError(response, payload);

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new GoogleWorkspaceClientError("Google Workspace returned an invalid response.", {
      status: 502,
      code: "INVALID_GOOGLE_WORKSPACE_RESPONSE",
    });
  }

  return parsed.data;
}

export function getGoogleWorkspaceStatus(options) {
  return request("/api/google-workspace/status", GoogleWorkspaceStatusSchema, options);
}

export function startGoogleWorkspaceConnection(options) {
  return request("/api/google-workspace/oauth/start", GoogleWorkspaceStartSchema, {
    ...options,
    method: "POST",
  });
}

export function disconnectGoogleWorkspace(options) {
  return request("/api/google-workspace/disconnect", GoogleWorkspaceStatusSchema, {
    ...options,
    method: "POST",
  });
}

export function getUpcomingGoogleCalendar(options) {
  return request("/api/google-workspace/calendar/upcoming", GoogleCalendarUpcomingSchema, options);
}

export function validateGoogleAuthorizationUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new GoogleWorkspaceClientError("Google sign-in could not be opened.", {
      code: "INVALID_GOOGLE_AUTHORIZATION_URL",
    });
  }

  if (url.origin !== GOOGLE_AUTH_ORIGIN || url.pathname !== GOOGLE_AUTH_PATH) {
    throw new GoogleWorkspaceClientError("Google sign-in could not be opened.", {
      code: "INVALID_GOOGLE_AUTHORIZATION_URL",
    });
  }

  return url.toString();
}
