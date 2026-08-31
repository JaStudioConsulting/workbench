import assert from "node:assert/strict";
import test from "node:test";
import {
  GoogleWorkspaceClientError,
  disconnectGoogleWorkspace,
  getGoogleWorkspaceStatus,
  getUpcomingGoogleCalendar,
  startGoogleWorkspaceConnection,
  validateGoogleAuthorizationUrl,
} from "../src/google-workspace-client.js";

const baseURL = "https://workbench.example";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("status uses the authenticated same-origin route and validates disconnected state", async () => {
  let request;
  const status = await getGoogleWorkspaceStatus({
    baseURL,
    fetchImpl: async (url, options) => {
      request = { url: url.toString(), options };
      return jsonResponse({ connected: false });
    },
  });

  assert.deepEqual(status, { connected: false });
  assert.equal(request.url, `${baseURL}/api/google-workspace/status`);
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.credentials, "include");
  assert.equal(request.options.cache, "no-store");
});

test("start and disconnect use POST without accepting an injected live connection claim", async () => {
  const methods = [];
  const start = await startGoogleWorkspaceConnection({
    baseURL,
    fetchImpl: async (_url, options) => {
      methods.push(options.method);
      return jsonResponse({
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=example",
        expiresAt: "2026-08-31T16:00:00.000Z",
      });
    },
  });

  const disconnected = await disconnectGoogleWorkspace({
    baseURL,
    fetchImpl: async (_url, options) => {
      methods.push(options.method);
      return jsonResponse({ connected: false });
    },
  });

  assert.equal(start.authorizationUrl.startsWith("https://accounts.google.com/"), true);
  assert.deepEqual(disconnected, { connected: false });
  assert.deepEqual(methods, ["POST", "POST"]);

  await assert.rejects(
    getGoogleWorkspaceStatus({
      baseURL,
      fetchImpl: async () => jsonResponse({ connected: false, accessToken: "must-not-pass" }),
    }),
    (error) => error instanceof GoogleWorkspaceClientError && error.code === "INVALID_GOOGLE_WORKSPACE_RESPONSE",
  );
});

test("upcoming Calendar accepts only the bounded shared response contract", async () => {
  const result = await getUpcomingGoogleCalendar({
    baseURL,
    fetchImpl: async () => jsonResponse({
      connected: true,
      range: {
        from: "2026-08-31T12:00:00.000Z",
        to: "2026-09-07T12:00:00.000Z",
      },
      events: [{
        title: null,
        start: { kind: "date", value: "2026-09-01" },
        end: { kind: "date", value: "2026-09-02" },
        allDay: true,
      }],
    }),
  });

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, null);

  const elevenEvents = Array.from({ length: 11 }, (_, index) => ({
    title: `Event ${index}`,
    start: { kind: "date", value: "2026-09-01" },
    end: { kind: "date", value: "2026-09-02" },
    allDay: true,
  }));
  await assert.rejects(
    getUpcomingGoogleCalendar({
      baseURL,
      fetchImpl: async () => jsonResponse({
        connected: true,
        range: { from: "2026-08-31T12:00:00.000Z", to: "2026-09-07T12:00:00.000Z" },
        events: elevenEvents,
      }),
    }),
    (error) => error.code === "INVALID_GOOGLE_WORKSPACE_RESPONSE",
  );
});

test("authorization redirects are restricted to the expected Google endpoint", () => {
  const valid = "https://accounts.google.com/o/oauth2/v2/auth?client_id=example&state=opaque";
  assert.equal(validateGoogleAuthorizationUrl(valid), valid);
  assert.throws(
    () => validateGoogleAuthorizationUrl("https://accounts.google.com.evil.example/o/oauth2/v2/auth"),
    /could not be opened/,
  );
  assert.throws(
    () => validateGoogleAuthorizationUrl("https://accounts.google.com/ServiceLogin"),
    /could not be opened/,
  );
});

test("401, 403, and unavailable errors remain machine-readable without exposing response details", async () => {
  for (const status of [401, 403, 503]) {
    await assert.rejects(
      getGoogleWorkspaceStatus({
        baseURL,
        fetchImpl: async () => jsonResponse({ error: { code: `STATUS_${status}`, message: "sensitive detail" } }, status),
      }),
      (error) => {
        assert.equal(error.status, status);
        assert.equal(error.code, `STATUS_${status}`);
        assert.doesNotMatch(error.message, /sensitive detail/);
        return true;
      },
    );
  }
});
