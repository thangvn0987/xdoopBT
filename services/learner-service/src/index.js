require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const SERVICE_NAME = process.env.SERVICE_NAME || "learner-service";
const PORT = Number(process.env.PORT) || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret";

// --- Database ---
const pool = new Pool({ connectionString: DATABASE_URL });

async function ensureSchema() {
  const sql = `
  CREATE TABLE IF NOT EXISTS pronunciation_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    score NUMERIC NOT NULL CHECK (score >= 0 AND score <= 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_pronunciation_sessions_user_time
    ON pronunciation_sessions (user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    topic TEXT,
    transcript TEXT,
    ai_score NUMERIC CHECK (ai_score >= 0 AND ai_score <= 100),
    grammar_feedback JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user_time
    ON sessions (user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS learner_profiles (
    user_id TEXT PRIMARY KEY,
    goals TEXT,
    interests TEXT[] DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_learner_profiles_updated
    ON learner_profiles (updated_at DESC);
  `;
  await pool.query(sql);
}

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
    res
      .status(500)
      .json({
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

// --- Profiles ---
// Get current user's profile
app.get("/profiles/me", requireAuth, async (req, res) => {
  try {
    const userKey = req.user.id || req.user.email || "unknown";
    const { rows } = await pool.query(
      `SELECT user_id, goals, interests, created_at, updated_at
       FROM learner_profiles WHERE user_id = $1`,
      [userKey]
    );
    if (!rows.length) {
      return res.json({ exists: false, user_id: userKey, goals: "", interests: [] });
    }
    const r = rows[0];
    res.json({ exists: true, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create or update current user's profile
app.put("/profiles/me", requireAuth, async (req, res) => {
  try {
    const userKey = req.user.id || req.user.email || "unknown";
    let { goals = "", interests = [] } = req.body || {};

    if (typeof goals !== "string") goals = String(goals ?? "");
    // Normalize interests: accept array of strings or comma-separated string
    if (typeof interests === "string") {
      interests = interests
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (!Array.isArray(interests)) interests = [];
    // limit interest length and count for safety
    interests = interests
      .slice(0, 30)
      .map((s) => s.substring(0, 48));

    await pool.query(
      `INSERT INTO learner_profiles (user_id, goals, interests, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET goals = EXCLUDED.goals, interests = EXCLUDED.interests, updated_at = NOW()`,
      [userKey, goals, interests]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Startup
ensureSchema()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`${SERVICE_NAME} listening on port ${PORT}`);
    });
  })
  .catch((e) => {
    console.error("Failed to ensure schema:", e);
    process.exit(1);
  });
