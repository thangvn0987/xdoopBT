-- Conversation sessions and turns for lesson chat

CREATE TABLE IF NOT EXISTS ConversationSessions (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    lesson_id INT NOT NULL REFERENCES PracticeLessons(lesson_id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('scripted','ai-only')),
    target_learner_turns INT NOT NULL DEFAULT 4,
    status TEXT NOT NULL DEFAULT 'active', -- active|completed|abandoned
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    final_score REAL
);

CREATE INDEX IF NOT EXISTS idx_conv_sessions_user ON ConversationSessions(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_sessions_lesson ON ConversationSessions(lesson_id);

CREATE TABLE IF NOT EXISTS ConversationTurns (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES ConversationSessions(id) ON DELETE CASCADE,
    turn_index INT NOT NULL, -- 0-based across the whole session
    role TEXT NOT NULL CHECK (role IN ('ai','learner')),
    text TEXT,
    tts_path TEXT, -- path relative to pronunciation service (e.g., /uploads/xyz.mp3)
    scores JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_turns_session ON ConversationTurns(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conv_turns_session_index ON ConversationTurns(session_id, turn_index);
