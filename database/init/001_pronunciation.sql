-- Create table for storing per-session pronunciation scores
-- This runs on initial Postgres init (new volume). Services also ensure at runtime.

CREATE TABLE IF NOT EXISTS pronunciation_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    score NUMERIC NOT NULL CHECK (score >= 0 AND score <= 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helpful index for queries by user and recency
CREATE INDEX IF NOT EXISTS idx_pronunciation_sessions_user_time
    ON pronunciation_sessions (user_id, created_at DESC);
