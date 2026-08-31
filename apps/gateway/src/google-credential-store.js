import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

const PROVIDER = "google";
const KEY_VERSION = 1;
const CREDENTIAL_VERSION = 1;
const MAX_ACCOUNT_ID_LENGTH = 255;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeError(code, message) {
  return Object.assign(new Error(message), { code });
}

function parseEncryptionKey(value) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw safeError("CREDENTIAL_STORE_NOT_CONFIGURED", "Google credential storage is not configured");
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) {
    throw safeError("CREDENTIAL_STORE_NOT_CONFIGURED", "Google credential storage is not configured");
  }
  return key;
}

function validAccountId(value) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > MAX_ACCOUNT_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw safeError("CREDENTIAL_INPUT_INVALID", "Google credential account is invalid");
  }
  return value;
}

function validGeneration(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw safeError("CREDENTIAL_INPUT_INVALID", "Google credential generation is invalid");
  }
  return value.toLowerCase();
}

function optionalToken(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw safeError("CREDENTIAL_INPUT_INVALID", `Google credential ${field} is invalid`);
  }
  return value;
}

function normalizedScopes(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((scope) => typeof scope !== "string" || !scope || scope !== scope.trim() || scope.length > 512)) {
    throw safeError("CREDENTIAL_INPUT_INVALID", "Google credential scopes are invalid");
  }
  return [...new Set(value)].sort();
}

function normalizedExpiry(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw safeError("CREDENTIAL_INPUT_INVALID", "Google credential expiry is invalid");
  return date;
}

function aadFor(accountId) {
  return Buffer.from(`workbench:google-oauth:v1:${accountId}:${PROVIDER}`, "utf8");
}

function encryptPayload({ accountId, payload, key, randomBytesFn }) {
  const iv = randomBytesFn(12);
  if (!Buffer.isBuffer(iv) || iv.length !== 12) throw safeError("CREDENTIAL_STORE_UNAVAILABLE", "Google credential storage is unavailable");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadFor(accountId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

function decryptPayload({ accountId, row, key }) {
  try {
    if (Number(row.key_version) !== KEY_VERSION || Number(row.credential_version) !== CREDENTIAL_VERSION) throw new Error("unsupported version");
    const decipher = createDecipheriv("aes-256-gcm", key, row.iv);
    decipher.setAAD(aadFor(accountId));
    decipher.setAuthTag(row.auth_tag);
    const payload = JSON.parse(Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8"));
    if (payload?.version !== CREDENTIAL_VERSION || typeof payload.refreshToken !== "string" || !payload.refreshToken) throw new Error("invalid payload");
    return payload;
  } catch {
    throw safeError("CREDENTIAL_DECRYPTION_FAILED", "Google credentials could not be decrypted");
  }
}

function safeStatus(row) {
  if (!row) return Object.freeze({ connected: false });
  return Object.freeze({
    connected: true,
    scopes: Object.freeze([...(row.scopes || [])]),
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  });
}

export function createGoogleCredentialStore({ pool, encryptionKey, randomBytesFn = randomBytes, randomUuidFn = randomUUID } = {}) {
  const key = parseEncryptionKey(encryptionKey);
  if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function") {
    throw safeError("CREDENTIAL_STORE_NOT_CONFIGURED", "Google credential storage is not configured");
  }

  return Object.freeze({
    kind: "durable_google_credentials",

    async save({ accountId: rawAccountId, credentials, scopes, expiresAt } = {}) {
      const accountId = validAccountId(rawAccountId);
      const generation = validGeneration(randomUuidFn());
      if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) throw safeError("CREDENTIAL_INPUT_INVALID", "Google credentials are invalid");
      const incoming = {
        accessToken: optionalToken(credentials.access_token, "access token"),
        refreshToken: optionalToken(credentials.refresh_token, "refresh token"),
        tokenType: optionalToken(credentials.token_type, "token type") || "Bearer",
      };
      const safeScopes = normalizedScopes(scopes);
      const safeExpiry = normalizedExpiry(expiresAt);
      const client = await pool.connect().catch(() => { throw safeError("CREDENTIAL_STORE_UNAVAILABLE", "Google credential storage is unavailable"); });
      let transactionStarted = false;
      try {
        await client.query("BEGIN");
        transactionStarted = true;
        const existingResult = await client.query(
          "SELECT ciphertext, iv, auth_tag, key_version, credential_version, scopes, expires_at, revision FROM google_oauth_credentials WHERE account_id = $1 AND provider = $2 FOR UPDATE",
          [accountId, PROVIDER],
        );
        const existing = existingResult.rows[0] ? decryptPayload({ accountId, row: existingResult.rows[0], key }) : null;
        const refreshToken = incoming.refreshToken || existing?.refreshToken;
        if (!refreshToken) throw safeError("REFRESH_TOKEN_REQUIRED", "Google authorization did not provide a durable refresh token");
        const persistedScopes = safeScopes ?? existingResult.rows[0]?.scopes ?? [];
        const persistedExpiry = safeExpiry === undefined ? existingResult.rows[0]?.expires_at ?? null : safeExpiry;
        const payload = {
          version: CREDENTIAL_VERSION,
          accessToken: incoming.accessToken || existing?.accessToken || null,
          refreshToken,
          tokenType: incoming.tokenType || existing?.tokenType || "Bearer",
        };
        const encrypted = encryptPayload({ accountId, payload, key, randomBytesFn });
        const result = await client.query(
          `INSERT INTO google_oauth_credentials
            (account_id, provider, ciphertext, iv, auth_tag, key_version, credential_version, generation, scopes, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (account_id, provider) DO UPDATE SET
             ciphertext = EXCLUDED.ciphertext,
             iv = EXCLUDED.iv,
             auth_tag = EXCLUDED.auth_tag,
             key_version = EXCLUDED.key_version,
             credential_version = EXCLUDED.credential_version,
             generation = EXCLUDED.generation,
             scopes = EXCLUDED.scopes,
             expires_at = EXCLUDED.expires_at,
             revision = google_oauth_credentials.revision + 1,
             updated_at = now()
           RETURNING generation, scopes, expires_at, created_at, updated_at, revision`,
          [accountId, PROVIDER, encrypted.ciphertext, encrypted.iv, encrypted.authTag, KEY_VERSION, CREDENTIAL_VERSION, generation, persistedScopes, persistedExpiry],
        );
        await client.query("COMMIT");
        transactionStarted = false;
        return safeStatus(result.rows[0]);
      } catch (error) {
        if (transactionStarted) await client.query("ROLLBACK").catch(() => {});
        if (error?.code && ["CREDENTIAL_INPUT_INVALID", "REFRESH_TOKEN_REQUIRED", "CREDENTIAL_DECRYPTION_FAILED"].includes(error.code)) throw error;
        throw safeError("CREDENTIAL_STORE_UNAVAILABLE", "Google credential storage is unavailable");
      } finally {
        client.release();
      }
    },

    async persistRefresh(rawAccountId, { generation: rawGeneration, revision, credentials } = {}) {
      const accountId = validAccountId(rawAccountId);
      const generation = validGeneration(rawGeneration);
      if (!Number.isSafeInteger(revision) || revision < 1) throw safeError("CREDENTIAL_INPUT_INVALID", "Google credential revision is invalid");
      if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) throw safeError("CREDENTIAL_INPUT_INVALID", "Google refreshed credentials are invalid");
      const incoming = {
        accessToken: optionalToken(credentials.access_token, "access token"),
        refreshToken: optionalToken(credentials.refresh_token, "refresh token"),
        tokenType: optionalToken(credentials.token_type, "token type"),
      };
      const safeExpiry = normalizedExpiry(credentials.expiry_date);
      if (!incoming.accessToken && !incoming.refreshToken && !incoming.tokenType && safeExpiry === undefined) {
        throw safeError("CREDENTIAL_INPUT_INVALID", "Google refreshed credentials are empty");
      }
      const client = await pool.connect().catch(() => { throw safeError("CREDENTIAL_STORE_UNAVAILABLE", "Google credential storage is unavailable"); });
      let transactionStarted = false;
      try {
        await client.query("BEGIN");
        transactionStarted = true;
        const existingResult = await client.query(
          "SELECT ciphertext, iv, auth_tag, key_version, credential_version, generation, scopes, expires_at, revision FROM google_oauth_credentials WHERE account_id = $1 AND provider = $2 AND generation = $3 AND revision = $4 FOR UPDATE",
          [accountId, PROVIDER, generation, revision],
        );
        if (!existingResult.rows[0]) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return Object.freeze({ persisted: false });
        }
        const existing = decryptPayload({ accountId, row: existingResult.rows[0], key });
        const payload = {
          version: CREDENTIAL_VERSION,
          accessToken: incoming.accessToken || existing.accessToken || null,
          refreshToken: incoming.refreshToken || existing.refreshToken,
          tokenType: incoming.tokenType || existing.tokenType || "Bearer",
        };
        const encrypted = encryptPayload({ accountId, payload, key, randomBytesFn });
        const result = await client.query(
          `UPDATE google_oauth_credentials SET
             ciphertext = $5,
             iv = $6,
             auth_tag = $7,
             key_version = $8,
             credential_version = $9,
             expires_at = $10,
             revision = revision + 1,
             updated_at = now()
           WHERE account_id = $1 AND provider = $2 AND generation = $3 AND revision = $4
           RETURNING generation, scopes, expires_at, created_at, updated_at, revision`,
          [accountId, PROVIDER, generation, revision, encrypted.ciphertext, encrypted.iv, encrypted.authTag, KEY_VERSION, CREDENTIAL_VERSION, safeExpiry === undefined ? existingResult.rows[0].expires_at ?? null : safeExpiry],
        );
        if (!result.rows[0]) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return Object.freeze({ persisted: false });
        }
        await client.query("COMMIT");
        transactionStarted = false;
        return Object.freeze({ persisted: true, revision: Number(result.rows[0].revision) });
      } catch (error) {
        if (transactionStarted) await client.query("ROLLBACK").catch(() => {});
        if (error?.code && ["CREDENTIAL_INPUT_INVALID", "CREDENTIAL_DECRYPTION_FAILED"].includes(error.code)) throw error;
        throw safeError("CREDENTIAL_STORE_UNAVAILABLE", "Google credential storage is unavailable");
      } finally {
        client.release();
      }
    },

    async load(rawAccountId) {
      const accountId = validAccountId(rawAccountId);
      let result;
      try {
        result = await pool.query(
          "SELECT ciphertext, iv, auth_tag, key_version, credential_version, generation, scopes, expires_at, created_at, updated_at, revision FROM google_oauth_credentials WHERE account_id = $1 AND provider = $2",
          [accountId, PROVIDER],
        );
      } catch { throw safeError("CREDENTIAL_STORE_UNAVAILABLE", "Google credential storage is unavailable"); }
      if (!result.rows[0]) return null;
      const payload = decryptPayload({ accountId, row: result.rows[0], key });
      return Object.freeze({
        credentials: Object.freeze({ access_token: payload.accessToken, refresh_token: payload.refreshToken, token_type: payload.tokenType }),
        generation: validGeneration(result.rows[0].generation),
        revision: Number(result.rows[0].revision),
        ...safeStatus(result.rows[0]),
      });
    },

    async status(rawAccountId) {
      const accountId = validAccountId(rawAccountId);
      try {
        const result = await pool.query(
          "SELECT scopes, expires_at, created_at, updated_at FROM google_oauth_credentials WHERE account_id = $1 AND provider = $2",
          [accountId, PROVIDER],
        );
        return safeStatus(result.rows[0]);
      } catch { throw safeError("CREDENTIAL_STORE_UNAVAILABLE", "Google credential storage is unavailable"); }
    },

    async disconnect(rawAccountId, { generation: rawGeneration, revision } = {}) {
      const accountId = validAccountId(rawAccountId);
      const revisionBound = rawGeneration !== undefined || revision !== undefined;
      const generation = revisionBound ? validGeneration(rawGeneration) : undefined;
      if (revisionBound && (!Number.isSafeInteger(revision) || revision < 1)) throw safeError("CREDENTIAL_INPUT_INVALID", "Google credential revision is invalid");
      try {
        const result = !revisionBound
          ? await pool.query("DELETE FROM google_oauth_credentials WHERE account_id = $1 AND provider = $2", [accountId, PROVIDER])
          : await pool.query("DELETE FROM google_oauth_credentials WHERE account_id = $1 AND provider = $2 AND generation = $3 AND revision = $4", [accountId, PROVIDER, generation, revision]);
        return Object.freeze({ disconnected: result.rowCount > 0 });
      } catch { throw safeError("CREDENTIAL_STORE_UNAVAILABLE", "Google credential storage is unavailable"); }
    },
  });
}
