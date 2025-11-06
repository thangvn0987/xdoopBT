-- Learning Path schema: PracticeLessons and LearnerProgress

CREATE TABLE IF NOT EXISTS PracticeLessons (
    lesson_id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    difficulty_level VARCHAR(10) NOT NULL,
    order_in_path INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lesson_category_level ON PracticeLessons(category, difficulty_level);

CREATE TABLE IF NOT EXISTS LearnerProgress (
    progress_id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    lesson_id INT NOT NULL,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    score REAL,
    CONSTRAINT fk_progress_lesson FOREIGN KEY (lesson_id) REFERENCES PracticeLessons(lesson_id) ON DELETE CASCADE,
    CONSTRAINT uq_user_lesson UNIQUE(user_id, lesson_id)
);
