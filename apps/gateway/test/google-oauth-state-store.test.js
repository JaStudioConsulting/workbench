import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createGoogleOAuthStateStore } from "../src/google-oauth-state-store.js";

const accountKey = "synthetic-user-a";
const sessionKey = "synthetic-session-a";
const reviewEmail = "review@example.invalid";
const stateValue = "synthetic_state_value_1234567890_abcdef";

class FakeStatePool {
  constructor() {
    this.rows = new Map();
    this.commands = [];
    this.fail = false;
    this.now = new Date("2026-08-31T12:00:00.000Z");
  }

  key(buffer) { return Buffer.from(buffer).toString("hex"); }

  async connect() {
    const pool = this;
    return {
      async query(sql, values = []) {
        pool.commands.push({ sql, values });
        if (pool.fail) throw new Error("synthetic database detail");
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.startsWith("DELETE")) {
          for (const [key, row] of pool.rows) {
            if (row.expires_at <= pool.now || (row.account_id === values[0] && row.session_id === values[1])) pool.rows.delete(key);
          }
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith("INSERT")) {
          const row = {
            state_hash: values[0], account_id: values[1], session_id: values[2], initiating_email_hash: values[3], expires_at: new Date(pool.now.getTime() + 600_000),
          };
          pool.rows.set(pool.key(values[0]), row);
          return { rows: [{ expires_at: row.expires_at }], rowCount: 1 };
        }
        throw new Error("unexpected query");
      },
      release() { pool.commands.push({ sql: "RELEASE", values: [] }); },
    };
  }

  async query(sql, values) {
    this.commands.push({ sql, values });
    if (this.fail) throw new Error("synthetic database detail");
    const key = this.key(values[0]);
    const row = this.rows.get(key);
    const matches = row
      && row.account_id === values[1]
      && row.session_id === values[2]
      && Buffer.compare(row.initiating_email_hash, values[3]) === 0
      && row.expires_at > this.now;
    if (!matches) return { rows: [], rowCount: 0 };
    this.rows.delete(key);
    return { rows: [{ expires_at: row.expires_at }], rowCount: 1 };
  }
}

function binding(overrides = {}) {
  return { state: stateValue, accountId: accountKey, sessionId: sessionKey, initiatingEmail: reviewEmail, ...overrides };
}

test("OAuth state is stored as one-time hashes bound to account, session, and email", async () => {
  const pool = new FakeStatePool();
  const store = createGoogleOAuthStateStore({ pool });
  const created = await store.create(binding());
  const [row] = pool.rows.values();
  assert.equal(row.state_hash.length, 32);
  assert.equal(row.initiating_email_hash.length, 32);
  assert.doesNotMatch(JSON.stringify(pool.commands), new RegExp(stateValue));
  assert.doesNotMatch(JSON.stringify(pool.commands), new RegExp(reviewEmail));
  assert.equal(row.account_id, accountKey);
  assert.equal(row.session_id, sessionKey);
  assert.equal(created.expiresAt.toISOString(), "2026-08-31T12:10:00.000Z");
  assert.match(pool.commands.find(({ sql }) => sql.startsWith("INSERT")).sql, /now\(\) \+ interval '10 minutes'/);
});

test("wrong binding does not consume state, while the correct binding wins once", async () => {
  const pool = new FakeStatePool();
  const store = createGoogleOAuthStateStore({ pool });
  await store.create(binding());
  assert.equal(await store.consume(binding({ sessionId: "other-session" })), null);
  assert.equal(pool.rows.size, 1);
  assert.equal((await store.consume(binding())).consumed, true);
  assert.equal(await store.consume(binding()), null);
});

test("expired state and malformed state fail closed without database detail", async () => {
  const pool = new FakeStatePool();
  const store = createGoogleOAuthStateStore({ pool });
  await store.create(binding());
  pool.now = new Date("2026-08-31T12:10:00.001Z");
  assert.equal(await store.consume(binding()), null);
  const consumeSql = pool.commands.find(({ sql }) => sql.includes("AND expires_at >"))?.sql;
  assert.match(consumeSql, /expires_at > now\(\)/);
  assert.doesNotMatch(consumeSql, /\$5/);
  await assert.rejects(() => store.consume(binding({ state: "weak" })), { code: "GOOGLE_OAUTH_STATE_INPUT_INVALID" });
  pool.fail = true;
  await assert.rejects(() => store.consume(binding()), (error) => {
    assert.equal(error.code, "GOOGLE_OAUTH_STATE_UNAVAILABLE");
    assert.doesNotMatch(error.message, /synthetic database detail/);
    return true;
  });
});

test("state migration stores hashes and no authorization material", async () => {
  const sql = await readFile(new URL("../migrations/002_google_oauth_states.sql", import.meta.url), "utf8");
  assert.match(sql, /state_hash bytea PRIMARY KEY/i);
  assert.match(sql, /initiating_email_hash bytea/i);
  assert.doesNotMatch(sql, /authorization_code|access_token|refresh_token|id_token|client_secret/i);
});
