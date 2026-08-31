CREATE TABLE google_oauth_states (
  state_hash bytea PRIMARY KEY CHECK (octet_length(state_hash) = 32),
  account_id text NOT NULL,
  session_id text NOT NULL,
  initiating_email_hash bytea NOT NULL CHECK (octet_length(initiating_email_hash) = 32),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX google_oauth_states_session_idx
  ON google_oauth_states (account_id, session_id);

CREATE INDEX google_oauth_states_expires_at_idx
  ON google_oauth_states (expires_at);

ALTER TABLE google_oauth_credentials
  ADD COLUMN generation uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);
