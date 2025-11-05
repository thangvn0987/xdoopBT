-- Subscription plans and subscriptions schema

-- Plans: fixed catalog of offerings
CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,                 -- e.g., 'ai_basic', 'mentor_plus'
    name TEXT NOT NULL,
    price_vnd INTEGER NOT NULL CHECK (price_vnd >= 0),
    features TEXT[] NOT NULL DEFAULT '{}',
    mentor_sessions_per_week INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep catalog minimal for demo: two rows inserted if missing
INSERT INTO plans (id, name, price_vnd, features, mentor_sessions_per_week)
SELECT 'ai_basic', 'Self-Study (AI-Only)', 200000,
       ARRAY[
         'Unlimited AI speaking practice',
         'Automatic pronunciation scoring',
         'Instant grammar/vocabulary correction'
       ]::TEXT[],
       0
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE id = 'ai_basic');

INSERT INTO plans (id, name, price_vnd, features, mentor_sessions_per_week)
SELECT 'mentor_plus', 'Mentor-Included', 800000,
       ARRAY[
         'Everything in AI-Only',
         'Human mentor reviews practice history',
         '2× 1-on-1 mentor sessions per week'
       ]::TEXT[],
       2
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE id = 'mentor_plus');

-- Subscriptions: per-user active subscription and billing cycle
CREATE TABLE IF NOT EXISTS subscriptions (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES plans(id),
    status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'canceled'
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- Payment transactions (demo)
CREATE TABLE IF NOT EXISTS payments (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id BIGINT REFERENCES subscriptions(id) ON DELETE SET NULL,
    amount_vnd INTEGER NOT NULL CHECK (amount_vnd >= 0),
    currency TEXT NOT NULL DEFAULT 'VND',
    kind TEXT NOT NULL,       -- 'proration' | 'full' | 'other'
    status TEXT NOT NULL DEFAULT 'succeeded', -- demo: mark as succeeded
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to keep updated_at in sync
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_subscriptions_touch ON subscriptions;
CREATE TRIGGER trg_subscriptions_touch
BEFORE UPDATE ON subscriptions
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
