# Authentication configuration

Authentication is intentionally unavailable unless every setting below is supplied at runtime by the deployment platform:

- `DATABASE_URL` - hosted PostgreSQL connection string.
- `BETTER_AUTH_SECRET` - deployment secret of at least 32 characters, never committed.
- `BETTER_AUTH_URL` - HTTPS gateway URL.
- `AUTH_TRUSTED_ORIGINS` - comma-separated exact HTTPS origins, including the auth URL origin. No paths, credentials, query strings, fragments, or wildcards are accepted.
- `APP_TRUSTED_ORIGINS` - exact HTTPS browser origins for a separately deployed console. It falls back to `AUTH_TRUSTED_ORIGINS` only when not set.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` - Google OAuth credentials managed in the host secret store.
- `AUTH_ALLOWED_GOOGLE_EMAILS` - comma-separated deployment allowlist for the approved Workbench Google accounts. Keep the real addresses in the host configuration, not in source code.
- `GOOGLE_TOKEN_ENCRYPTION_KEY` - canonical base64 encoding of exactly 32 random bytes, stored only in the deployment secret manager. Losing this key makes stored Google credentials unrecoverable.
- `GOOGLE_WORKSPACE_CLIENT_ID` and `GOOGLE_WORKSPACE_CLIENT_SECRET` - the server-side Google Workspace OAuth web client. These may not be exposed to the console.
- `GOOGLE_WORKSPACE_REDIRECT_URI` - the exact HTTPS callback registered for `GET /api/google-workspace/oauth/callback`.
- `GOOGLE_WORKSPACE_RETURN_URI` - one fixed HTTPS Settings page under an approved application origin. Callback callers cannot override it.

The gateway uses Better Auth's Express `toNodeHandler` route before JSON parsing, mounts `/api/auth/*`, obtains sessions through the official `fromNodeHeaders` path, uses its Google provider, validates new and returning OAuth users against the deployment allowlist, provides the PostgreSQL pool only from `DATABASE_URL`, and forces secure cookies. Missing, malformed, wildcard, short-secret, allowlist, or inconsistent configuration returns a 503 `AUTH_UNAVAILABLE` response. A valid session from an unapproved account receives 403. No custom JWT fallback is implemented.

Browser requests from an allowed origin receive credentialed CORS for `GET`, `POST`, and `OPTIONS` only. The MCP session header is exposed. Disallowed browser origins receive 403; non-browser service requests without an `Origin` header are allowed to proceed to their normal route gate.

Run Better Auth schema migration only against a separately approved hosted database. This migration task does not create a database or execute an auth migration.

Run `apps/gateway/migrations/001_google_oauth_credentials.sql` and `002_google_oauth_states.sql` only against the separately approved hosted PostgreSQL database. Credentials are AES-256-GCM ciphertext keyed by the opaque Better Auth user ID. OAuth state and the initiating email are stored only as SHA-256 hashes with a ten-minute expiry, bound to the initiating Better Auth user and session, and consumed atomically. Neither migration stores email, OAuth state, authorization code, access token, refresh token, ID token, or client secret in plaintext. The routes reuse Better Auth's existing PostgreSQL pool.

The authenticated Google Workspace surface is limited to:

- `GET /api/google-workspace/status`
- `POST /api/google-workspace/oauth/start`
- `GET /api/google-workspace/oauth/callback`
- `POST /api/google-workspace/disconnect`

The first authorization is fixed server-side to identity plus `calendar.readonly`; the browser cannot request stages or scopes. Callback identity must be verified, approved, and exactly match the Better Auth account that started authorization. Status and errors use `Cache-Control: private, no-store` and never return credentials. Disconnect revokes the durable Google grant before deleting the matching credential revision; retryable revocation failures preserve the encrypted credential for a safe retry.
