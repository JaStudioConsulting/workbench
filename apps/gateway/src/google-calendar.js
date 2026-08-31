import { GoogleCalendarUpcomingSchema } from "@ja/shared-types";
import { createGoogleWorkspaceApiClients } from "./google-workspace-oauth.js";

const RANGE_DAYS = 30;
const MAX_RESULTS = 10;
const PROVIDER_TIMEOUT_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizedText(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
  return normalized || null;
}

function normalizedEventTime(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.dateTime === "string") {
    const date = new Date(value.dateTime);
    if (Number.isFinite(date.getTime())) return Object.freeze({ kind: "dateTime", value: date.toISOString() });
  }
  if (typeof value.date === "string" && DATE_PATTERN.test(value.date)) {
    const date = new Date(`${value.date}T00:00:00.000Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.date) {
      return Object.freeze({ kind: "date", value: value.date });
    }
  }
  return null;
}

function normalizedEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const start = normalizedEventTime(value.start);
  const end = normalizedEventTime(value.end);
  if (!start || !end || start.kind !== end.kind || end.value <= start.value) return null;
  return Object.freeze({
    title: normalizedText(value.summary, 200),
    start,
    end,
    allDay: start.kind === "date",
  });
}

function normalizedRefreshTokens(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const tokens = {};
  if (typeof value.access_token === "string" && value.access_token) tokens.access_token = value.access_token;
  if (typeof value.refresh_token === "string" && value.refresh_token) tokens.refresh_token = value.refresh_token;
  if (typeof value.token_type === "string" && value.token_type) tokens.token_type = value.token_type;
  if (Number.isFinite(value.expiry_date)) tokens.expiry_date = value.expiry_date;
  return Object.keys(tokens).length ? Object.freeze(tokens) : null;
}

function validNow(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Google Calendar time is invalid");
  return date;
}

export async function readUpcomingGoogleCalendarEvents({
  env = process.env,
  credentials,
  now = new Date(),
  createApiClients = createGoogleWorkspaceApiClients,
  persistRefresh,
} = {}) {
  const from = validNow(now);
  const to = new Date(from.getTime() + (RANGE_DAYS * DAY_MS));
  const clients = createApiClients({ env, credentials });
  if (!clients?.calendar?.events || typeof clients.calendar.events.list !== "function") {
    throw new Error("Google Calendar client is unavailable");
  }
  let refreshedTokens = null;
  if (clients.oauth2Client && typeof clients.oauth2Client.on === "function") {
    clients.oauth2Client.on("tokens", (tokens) => { refreshedTokens = normalizedRefreshTokens(tokens); });
  }
  let response;
  let providerError;
  try {
    response = await clients.calendar.events.list({
      calendarId: "primary",
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      maxResults: MAX_RESULTS,
      singleEvents: true,
      orderBy: "startTime",
      showDeleted: false,
      fields: "items(summary,start,end)",
    }, { timeout: PROVIDER_TIMEOUT_MS });
  } catch (error) {
    providerError = error;
  }
  if (refreshedTokens) {
    if (typeof persistRefresh !== "function") throw new Error("Google credential refresh storage is unavailable");
    await persistRefresh(refreshedTokens);
  }
  if (providerError) throw providerError;
  const items = Array.isArray(response?.data?.items) ? response.data.items : [];
  return GoogleCalendarUpcomingSchema.parse({
    connected: true,
    range: { from: from.toISOString(), to: to.toISOString() },
    events: items.slice(0, MAX_RESULTS).map(normalizedEvent).filter(Boolean),
  });
}
