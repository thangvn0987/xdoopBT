-- Learner profiles: goals and interests for each user
CREATE TABLE IF NOT EXISTS learner_profiles (
  user_id TEXT PRIMARY KEY,
  goals TEXT,
  interests TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_learner_profiles_updated
  ON learner_profiles (updated_at DESC);
