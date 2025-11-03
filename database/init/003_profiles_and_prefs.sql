-- Step 1: Add new columns to the 'users' table for public profile information
ALTER TABLE users
ADD COLUMN IF NOT EXISTS display_name TEXT,
ADD COLUMN IF NOT EXISTS short_bio TEXT,
ADD COLUMN IF NOT EXISTS current_level TEXT,
ADD COLUMN IF NOT EXISTS accent_preference TEXT;

-- Step 2: Create a new table for user goals and preferences (private settings)
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY,
    main_goal TEXT,
    practice_goal JSONB,
    correction_strictness TEXT DEFAULT 'all',
    ai_voice TEXT DEFAULT 'female_american',
    favorite_topics TEXT[],
    notification_preferences JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_user
        FOREIGN KEY(user_id) 
        REFERENCES users(id)
        ON DELETE CASCADE
);

-- Create a trigger to automatically update the 'updated_at' timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER update_user_preferences_updated_at
BEFORE UPDATE ON user_preferences
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Note: We also need a way to automatically create a preferences row
-- when a new user is created. This can be handled in the auth-service
-- after a user is first inserted.
