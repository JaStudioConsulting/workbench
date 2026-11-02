import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { readUpcomingGoogleCalendarEvents } from "../src/google-calendar.js";

const fixedNow = new Date("2026-08-31T12:00:00.000Z");

function clientFixture({ items = [], providerFailure, refreshedTokens } = {}) {
  const observed = { calls: [], credentials: null };
  const oauth2Client = new EventEmitter();
  const createApiClients = ({ credentials }) => {
    observed.credentials = credentials;
    return {
      oauth2Client,
      calendar: {
        events: {
          async list(params, options) {
            observed.calls.push({ params, options });
            if (refreshedTokens) oauth2Client.emit("tokens", refreshedTokens);
            if (providerFailure) throw providerFailure;
            return { data: { items } };
          },
        },
      },
    };
  };
  return { observed, createApiClients };
}

test("upcoming Calendar read is one bounded official-client call and sanitizes provider events", async () => {
  const extras = { description: "private detail", attendees: [{ email: "hidden@example.invalid" }], hangoutLink: "https://meet.example/hidden", id: "raw-provider-id" };
  const items = [
    { ...extras, summary: " Planning\nReview ", start: { dateTime: "2026-09-01T09:00:00-04:00" }, end: { dateTime: "2026-09-01T09:30:00-04:00" } },
    { ...extras, summary: null, start: { date: "2026-09-03" }, end: { date: "2026-09-04" } },
    { ...extras, summary: "malformed", start: { dateTime: "not-a-date" }, end: { dateTime: "2026-09-01T10:00:00Z" } },
    ...Array.from({ length: 10 }, (_, index) => ({ summary: `Overflow ${index}`, start: { date: "2026-09-05" }, end: { date: "2026-09-06" } })),
  ];
  const fx = clientFixture({ items });
  const credentials = { access_token: "expired-access", refresh_token: "durable-refresh", expiry_date: 0 };
  const result = await readUpcomingGoogleCalendarEvents({ credentials, now: fixedNow, createApiClients: fx.createApiClients });
  assert.equal(fx.observed.credentials, credentials);
  assert.equal(fx.observed.calls.length, 1);
  assert.deepEqual(fx.observed.calls[0], {
    params: {
      calendarId: "primary",
      timeMin: "2026-08-31T12:00:00.000Z",
      timeMax: "2026-09-30T12:00:00.000Z",
      maxResults: 10,
      singleEvents: true,
      orderBy: "startTime",
      showDeleted: false,
      fields: "items(summary,start,end,hangoutLink,conferenceData(entryPoints(entryPointType,uri)))",
    },
    options: { timeout: 10_000 },
  });
  assert.equal(result.connected, true);
  assert.equal(result.events.length, 9);
  assert.deepEqual(result.events[0], {
    title: "Planning Review",
    start: { kind: "dateTime", value: "2026-09-01T13:00:00.000Z" },
    end: { kind: "dateTime", value: "2026-09-01T13:30:00.000Z" },
    allDay: false,
    joinUrl: null,
  });
  assert.equal(result.events[1].title, null);
  assert.equal(result.events[1].allDay, true);
  assert.doesNotMatch(JSON.stringify(result), /private detail|hidden@example|meet\.example|raw-provider-id|description|attendees/i);
});

test("upcoming Calendar exposes only approved meeting join hosts", async () => {
  const fx = clientFixture({
    items: [{
      summary: "Candidate call",
      start: { dateTime: "2026-09-01T09:00:00-04:00" },
      end: { dateTime: "2026-09-01T09:30:00-04:00" },
      hangoutLink: "https://meet.google.com/abc-defg-hij",
    }],
  });
  const result = await readUpcomingGoogleCalendarEvents({
    credentials: { refresh_token: "durable-refresh" },
    now: fixedNow,
    createApiClients: fx.createApiClients,
  });
  assert.equal(result.events[0].joinUrl, "https://meet.google.com/abc-defg-hij");
});

test("empty Calendar is connected and a refreshed token is persisted before success", async () => {
  const fx = clientFixture({ items: [], refreshedTokens: { access_token: "new-access", expiry_date: 1_788_200_000_000 } });
  let persisted = false;
  const result = await readUpcomingGoogleCalendarEvents({
    credentials: { refresh_token: "durable-refresh" },
    now: fixedNow,
    createApiClients: fx.createApiClients,
    async persistRefresh(tokens) {
      assert.deepEqual(tokens, { access_token: "new-access", expiry_date: 1_788_200_000_000 });
      await Promise.resolve();
      persisted = true;
    },
  });
  assert.equal(persisted, true);
  assert.deepEqual(result.events, []);
});

test("captured refresh is awaited even when the later provider call fails", async () => {
  const fx = clientFixture({ providerFailure: new Error("hidden provider response"), refreshedTokens: { access_token: "new-access", refresh_token: "new-refresh" } });
  let persisted = false;
  await assert.rejects(() => readUpcomingGoogleCalendarEvents({
    credentials: { refresh_token: "old-refresh" },
    now: fixedNow,
    createApiClients: fx.createApiClients,
    async persistRefresh(tokens) {
      assert.equal(tokens.refresh_token, "new-refresh");
      persisted = true;
    },
  }), /hidden provider response/);
  assert.equal(persisted, true);
});
