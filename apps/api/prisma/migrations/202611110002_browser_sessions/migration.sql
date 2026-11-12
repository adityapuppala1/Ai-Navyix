-- Additive, dedicated session schema; no customer workflow tables are changed.
-- The browser process uses navyix_browser, never navyix_app or the migration owner.
CREATE SCHEMA browser_auth;
REVOKE ALL ON SCHEMA browser_auth FROM PUBLIC;
CREATE TABLE browser_auth.login_transactions (
  id_hash text PRIMARY KEY CHECK (id_hash ~ '^[0-9a-f]{64}$'),
  sealed text NOT NULL CHECK (octet_length(sealed) <= 32768),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX login_transaction_expiry ON browser_auth.login_transactions(expires_at);
CREATE TABLE browser_auth.sessions (
  id_hash text PRIMARY KEY CHECK (id_hash ~ '^[0-9a-f]{64}$'),
  sealed text NOT NULL CHECK (octet_length(sealed) <= 32768),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  idle_until timestamptz NOT NULL CHECK (idle_until <= expires_at)
);
CREATE INDEX session_expiry ON browser_auth.sessions(expires_at);
CREATE INDEX session_idle_expiry ON browser_auth.sessions(idle_until);
REVOKE ALL ON ALL TABLES IN SCHEMA browser_auth FROM PUBLIC;
GRANT USAGE ON SCHEMA browser_auth TO navyix_browser;
GRANT SELECT, INSERT, DELETE ON browser_auth.login_transactions TO navyix_browser;
GRANT SELECT, INSERT, DELETE ON browser_auth.sessions TO navyix_browser;
GRANT UPDATE(idle_until) ON browser_auth.sessions TO navyix_browser;
-- Session rows are keyed by hashes of unguessable cookies, not customer-provided tenant IDs.
-- This dedicated login has no access to the public application's tables, roles or schema DDL.
-- RLS on customer workflow tables remains unchanged. Session records are NOT an audit history.
