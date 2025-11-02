require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());

const SERVICE_NAME = process.env.SERVICE_NAME || "learner-service";
const PORT = Number(process.env.PORT) || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret";

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

// Get user profile
app.get("/profile", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT display_name, full_name, avatar_url, native_language, learning_target FROM users WHERE id = $1",
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

// Update user profile
app.put("/profile", requireAuth, async (req, res) => {
  try {
    const {
      display_name,
      full_name,
      avatar_url,
      native_language,
      learning_target,
    } = req.body;
    const { rows } = await pool.query(
      `UPDATE users
       SET
         display_name = COALESCE($1, display_name),
         full_name = COALESCE($2, full_name),
         avatar_url = COALESCE($3, avatar_url),
         native_language = COALESCE($4, native_language),
         learning_target = COALESCE($5, learning_target)
       WHERE id = $6
       RETURNING display_name, full_name, avatar_url, native_language, learning_target`,
      [
        display_name,
        full_name,
        avatar_url,
        native_language,
        learning_target,
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

// Get user preferences
app.get("/preferences", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM user_preferences WHERE user_id = $1",
      [req.user.id]
    );
    if (rows.length === 0) {
      // If no preferences, return default values
      return res.json({
        user_id: req.user.id,
        learning_goal: "GENERAL_CONVERSATION",
        preferred_accent: "NEUTRAL",
        daily_practice_goal_minutes: 15,
        notification_enabled: false,
      });
    }
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update user preferences
app.put("/preferences", requireAuth, async (req, res) => {
  try {
    const {
      learning_goal,
      preferred_accent,
      daily_practice_goal_minutes,
      notification_enabled,
    } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO user_preferences (user_id, learning_goal, preferred_accent, daily_practice_goal_minutes, notification_enabled)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id)
       DO UPDATE SET
         learning_goal = EXCLUDED.learning_goal,
         preferred_accent = EXCLUDED.preferred_accent,
         daily_practice_goal_minutes = EXCLUDED.daily_practice_goal_minutes,
         notification_enabled = EXCLUDED.notification_enabled
       RETURNING *`,
      [
        req.user.id,
        learning_goal,
        preferred_accent,
        daily_practice_goal_minutes,
        notification_enabled,
      ]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Startup
app.listen(PORT, "0.0.0.0", () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}`);
});
