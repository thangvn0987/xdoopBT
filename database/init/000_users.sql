-- Users table to persist authenticated users

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,              -- app user id, e.g. 'google:<google_id>'
    provider TEXT NOT NULL,           -- 'google'
    provider_id TEXT NOT NULL,        -- raw provider user id
    email TEXT,
    name TEXT,
    avatar TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_providerid
  ON users (provider, provider_id);

CREATE INDEX IF NOT EXISTS idx_users_email
  ON users (email);
