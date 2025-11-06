-- AI Roadmap support: mark generated lessons and link to user

ALTER TABLE PracticeLessons
  ADD COLUMN IF NOT EXISTS is_generated BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS generated_for_user TEXT;

-- Useful index to fetch per-user generated lessons quickly
CREATE INDEX IF NOT EXISTS idx_lessons_generated_user
  ON PracticeLessons (generated_for_user, category, difficulty_level, order_in_path);
