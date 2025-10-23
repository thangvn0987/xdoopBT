-- Sessions table to store AI level test and other session results

CREATE TABLE IF NOT EXISTS sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    topic TEXT,
    transcript TEXT,
    ai_score NUMERIC CHECK (ai_score >= 0 AND ai_score <= 100),
    grammar_feedback JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_time
    ON sessions (user_id, created_at DESC);
