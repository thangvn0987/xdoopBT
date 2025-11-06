-- Concurrency/idempotency guard for generated roadmaps
-- Ensure unique order per user/category/level for generated lessons

CREATE UNIQUE INDEX IF NOT EXISTS uq_generated_user_cat_level_order
  ON PracticeLessons (generated_for_user, category, difficulty_level, order_in_path)
  WHERE is_generated;
