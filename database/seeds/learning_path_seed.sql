-- Learning Path mockdata seed (skeleton lessons)
-- Safe to run on an empty DB. This script TRUNCATEs PracticeLessons then inserts a diverse set of lessons.
-- If you need additive behavior instead of truncate, comment out the TRUNCATE statement.

BEGIN;

-- Reset lessons and cascade delete any dependent progress (if any)
TRUNCATE TABLE LearnerProgress RESTART IDENTITY CASCADE;
TRUNCATE TABLE PracticeLessons RESTART IDENTITY CASCADE;

-- Helpers (categories & levels):
-- categories: business | travel | exam | conversation
-- levels: A2 | B1 | B2

-- BUSINESS A2
INSERT INTO PracticeLessons (title, category, difficulty_level, order_in_path) VALUES
('Introducing Yourself at Work', 'business', 'A2', 1),
('Describing Your Daily Tasks', 'business', 'A2', 2),
('Asking for Clarification', 'business', 'A2', 3),
('Scheduling a Meeting', 'business', 'A2', 4);

-- BUSINESS B1
INSERT INTO PracticeLessons (title, category, difficulty_level, order_in_path) VALUES
('Giving a Short Project Update', 'business', 'B1', 1),
('Participating in a Team Meeting', 'business', 'B1', 2),
('Handling a Client Call', 'business', 'B1', 3),
('Writing a Professional Email', 'business', 'B1', 4);

-- BUSINESS B2
INSERT INTO PracticeLessons (title, category, difficulty_level, order_in_path) VALUES
('Presenting a Proposal', 'business', 'B2', 1),
('Negotiating Terms', 'business', 'B2', 2),
('Leading a Stand-up', 'business', 'B2', 3),
('Managing Conflicts Professionally', 'business', 'B2', 4);

-- TRAVEL A2
INSERT INTO PracticeLessons (title, category, difficulty_level, order_in_path) VALUES
('At the Airport Check-in', 'travel', 'A2', 1),
('Asking for Directions', 'travel', 'A2', 2),
('Ordering Food & Drinks', 'travel', 'A2', 3),
('Checking into a Hotel', 'travel', 'A2', 4);

-- TRAVEL B1
INSERT INTO PracticeLessons (title, category, difficulty_level, order_in_path) VALUES
('Describing a Trip Plan', 'travel', 'B1', 1),
('Solving Travel Issues', 'travel', 'B1', 2),
('Booking & Re-booking', 'travel', 'B1', 3),
('Talking About Tourist Attractions', 'travel', 'B1', 4);

-- TRAVEL B2
INSERT INTO PracticeLessons (title, category, difficulty_level, order_in_path) VALUES
('Comparing Destinations', 'travel', 'B2', 1),
('Handling a Complaint Politely', 'travel', 'B2', 2),
('Cultural Differences & Etiquette', 'travel', 'B2', 3),
('Sharing Advanced Travel Tips', 'travel', 'B2', 4);

-- EXAM A2
INSERT INTO PracticeLessons (title, category, difficulty_level, order_in_path) VALUES
('Describing a Picture (Simple)', 'exam', 'A2', 1),
('Talking About Your Hometown', 'exam', 'A2', 2),
('Daily Routine (Speaking Part 1)', 'exam', 'A2', 3),
('Simple Opinions', 'exam', 'A2', 4);

-- EXAM B1
INSERT INTO PracticeLessons (title, category, difficulty_level, order_in_path) VALUES
('Storytelling from Prompts', 'exam', 'B1', 1),
('Discussing Preferences', 'exam', 'B1', 2),
('Agreeing and Disagreeing', 'exam', 'B1', 3),
('Comparing Two Options', 'exam', 'B1', 4);

-- EXAM B2
INSERT INTO PracticeLessons (title, category, difficulty_level, order_in_path) VALUES
('Explaining Advantages & Disadvantages', 'exam', 'B2', 1),
('Speculating about Causes/Effects', 'exam', 'B2', 2),
('Analyzing Graphs or Charts', 'exam', 'B2', 3),
('Defending a Point of View', 'exam', 'B2', 4);

-- CONVERSATION A2
INSERT INTO "PracticeLessons" (title, category, difficulty_level, order_in_path) VALUES
('Meeting New People', 'conversation', 'A2', 1),
('Talking About Hobbies', 'conversation', 'A2', 2),
('Weekend Plans', 'conversation', 'A2', 3),
('Describing Your Family', 'conversation', 'A2', 4);

-- CONVERSATION B1
INSERT INTO "PracticeLessons" (title, category, difficulty_level, order_in_path) VALUES
('Sharing Experiences', 'conversation', 'B1', 1),
('Giving Recommendations', 'conversation', 'B1', 2),
('Solving Everyday Problems', 'conversation', 'B1', 3),
('Discussing News & Events', 'conversation', 'B1', 4);

-- CONVERSATION B2
INSERT INTO "PracticeLessons" (title, category, difficulty_level, order_in_path) VALUES
('Debating Common Topics', 'conversation', 'B2', 1),
('Expressing Subtle Opinions', 'conversation', 'B2', 2),
('Agreeing to Disagree', 'conversation', 'B2', 3),
('Handling Misunderstandings', 'conversation', 'B2', 4);

COMMIT;
