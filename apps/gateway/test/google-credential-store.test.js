import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createGoogleCredentialStore } from "../src/google-credential-store.js";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const credentialsFor = (accountKey, credentials) => ({ accountId: accountKey, credentials });

class FakePool {
  constructor() {
    this.rows = new Map();
    this.commands = [];
    this.failUpsert = false;
  }

  key(accountId, provider) { return `${accountId}:${provider}`; }

  async connect() {
    const pool = this;
    return {
      async query(sql, values = []) {
        pool.commands.push({ sql, values });
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
        if (sql.includes("FOR UPDATE")) {
          const row = pool.rows.get(pool.key(values[0], values[1]));
          if (values.length === 4 && (row?.generation !== values[2] || row?.revision !== values[3])) return { rows: [], rowCount: 0 };
          return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }
        if (sql.startsWith("INSERT INTO")) {
          if (pool.failUpsert) throw new Error("synthetic database detail");
          const now = new Date("2026-08-31T00:00:00Z");
          const prior = pool.rows.get(pool.key(values[0], values[1]));
          const row = {
            account_id: values[0], provider: values[1], ciphertext: values[2], iv: values[3], auth_tag: values[4],
            key_version: values[5], credential_version: values[6], generation: values[7], scopes: values[8], expires_at: values[9],
            revision: (prior?.revision || 0) + 1,
            created_at: prior?.created_at || now, updated_at: now,
          };
          pool.rows.set(pool.key(values[0], values[1]), row);
          return { rows: [row], rowCount: 1 };
        }
        if (sql.startsWith("UPDATE google_oauth_credentials")) {
          const prior = pool.rows.get(pool.key(values[0], values[1]));
          if (!prior || prior.generation !== values[2] || prior.revision !== values[3]) return { rows: [], rowCount: 0 };
          const row = {
            ...prior,
            ciphertext: values[4], iv: values[5], auth_tag: values[6],
            key_version: values[7], credential_version: values[8], expires_at: values[9],
            revision: prior.revision + 1,
            updated_at: new Date("2026-08-31T00:00:01Z"),
          };
          pool.rows.set(pool.key(values[0], values[1]), row);
          return { rows: [row], rowCount: 1 };
        }
        throw new Error("unexpected client query");
      },
      release() { pool.commands.push({ sql: "RELEASE", values: [] }); },
    };
  }

  async query(sql, values = []) {
    this.commands.push({ sql, values });
    const key = this.key(values[0], values[1]);
    if (sql.startsWith("DELETE")) {
      if (values.length === 4 && (this.rows.get(key)?.generation !== values[2] || this.rows.get(key)?.revision !== values[3])) return { rows: [], rowCount: 0 };
      const existed = this.rows.delete(key);
      return { rows: [], rowCount: existed ? 1 : 0 };
    }
    if (sql.startsWith("SELECT")) {
      const row = this.rows.get(key);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    throw new Error("unexpected pool query");
  }
}

test("credential store configuration fails closed without exposing key material", () => {
  const pool = new FakePool();
  for (const value of [undefined, "", "not-base64", Buffer.alloc(31).toString("base64")]) {
    assert.throws(() => createGoogleCredentialStore({ pool, encryptionKey: value }), (error) => {
      assert.equal(error.code, "CREDENTIAL_STORE_NOT_CONFIGURED");
      assert.doesNotMatch(error.message, /not-base64|BwcH/);
      return true;
    });
  }
});

test("credentials are encrypted with unique IVs and status never exposes tokens", async () => {
  const pool = new FakePool();
  const store = createGoogleCredentialStore({ pool, encryptionKey });
  const input = { ...credentialsFor("synthetic-user-a", { access_token: "synthetic-access", refresh_token: "synthetic-refresh" }), scopes: ["calendar.readonly"], expiresAt: "2026-09-01T00:00:00Z" };
  await store.save(input);
  const first = structuredClone(pool.rows.get("synthetic-user-a:google"));
  await store.save(input);
  const second = pool.rows.get("synthetic-user-a:google");
  assert.notDeepEqual(first.iv, second.iv);
  assert.notDeepEqual(first.ciphertext, second.ciphertext);
  assert.doesNotMatch(JSON.stringify(pool.commands), /synthetic-access|synthetic-refresh/);
  const loaded = await store.load("synthetic-user-a");
  assert.deepEqual(loaded.credentials, { access_token: "synthetic-access", refresh_token: "synthetic-refresh", token_type: "Bearer" });
  assert.deepEqual(await store.status("synthetic-user-a"), { connected: true, scopes: ["calendar.readonly"], expiresAt: second.expires_at, createdAt: second.created_at, updatedAt: second.updated_at });
  assert.doesNotMatch(JSON.stringify(await store.status("synthetic-user-a")), /token|credential/i);
});

test("access-only refresh retains the durable refresh token and a new refresh token rotates it", async () => {
  const pool = new FakePool();
  const store = createGoogleCredentialStore({ pool, encryptionKey });
  await store.save({ ...credentialsFor("synthetic-user-a", { access_token: "access-1", refresh_token: "refresh-1" }), scopes: ["calendar.readonly"], expiresAt: "2026-09-01T00:00:00Z" });
  await store.save(credentialsFor("synthetic-user-a", { access_token: "access-2" }));
  assert.deepEqual((await store.load("synthetic-user-a")).credentials, { access_token: "access-2", refresh_token: "refresh-1", token_type: "Bearer" });
  assert.deepEqual(await store.status("synthetic-user-a"), {
    connected: true,
    scopes: ["calendar.readonly"],
    expiresAt: new Date("2026-09-01T00:00:00Z"),
    createdAt: new Date("2026-08-31T00:00:00Z"),
    updatedAt: new Date("2026-08-31T00:00:00Z"),
  });
  await store.save(credentialsFor("synthetic-user-a", { access_token: "access-3", refresh_token: "refresh-2" }));
  assert.deepEqual((await store.load("synthetic-user-a")).credentials, { access_token: "access-3", refresh_token: "refresh-2", token_type: "Bearer" });
  await assert.rejects(() => store.save(credentialsFor("synthetic-user-b", { access_token: "access-only" })), { code: "REFRESH_TOKEN_REQUIRED" });
  for (const token of [" ", "  \t", " refresh-with-spaces "]) {
    await assert.rejects(() => store.save(credentialsFor("synthetic-user-b", { refresh_token: token })), { code: "CREDENTIAL_INPUT_INVALID" });
  }
});

test("revision-bound refresh persists access changes without recreating a disconnected credential", async () => {
  const pool = new FakePool();
  const store = createGoogleCredentialStore({ pool, encryptionKey });
  await store.save({ ...credentialsFor("synthetic-user-a", { access_token: "access-1", refresh_token: "refresh-1" }), scopes: ["calendar.readonly"], expiresAt: 1 });
  let loaded = await store.load("synthetic-user-a");
  const persisted = await store.persistRefresh("synthetic-user-a", {
    generation: loaded.generation,
    revision: loaded.revision,
    credentials: { access_token: "access-2", expiry_date: 2 },
  });
  assert.equal(persisted.persisted, true);
  loaded = await store.load("synthetic-user-a");
  assert.deepEqual(loaded.credentials, { access_token: "access-2", refresh_token: "refresh-1", token_type: "Bearer" });
  assert.equal(loaded.expiresAt.getTime(), 2);
  const staleGeneration = loaded.generation;
  const staleRevision = loaded.revision;
  await store.disconnect("synthetic-user-a", { generation: staleGeneration, revision: staleRevision });
  assert.deepEqual(await store.persistRefresh("synthetic-user-a", { generation: staleGeneration, revision: staleRevision, credentials: { refresh_token: "refresh-2" } }), { persisted: false });
  assert.equal(await store.load("synthetic-user-a"), null);
  assert.equal(pool.commands.filter(({ sql }) => sql.startsWith("INSERT INTO")).length, 1);
});

test("revision-bound refresh rotates a returned refresh token and rejects stale revisions", async () => {
  const pool = new FakePool();
  const store = createGoogleCredentialStore({ pool, encryptionKey });
  await store.save(credentialsFor("synthetic-user-a", { access_token: "access-1", refresh_token: "refresh-1" }));
  const first = await store.load("synthetic-user-a");
  assert.equal((await store.persistRefresh("synthetic-user-a", { generation: first.generation, revision: first.revision, credentials: { access_token: "access-2", refresh_token: "refresh-2" } })).persisted, true);
  assert.deepEqual((await store.load("synthetic-user-a")).credentials, { access_token: "access-2", refresh_token: "refresh-2", token_type: "Bearer" });
  assert.deepEqual(await store.persistRefresh("synthetic-user-a", { generation: first.generation, revision: first.revision, credentials: { access_token: "stale-access" } }), { persisted: false });
  assert.equal((await store.load("synthetic-user-a")).credentials.access_token, "access-2");
});

test("disconnect and reconnect rejects a stale refresh from the prior credential generation", async () => {
  const pool = new FakePool();
  const store = createGoogleCredentialStore({ pool, encryptionKey });
  await store.save(credentialsFor("synthetic-user-a", { refresh_token: "old-refresh" }));
  const stale = await store.load("synthetic-user-a");
  assert.deepEqual(await store.disconnect("synthetic-user-a", { generation: stale.generation, revision: stale.revision }), { disconnected: true });

  await store.save(credentialsFor("synthetic-user-a", { refresh_token: "new-refresh" }));
  const reconnected = await store.load("synthetic-user-a");
  assert.equal(reconnected.revision, stale.revision);
  assert.notEqual(reconnected.generation, stale.generation);
  assert.deepEqual(await store.persistRefresh("synthetic-user-a", {
    generation: stale.generation,
    revision: stale.revision,
    credentials: { access_token: "stale-access", refresh_token: "stale-refresh" },
  }), { persisted: false });
  assert.deepEqual(await store.disconnect("synthetic-user-a", { generation: stale.generation, revision: stale.revision }), { disconnected: false });
  assert.deepEqual((await store.load("synthetic-user-a")).credentials, { access_token: null, refresh_token: "new-refresh", token_type: "Bearer" });
});

test("ciphertext is bound to one account and tampering fails safely", async () => {
  const pool = new FakePool();
  const store = createGoogleCredentialStore({ pool, encryptionKey });
  const otherAccountKey = "synthetic-user-b";
  await store.save(credentialsFor("synthetic-user-a", { refresh_token: "refresh-a" }));
  pool.rows.set(`${otherAccountKey}:google`, { ...pool.rows.get("synthetic-user-a:google"), account_id: otherAccountKey });
  await assert.rejects(() => store.load(otherAccountKey), { code: "CREDENTIAL_DECRYPTION_FAILED" });
  const row = pool.rows.get("synthetic-user-a:google");
  row.ciphertext = Buffer.from(row.ciphertext);
  row.ciphertext[0] ^= 1;
  await assert.rejects(() => store.load("synthetic-user-a"), (error) => {
    assert.equal(error.code, "CREDENTIAL_DECRYPTION_FAILED");
    assert.doesNotMatch(error.message, /refresh-a|authenticate|cipher/i);
    return true;
  });
});

test("failed writes roll back, release the client, and expose no database detail", async () => {
  const pool = new FakePool();
  pool.failUpsert = true;
  const store = createGoogleCredentialStore({ pool, encryptionKey });
  await assert.rejects(() => store.save(credentialsFor("synthetic-user-a", { refresh_token: "refresh-a" })), (error) => {
    assert.equal(error.code, "CREDENTIAL_STORE_UNAVAILABLE");
    assert.doesNotMatch(error.message, /synthetic database detail/);
    return true;
  });
  assert.deepEqual(pool.commands.filter(({ sql }) => ["BEGIN", "ROLLBACK", "RELEASE"].includes(sql)).map(({ sql }) => sql), ["BEGIN", "ROLLBACK", "RELEASE"]);
});

test("disconnect deletes only the requested account and is idempotent", async () => {
  const pool = new FakePool();
  const store = createGoogleCredentialStore({ pool, encryptionKey });
  await store.save(credentialsFor("synthetic-user-a", { refresh_token: "refresh-a" }));
  await store.save(credentialsFor("synthetic-user-b", { refresh_token: "refresh-b" }));
  assert.deepEqual(await store.disconnect("synthetic-user-a"), { disconnected: true });
  assert.deepEqual(await store.disconnect("synthetic-user-a"), { disconnected: false });
  assert.equal((await store.status("synthetic-user-b")).connected, true);
});

test("revision-bound disconnect cannot delete a newer credential", async () => {
  const pool = new FakePool();
  const store = createGoogleCredentialStore({ pool, encryptionKey });
  await store.save(credentialsFor("synthetic-user-a", { refresh_token: "refresh-a" }));
  const loaded = await store.load("synthetic-user-a");
  await store.save(credentialsFor("synthetic-user-a", { access_token: "new-access" }));
  assert.deepEqual(await store.disconnect("synthetic-user-a", { generation: loaded.generation, revision: loaded.revision }), { disconnected: false });
  assert.equal((await store.status("synthetic-user-a")).connected, true);
});

test("migration stores no plaintext tokens, client secrets, or email column", async () => {
  const sql = await readFile(new URL("../migrations/001_google_oauth_credentials.sql", import.meta.url), "utf8");
  assert.match(sql, /PRIMARY KEY \(account_id, provider\)/);
  assert.match(sql, /octet_length\(iv\) = 12/);
  assert.match(sql, /octet_length\(auth_tag\) = 16/);
  assert.doesNotMatch(sql, /access_token|refresh_token|id_token|client_secret|\bemail\b/i);
});

test("state migration adds optimistic credential revision without token columns", async () => {
  const sql = await readFile(new URL("../migrations/002_google_oauth_states.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN generation uuid NOT NULL DEFAULT gen_random_uuid\(\)/i);
  assert.match(sql, /ADD COLUMN revision bigint/i);
  assert.doesNotMatch(sql, /access_token|refresh_token|id_token|client_secret/i);
});
