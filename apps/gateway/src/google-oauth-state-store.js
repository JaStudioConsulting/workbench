import { createHash } from "node:crypto";

const MAX_BINDING_LENGTH = 255;

function safeError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validBinding(value, field) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > MAX_BINDING_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw safeError("GOOGLE_OAUTH_STATE_INPUT_INVALID", `Google OAuth ${field} is invalid`);
  }
  return value;
}

function validState(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 512 || !/^[A-Za-z0-9._~-]+$/.test(value)) {
    throw safeError("GOOGLE_OAUTH_STATE_INPUT_INVALID", "Google OAuth state is invalid");
  }
  return value;
}

export function hashGoogleOAuthValue(value) {
  return createHash("sha256").update(validState(value), "utf8").digest();
}

export function hashGoogleOAuthEmail(value) {
  if (typeof value !== "string" || !value.trim()) throw safeError("GOOGLE_OAUTH_STATE_INPUT_INVALID", "Google OAuth email is invalid");
  return createHash("sha256").update(value.trim().toLowerCase(), "utf8").digest();
}

export function createGoogleOAuthStateStore({ pool } = {}) {
  if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function") {
    throw safeError("GOOGLE_OAUTH_STATE_NOT_CONFIGURED", "Google OAuth state storage is not configured");
  }

  return Object.freeze({
    kind: "durable_google_oauth_state",

    async create({ state, accountId, sessionId, initiatingEmail } = {}) {
      const stateHash = hashGoogleOAuthValue(state);
      const emailHash = hashGoogleOAuthEmail(initiatingEmail);
      const safeAccountId = validBinding(accountId, "account");
      const safeSessionId = validBinding(sessionId, "session");
      const client = await pool.connect().catch(() => { throw safeError("GOOGLE_OAUTH_STATE_UNAVAILABLE", "Google OAuth state storage is unavailable"); });
      let transactionStarted = false;
      try {
        await client.query("BEGIN");
        transactionStarted = true;
        await client.query(
          "DELETE FROM google_oauth_states WHERE expires_at <= now() OR (account_id = $1 AND session_id = $2)",
          [safeAccountId, safeSessionId],
        );
        const result = await client.query(
          `INSERT INTO google_oauth_states
            (state_hash, account_id, session_id, initiating_email_hash, expires_at)
           VALUES ($1, $2, $3, $4, now() + interval '10 minutes')
           RETURNING expires_at`,
          [stateHash, safeAccountId, safeSessionId, emailHash],
        );
        await client.query("COMMIT");
        transactionStarted = false;
        if (!result.rows[0]?.expires_at) throw safeError("GOOGLE_OAUTH_STATE_UNAVAILABLE", "Google OAuth state storage is unavailable");
        return Object.freeze({ expiresAt: result.rows[0].expires_at });
      } catch {
        if (transactionStarted) await client.query("ROLLBACK").catch(() => {});
        throw safeError("GOOGLE_OAUTH_STATE_UNAVAILABLE", "Google OAuth state storage is unavailable");
      } finally {
        client.release();
      }
    },

    async consume({ state, accountId, sessionId, initiatingEmail } = {}) {
      const values = [
        hashGoogleOAuthValue(state),
        validBinding(accountId, "account"),
        validBinding(sessionId, "session"),
        hashGoogleOAuthEmail(initiatingEmail),
      ];
      try {
        const result = await pool.query(
          `DELETE FROM google_oauth_states
           WHERE state_hash = $1
             AND account_id = $2
             AND session_id = $3
             AND initiating_email_hash = $4
             AND expires_at > now()
           RETURNING expires_at`,
          values,
        );
        if (!result.rows[0]) return null;
        return Object.freeze({ consumed: true, expiresAt: result.rows[0].expires_at });
      } catch (error) {
        if (error?.code === "GOOGLE_OAUTH_STATE_INPUT_INVALID") throw error;
        throw safeError("GOOGLE_OAUTH_STATE_UNAVAILABLE", "Google OAuth state storage is unavailable");
      }
    },
  });
}
