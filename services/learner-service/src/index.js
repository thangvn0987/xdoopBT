require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const qs = require("querystring");

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());

const SERVICE_NAME = process.env.SERVICE_NAME || "learner-service";
const PORT = Number(process.env.PORT) || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || null;
const OPENAI_MODEL_CHAT =
  process.env.OPENAI_MODEL_CHAT || process.env.OPENAI_MODEL || "gpt-4o-mini";
const AI_INTERNAL_BASE =
  process.env.AI_INTERNAL_BASE || "http://ai-service:3000";
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(/[;,]/)
  .map((s) => s.trim())
  .filter(Boolean);

// --- Database ---
const pool = new Pool({ connectionString: DATABASE_URL });

// The database schema is now managed by the init scripts in the /database/init folder.
// The ensureSchema function has been removed.

// --- Auth helper ---
function getTokenFromReq(req) {
  const authHeader =
    req.headers["authorization"] || req.headers["Authorization"];
  if (
    authHeader &&
    typeof authHeader === "string" &&
    authHeader.toLowerCase().startsWith("bearer ")
  ) {
    return authHeader.slice(7).trim();
  }
  // Fallback to cookie
  return req.cookies?.aesp_token || req.signedCookies?.aesp_token;
}

function requireAuth(req, res, next) {
  try {
    const token = getTokenFromReq(req);
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      provider: payload.provider,
    };
    next();
  } catch (e) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

function requireAdmin(req, res, next) {
  const email = req.user?.email || "";
  if (ADMIN_EMAILS.includes(email)) return next();
  return res.status(403).json({ error: "Forbidden" });
}

// --- Helpers & Maps ---
const PRIMARY_GOAL_MAP = {
  WORK: "WORK",
  TRAVEL: "TRAVEL",
  EXAM: "EXAM",
  CONVERSATION: "CONVERSATION",
};

const VOICE_MAP = {
  "en-US-male": "en-US-male",
  "en-US-female": "en-US-female",
  "en-GB-female": "en-GB-female",
};

function sanitizeTopics(input) {
  if (!input) return [];
  if (Array.isArray(input))
    return input.map((s) => String(s).trim()).filter(Boolean);
  // allow comma-separated string
  return String(input)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// --- Routes ---
app.get("/", (req, res) => {
  res.json({
    service: SERVICE_NAME,
    message: "Welcome to AESP Learner Service",
  });
});

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      service: SERVICE_NAME,
      db: true,
      time: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({
      status: "error",
      service: SERVICE_NAME,
      db: false,
      error: e.message,
    });
  }
});

// --- Learning Path Helpers ---
function goalToCategory(goal) {
  if (!goal) return null;
  const g = String(goal).toUpperCase();
  if (g === "WORK") return "business";
  if (g === "TRAVEL") return "travel";
  if (g === "EXAM") return "exam";
  if (g === "CONVERSATION") return "conversation";
  return g.toLowerCase();
}

async function fetchUserLevelAndGoal(userId) {
  // Pull from our own DB: users.current_level and user_preferences.main_goal
  const [{ rows: urows }, { rows: prows }] = await Promise.all([
    pool.query(`SELECT current_level FROM users WHERE id = $1`, [userId]),
    pool.query(`SELECT main_goal FROM user_preferences WHERE user_id = $1`, [
      userId,
    ]),
  ]);
  const level = urows[0]?.current_level || null;
  const goal = prows[0]?.main_goal || null;
  return { level, goal };
}

async function aiStartMessageViaOpenAI(title, level) {
  if (!OPENAI_API_KEY || !OPENAI_BASE_URL) return null;
  const prompt = `Bạn là AI hỗ trợ luyện nói (AESP). Hãy tạo câu mở đầu duy nhất cho kịch bản hội thoại chủ đề "${title}" phù hợp trình độ ${level}. Chỉ trả về một câu duy nhất của AI.`;
  const body = {
    model: OPENAI_MODEL_CHAT,
    messages: [
      { role: "system", content: "You are AESP conversation coach." },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 120,
  };
  const resp = await fetch(
    `${OPENAI_BASE_URL.replace(/\/$/, "")}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) {
    return null;
  }
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  return text || null;
}

async function aiStartMessageViaAiService(title, level, category) {
  try {
    const body = {
      category: category || "conversation",
      topicHint: title,
      sentences: 1,
      length: "short",
      level: level || "B1",
    };
    const resp = await fetch(
      `${AI_INTERNAL_BASE.replace(/\/$/, "")}/generate-script`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const text = (data?.text || "").split(/\r?\n/)[0]?.trim();
    return text || null;
  } catch (_e) {
    return null;
  }
}

async function aiGenerateRoadmapTitles(category, level, count = 8) {
  // Prefer direct OpenAI-compatible endpoint
  if (!OPENAI_API_KEY || !OPENAI_BASE_URL) {
    // Fallback: simple heuristics if no AI configured
    const base = [
      "Fundamentals of the topic",
      "Key phrases and patterns",
      "Common scenarios",
      "Problem solving",
      "Expanding vocabulary",
      "Fluency drills",
      "Role-play practice",
      "Review & assessment",
    ];
    return base
      .slice(0, count)
      .map((t) => `${t} (${category.toUpperCase()} ${level})`);
  }
  const prompt = `You are designing an English speaking learning roadmap for category ${category} at CEFR level ${level}. Return a pure JSON array (no markdown) of ${count} concise lesson titles in English. Example: ["Introducing yourself", "Scheduling a meeting", ...]. Do NOT include numbering, only titles.`;
  const body = {
    model: OPENAI_MODEL_CHAT,
    messages: [
      { role: "system", content: "You are AESP curriculum planner." },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 400,
  };
  const resp = await fetch(
    `${OPENAI_BASE_URL.replace(/\/$/, "")}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) {
    return aiGenerateRoadmapTitles(category, level, count); // fallback heuristic
  }
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content || "";
  try {
    const jsonStart = text.indexOf("[");
    const jsonEnd = text.lastIndexOf("]");
    const arr = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    return Array.isArray(arr)
      ? arr
          .map((s) => String(s).trim())
          .filter(Boolean)
          .slice(0, count)
      : [];
  } catch {
    // last resort: split by lines
    return text
      .split(/\r?\n/)
      .map((s) => s.replace(/^[-*\d.\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, count);
  }
}

async function ensureUserRoadmap(userId, category, level, count = 8) {
  // Use an advisory lock to avoid duplicate generation on concurrent requests
  const client = await pool.connect();
  const key = `roadmap|${userId}|${category}|${level}`;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [key]);

    // Check existing within lock
    const { rows: existing } = await client.query(
      `SELECT lesson_id FROM PracticeLessons WHERE generated_for_user = $1 AND category = $2 AND difficulty_level = $3 ORDER BY order_in_path ASC`,
      [userId, category, level]
    );
    if (existing.length > 0) {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
      await client.query("COMMIT");
      return existing.map((r) => r.lesson_id);
    }

    // Generate titles via AI
    const titles = await aiGenerateRoadmapTitles(category, level, count);
    if (!titles.length) {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
      await client.query("COMMIT");
      return [];
    }

    // Insert new lessons idempotently; rely on unique partial index when present
    const insertedIds = [];
    for (let i = 0; i < titles.length; i++) {
      const order = i + 1;
      try {
        const { rows } = await client.query(
          `INSERT INTO PracticeLessons (title, category, difficulty_level, order_in_path, is_generated, generated_for_user)
           VALUES ($1, $2, $3, $4, true, $5)
           ON CONFLICT DO NOTHING
           RETURNING lesson_id`,
          [titles[i], category, level, order, userId]
        );
        if (rows[0]?.lesson_id) insertedIds.push(rows[0].lesson_id);
      } catch (_) {
        // ignore and continue
      }
    }

    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
    await client.query("COMMIT");
    return insertedIds;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}

// Complete onboarding in one call
// Body example:
// {
//   "display_name": "Minh Trần",
//   "avatar_url": "https://...",          // will be stored in users.avatar
//   "primary_goal": "WORK" | "TRAVEL" | "EXAM" | "CONVERSATION", // -> user_preferences.main_goal
//   "topics": ["Business", "Tech"],       // -> user_preferences.favorite_topics (TEXT[])
//   "ai_voice": "en-US-male" | "en-US-female" | "en-GB-female",   // -> user_preferences.ai_voice
//   "daily_goal_minutes": 5 | 15 | 30       // -> user_preferences.practice_goal JSONB { daily_minutes }
// }
app.post("/onboarding/complete", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      display_name,
      avatar_url,
      primary_goal,
      topics,
      ai_voice,
      daily_goal_minutes,
    } = req.body || {};

    const userId = req.user.id || req.user.email || "unknown";

    // Validate and map
    const main_goal =
      PRIMARY_GOAL_MAP[String(primary_goal || "").toUpperCase()] || null;
    const aiVoice = VOICE_MAP[String(ai_voice || "")] || String(ai_voice || "");
    let daily_minutes = Number(daily_goal_minutes);
    if (!Number.isFinite(daily_minutes)) daily_minutes = null;
    if (daily_minutes != null) {
      // constrain to {5,15,30}
      if (![5, 15, 30].includes(daily_minutes)) {
        return res
          .status(400)
          .json({ error: "daily_goal_minutes must be one of 5, 15, 30" });
      }
    }
    const topicList = sanitizeTopics(topics);
    // Derive a coarse accent preference for users table (optional)
    let accent_preference = null;
    if (typeof aiVoice === "string" && aiVoice.startsWith("en-US"))
      accent_preference = "en-US";
    if (typeof aiVoice === "string" && aiVoice.startsWith("en-GB"))
      accent_preference = "en-GB";

    await client.query("BEGIN");

    // Update user profile fields (users table has avatar column, not avatar_url)
    await client.query(
      `UPDATE users
         SET
           display_name = COALESCE($1, display_name),
           avatar = COALESCE($2, avatar),
           accent_preference = COALESCE($3, accent_preference)
       WHERE id = $4`,
      [display_name || null, avatar_url || null, accent_preference, userId]
    );

    // Upsert preferences into user_preferences
    // Columns available: main_goal TEXT, practice_goal JSONB, correction_strictness TEXT, ai_voice TEXT, favorite_topics TEXT[], notification_preferences JSONB
    await client.query(
      `INSERT INTO user_preferences (user_id, main_goal, practice_goal, ai_voice, favorite_topics, notification_preferences)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id)
       DO UPDATE SET
         main_goal = COALESCE(EXCLUDED.main_goal, user_preferences.main_goal),
         practice_goal = COALESCE(EXCLUDED.practice_goal, user_preferences.practice_goal),
         ai_voice = COALESCE(EXCLUDED.ai_voice, user_preferences.ai_voice),
         favorite_topics = COALESCE(EXCLUDED.favorite_topics, user_preferences.favorite_topics),
         notification_preferences = COALESCE(EXCLUDED.notification_preferences, user_preferences.notification_preferences)`,
      [
        userId,
        main_goal,
        daily_minutes != null ? JSON.stringify({ daily_minutes }) : null,
        aiVoice || null,
        topicList.length ? topicList : null,
        null,
      ]
    );

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Insert a new pronunciation score for current user
app.post("/metrics/pronunciation", requireAuth, async (req, res) => {
  try {
    const { score } = req.body || {};
    const s = Number(score);
    if (!Number.isFinite(s) || s < 0 || s > 100) {
      return res.status(400).json({ error: "Invalid score (0-100)" });
    }
    await pool.query(
      "INSERT INTO pronunciation_sessions (user_id, score) VALUES ($1, $2)",
      [req.user.id || req.user.email || "unknown", s]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get average of last N sessions (default 5) for current user
app.get("/metrics/pronunciation/avg", requireAuth, async (req, res) => {
  try {
    const count = Math.max(1, Math.min(100, Number(req.query.count) || 5));
    const userKey = req.user.id || req.user.email || "unknown";
    const q = `
      SELECT COALESCE(AVG(score), 0)::float AS average, COUNT(*)::int AS count
      FROM (
        SELECT score
        FROM pronunciation_sessions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      ) s;
    `;
    const { rows } = await pool.query(q, [userKey, count]);
    res.json({
      average: rows[0]?.average || 0,
      count: rows[0]?.count || 0,
      window: count,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create a session record (e.g., initial level test)
app.post("/sessions", requireAuth, async (req, res) => {
  try {
    const {
      topic = "initial-level-test",
      ai_score,
      transcript = null,
      grammar_feedback = null,
    } = req.body || {};
    let score = null;
    if (ai_score != null) {
      const s = Number(ai_score);
      if (!Number.isFinite(s) || s < 0 || s > 100) {
        return res.status(400).json({ error: "Invalid ai_score (0-100)" });
      }
      score = s;
    }
    const userKey = req.user.id || req.user.email || "unknown";
    const { rows } = await pool.query(
      `INSERT INTO sessions (user_id, topic, transcript, ai_score, grammar_feedback)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [
        userKey,
        topic,
        transcript,
        score,
        grammar_feedback ? JSON.stringify(grammar_feedback) : null,
      ]
    );
    res.json({ ok: true, id: rows[0]?.id, created_at: rows[0]?.created_at });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Profile Endpoints ---

// Get user profile (aligned with current schema)
app.get("/profile", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT display_name, avatar, short_bio, current_level, accent_preference, email, name
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Profile not found" });
    }
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update user profile (aligned with current schema)
app.put("/profile", requireAuth, async (req, res) => {
  try {
    const {
      display_name,
      avatar_url,
      short_bio,
      current_level,
      accent_preference,
    } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE users
       SET
         display_name = COALESCE($1, display_name),
         avatar = COALESCE($2, avatar),
         short_bio = COALESCE($3, short_bio),
         current_level = COALESCE($4, current_level),
         accent_preference = COALESCE($5, accent_preference)
       WHERE id = $6
       RETURNING display_name, avatar, short_bio, current_level, accent_preference`,
      [
        display_name,
        avatar_url,
        short_bio,
        current_level,
        accent_preference,
        req.user.id,
      ]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Profile not found" });
    }
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Preferences Endpoints ---

// Get user preferences (aligned with current schema)
app.get("/preferences", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT main_goal, practice_goal, ai_voice, favorite_topics, correction_strictness, notification_preferences
       FROM user_preferences WHERE user_id = $1`,
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.json({
        main_goal: null,
        ai_voice: "female_american",
        favorite_topics: [],
        daily_minutes: 15,
        correction_strictness: "all",
        notification_preferences: {},
      });
    }
    const pref = rows[0];
    const daily_minutes = pref.practice_goal?.daily_minutes ?? 15;
    res.json({
      main_goal: pref.main_goal,
      ai_voice: pref.ai_voice,
      favorite_topics: pref.favorite_topics || [],
      daily_minutes,
      correction_strictness: pref.correction_strictness || "all",
      notification_preferences: pref.notification_preferences || {},
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update user preferences (aligned with current schema)
app.put("/preferences", requireAuth, async (req, res) => {
  try {
    const {
      main_goal,
      ai_voice,
      favorite_topics,
      daily_minutes,
      correction_strictness,
      notification_preferences,
    } = req.body || {};

    let daily = Number(daily_minutes);
    if (!Number.isFinite(daily)) daily = null;
    if (daily != null && ![5, 15, 30].includes(daily)) {
      return res
        .status(400)
        .json({ error: "daily_minutes must be one of 5, 15, 30" });
    }

    const topics = Array.isArray(favorite_topics)
      ? favorite_topics.map((s) => String(s)).filter(Boolean)
      : null;

    const { rows } = await pool.query(
      `INSERT INTO user_preferences (user_id, main_goal, practice_goal, ai_voice, favorite_topics, correction_strictness, notification_preferences)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id)
       DO UPDATE SET
         main_goal = COALESCE(EXCLUDED.main_goal, user_preferences.main_goal),
         practice_goal = COALESCE(EXCLUDED.practice_goal, user_preferences.practice_goal),
         ai_voice = COALESCE(EXCLUDED.ai_voice, user_preferences.ai_voice),
         favorite_topics = COALESCE(EXCLUDED.favorite_topics, user_preferences.favorite_topics),
         correction_strictness = COALESCE(EXCLUDED.correction_strictness, user_preferences.correction_strictness),
         notification_preferences = COALESCE(EXCLUDED.notification_preferences, user_preferences.notification_preferences)
       RETURNING main_goal, practice_goal, ai_voice, favorite_topics, correction_strictness, notification_preferences`,
      [
        req.user.id,
        main_goal || null,
        daily != null ? JSON.stringify({ daily_minutes: daily }) : null,
        ai_voice || null,
        topics,
        correction_strictness || null,
        notification_preferences
          ? JSON.stringify(notification_preferences)
          : null,
      ]
    );
    const pref = rows[0];
    res.json({
      main_goal: pref.main_goal,
      ai_voice: pref.ai_voice,
      favorite_topics: pref.favorite_topics || [],
      daily_minutes: pref.practice_goal?.daily_minutes ?? (daily || 15),
      correction_strictness: pref.correction_strictness || "all",
      notification_preferences: pref.notification_preferences || {},
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Learning Path Endpoints ---

// GET /learning-path/roadmap
app.get("/learning-path/roadmap", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { level, goal } = await fetchUserLevelAndGoal(userId);
    if (!level || !goal) {
      return res
        .status(400)
        .json({ error: "Missing level or goal in profile/preferences" });
    }
    const category = goalToCategory(goal);
    // Ensure AI-generated roadmap exists per user
    await ensureUserRoadmap(userId, category, level, 8);
    const { rows: lessons } = await pool.query(
      `SELECT lesson_id, title, order_in_path
       FROM PracticeLessons
       WHERE generated_for_user = $1 AND category = $2 AND difficulty_level = $3
       ORDER BY order_in_path ASC`,
      [userId, category, level]
    );
    const { rows: done } = await pool.query(
      `SELECT lesson_id, score FROM LearnerProgress WHERE user_id = $1`,
      [userId]
    );
    const completedSet = new Set(done.map((r) => r.lesson_id));

    // Determine status: completed / unlocked / locked
    let unlockedIndex = 0; // first not completed
    for (let i = 0; i < lessons.length; i++) {
      if (!completedSet.has(lessons[i].lesson_id)) {
        unlockedIndex = i;
        break;
      }
      if (i === lessons.length - 1) unlockedIndex = lessons.length; // all done
    }
    const scoreMap = new Map(done.map((r) => [r.lesson_id, r.score]));
    const roadmap = lessons.map((l, idx) => {
      if (completedSet.has(l.lesson_id))
        return {
          ...l,
          status: "completed",
          score: scoreMap.get(l.lesson_id) ?? null,
        };
      if (idx === unlockedIndex)
        return { ...l, status: "unlocked", score: null };
      return { ...l, status: "locked", score: null };
    });
    res.json({ roadmap });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /learning-path/next
app.get("/learning-path/next", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { level, goal } = await fetchUserLevelAndGoal(userId);
    if (!level || !goal) {
      return res
        .status(400)
        .json({ error: "Missing level or goal in profile/preferences" });
    }
    const category = goalToCategory(goal);
    await ensureUserRoadmap(userId, category, level, 8);
    const { rows } = await pool.query(
      `SELECT pl.lesson_id, pl.title, pl.order_in_path
       FROM PracticeLessons pl
       WHERE pl.generated_for_user = $1 AND pl.category = $2 AND pl.difficulty_level = $3
         AND NOT EXISTS (
           SELECT 1 FROM LearnerProgress lp WHERE lp.user_id = $1 AND lp.lesson_id = pl.lesson_id
         )
       ORDER BY pl.order_in_path ASC
       LIMIT 1`,
      [userId, category, level]
    );
    if (!rows.length) return res.json({ next: null });
    res.json({ next: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /learning-path/start-practice { lesson_id }
app.post("/learning-path/start-practice", requireAuth, async (req, res) => {
  try {
    const { lesson_id } = req.body || {};
    const id = Number(lesson_id);
    if (!Number.isFinite(id))
      return res.status(400).json({ error: "Invalid lesson_id" });
    const { rows } = await pool.query(
      `SELECT title, difficulty_level, category FROM PracticeLessons WHERE lesson_id = $1`,
      [id]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Lesson not found" });
    const { title, difficulty_level, category } = rows[0];

    // Try OpenAI direct first if configured; fallback to ai-service
    let start = null;
    try {
      start = await aiStartMessageViaOpenAI(title, difficulty_level);
    } catch (_) {}
    if (!start) {
      try {
        start = await aiStartMessageViaAiService(
          title,
          difficulty_level,
          category
        );
      } catch (_) {}
    }
    if (!start) return res.status(502).json({ error: "AI generation failed" });
    res.json({ start_message: start });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /learning-path/complete { lesson_id, score }
app.post("/learning-path/complete", requireAuth, async (req, res) => {
  try {
    const { lesson_id, score } = req.body || {};
    const id = Number(lesson_id);
    if (!Number.isFinite(id))
      return res.status(400).json({ error: "Invalid lesson_id" });
    let s = score != null ? Number(score) : null;
    if (s != null && (!Number.isFinite(s) || s < 0 || s > 100)) {
      return res.status(400).json({ error: "Invalid score (0-100)" });
    }
    await pool.query(
      `INSERT INTO LearnerProgress (user_id, lesson_id, score)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, lesson_id)
       DO UPDATE SET score = EXCLUDED.score, completed_at = CURRENT_TIMESTAMP`,
      [req.user.id, id, s]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Admin: PracticeLessons management ---

// POST /learning-path/lessons
app.post(
  "/learning-path/lessons",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { title, category, difficulty_level, order_in_path } =
        req.body || {};
      if (
        !title ||
        !category ||
        !difficulty_level ||
        typeof order_in_path !== "number"
      ) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const { rows } = await pool.query(
        `INSERT INTO PracticeLessons (title, category, difficulty_level, order_in_path)
       VALUES ($1, $2, $3, $4)
       RETURNING lesson_id, title, category, difficulty_level, order_in_path`,
        [title, category, difficulty_level, order_in_path]
      );
      res.json(rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// PUT /learning-path/lessons/:id
app.put(
  "/learning-path/lessons/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id))
        return res.status(400).json({ error: "Invalid id" });
      const { title, category, difficulty_level, order_in_path } =
        req.body || {};
      const { rowCount, rows } = await pool.query(
        `UPDATE PracticeLessons
       SET title = COALESCE($1, title),
           category = COALESCE($2, category),
           difficulty_level = COALESCE($3, difficulty_level),
           order_in_path = COALESCE($4, order_in_path)
       WHERE lesson_id = $5
       RETURNING lesson_id, title, category, difficulty_level, order_in_path`,
        [title, category, difficulty_level, order_in_path, id]
      );
      if (!rowCount) return res.status(404).json({ error: "Lesson not found" });
      res.json(rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// DELETE /learning-path/lessons/:id
app.delete(
  "/learning-path/lessons/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id))
        return res.status(400).json({ error: "Invalid id" });
      // Progress rows will cascade due to FK ON DELETE CASCADE
      const r = await pool.query(
        `DELETE FROM PracticeLessons WHERE lesson_id = $1`,
        [id]
      );
      if (!r.rowCount)
        return res.status(404).json({ error: "Lesson not found" });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// GET /learning-path/lessons?category=...&level=...&page=1&pageSize=20
app.get(
  "/learning-path/lessons",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { category, level, page = 1, pageSize = 20 } = req.query;
      const p = Math.max(1, parseInt(page, 10) || 1);
      const ps = Math.max(1, Math.min(100, parseInt(pageSize, 10) || 20));
      const offset = (p - 1) * ps;
      const where = [];
      const args = [];
      if (category) {
        args.push(category);
        where.push(`category = $${args.length}`);
      }
      if (level) {
        args.push(level);
        where.push(`difficulty_level = $${args.length}`);
      }
      const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const listQ = `SELECT lesson_id, title, category, difficulty_level, order_in_path
                   FROM PracticeLessons ${whereClause}
                   ORDER BY category, difficulty_level, order_in_path
                   LIMIT $${args.length + 1} OFFSET $${args.length + 2}`;
      const countQ = `SELECT COUNT(*)::int AS total FROM PracticeLessons ${whereClause}`;
      const [listR, countR] = await Promise.all([
        pool.query(listQ, [...args, ps, offset]),
        pool.query(countQ, args),
      ]);
      res.json({
        items: listR.rows,
        total: countR.rows[0].total,
        page: p,
        pageSize: ps,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// Startup
app.listen(PORT, "0.0.0.0", () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}`);
});
