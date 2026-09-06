import { GoogleWorkspaceSyncRequestSchema, GoogleWorkspaceSyncResponseSchema, errorEnvelope } from "@ja/shared-types";
import { google } from "googleapis";
import { GOOGLE_WORKSPACE_SCOPES } from "./google-workspace-oauth.js";

const MAX_CELL_LENGTH = 2000;

function requiredScope(service) {
  return service === "sheets" ? GOOGLE_WORKSPACE_SCOPES.sheets[0] : GOOGLE_WORKSPACE_SCOPES.gmail[0];
}

function sanitizeCell(value) {
  return String(value ?? "").slice(0, MAX_CELL_LENGTH);
}

function sanitizeRows(values) {
  return (Array.isArray(values) ? values : []).slice(0, 200).map((row) =>
    (Array.isArray(row) ? row : []).slice(0, 50).map(sanitizeCell),
  );
}

export function createGoogleApiService({ auth, apiClientsFactory } = {}) {
  if (!auth || typeof auth.getGoogleProviderAccessToken !== "function") throw new TypeError("Google provider auth is required");
  const createClients = apiClientsFactory ?? (async (accessToken) => {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    return {
      oauth2Client,
      gmail: google.gmail({ version: "v1", auth: oauth2Client }),
      sheets: google.sheets({ version: "v4", auth: oauth2Client }),
    };
  });
  return Object.freeze({
    async sync(req) {
      const input = GoogleWorkspaceSyncRequestSchema.parse(req.body);
      const tokenResult = await auth.getGoogleProviderAccessToken(req);
      const token = tokenResult?.accessToken || tokenResult?.access_token;
      if (!token) throw Object.assign(new Error("Google account is not connected"), { code: "GOOGLE_ACCOUNT_NOT_CONNECTED" });
      const clients = await createClients(token);
      const grantedScopes = tokenResult?.scopes;
      if (!Array.isArray(grantedScopes) || !grantedScopes.includes(requiredScope(input.service))) {
        throw Object.assign(new Error("Required Google Workspace scope is not granted"), { code: "GOOGLE_SCOPE_REQUIRED" });
      }
      if (input.service === "sheets") {
        const response = await clients.sheets.spreadsheets.values.get({ spreadsheetId: input.spreadsheetId, range: input.range });
        return GoogleWorkspaceSyncResponseSchema.parse({ service: "sheets", spreadsheetId: input.spreadsheetId, range: input.range, rows: sanitizeRows(response?.data?.values) });
      }
      const response = await clients.gmail.users.threads.list({ userId: "me", q: input.query || undefined, maxResults: input.maxResults });
      const threads = (Array.isArray(response?.data?.threads) ? response.data.threads : [])
        .slice(0, input.maxResults)
        .filter((thread) => typeof thread?.id === "string")
        .map((thread) => ({ id: thread.id.slice(0, 200) }));
      return GoogleWorkspaceSyncResponseSchema.parse({ service: "gmail", threads });
    },
  });
}

export function createGoogleApiHandlers(options) {
  const service = createGoogleApiService(options);
  return Object.freeze({
    async sync(req, res) {
      try { return res.set("Cache-Control", "private, no-store").json(await service.sync(req)); }
      catch (error) {
        const code = error?.code === "GOOGLE_ACCOUNT_NOT_CONNECTED" ? "GOOGLE_ACCOUNT_NOT_CONNECTED"
          : error?.code === "GOOGLE_SCOPE_REQUIRED" ? "GOOGLE_SCOPE_REQUIRED"
            : error?.name === "ZodError" ? "INVALID_INPUT" : "GOOGLE_WORKSPACE_UNAVAILABLE";
        const status = code === "INVALID_INPUT" ? 400 : code === "GOOGLE_ACCOUNT_NOT_CONNECTED" ? 409 : code === "GOOGLE_SCOPE_REQUIRED" ? 403 : 502;
        const message = code === "INVALID_INPUT" ? "Invalid Google Workspace sync request"
          : code === "GOOGLE_ACCOUNT_NOT_CONNECTED" ? "A connected Google account is required"
            : code === "GOOGLE_SCOPE_REQUIRED" ? "The required Google Workspace scope is not granted"
              : "Google Workspace request failed";
        return res.set("Cache-Control", "private, no-store").status(status).json(errorEnvelope(code, message));
      }
    },
  });
}
