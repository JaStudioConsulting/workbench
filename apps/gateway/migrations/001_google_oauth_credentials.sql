CREATE TABLE google_oauth_credentials (
  account_id text NOT NULL,
  provider text NOT NULL CHECK (provider = 'google'),
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL CHECK (octet_length(iv) = 12),
  auth_tag bytea NOT NULL CHECK (octet_length(auth_tag) = 16),
  key_version smallint NOT NULL DEFAULT 1 CHECK (key_version > 0),
  credential_version smallint NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, provider)
);

CREATE INDEX google_oauth_credentials_expires_at_idx
  ON google_oauth_credentials (expires_at);
