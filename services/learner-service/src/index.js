require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const qs = require("querystring");

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
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || null;
const OPENAI_MODEL_CHAT =
  process.env.OPENAI_MODEL_CHAT || process.env.OPENAI_MODEL || "gpt-4o-mini";
const AI_INTERNAL_BASE =
  process.env.AI_INTERNAL_BASE || "http://ai-service:3000";
const PRONUNCIATION_INTERNAL = process.env.PRONUNCIATION_INTERNAL || "http://pronunciation-assessment:8085";
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(/[;,]/)
  .map((s) => s.trim())
  .filter(Boolean);

// --- Database ---
const pool = new Pool({ connectionString: DATABASE_URL });

// For robustness in dev: ensure subscription tables exist if init scripts did not run
async function ensureSubscriptionsSchema() {
  // 1) Plans table (catalog)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price_vnd INTEGER NOT NULL CHECK (price_vnd >= 0),
      features TEXT[] NOT NULL DEFAULT '{}',
      mentor_sessions_per_week INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    INSERT INTO plans (id, name, price_vnd, features, mentor_sessions_per_week)
    SELECT 'ai_basic', 'Self-Study (AI-Only)', 200000,
           ARRAY['Unlimited AI speaking practice','Automatic pronunciation scoring','Instant grammar/vocabulary correction']::TEXT[], 0
    WHERE NOT EXISTS (SELECT 1 FROM plans WHERE id = 'ai_basic');
  `);
  await pool.query(`
    INSERT INTO plans (id, name, price_vnd, features, mentor_sessions_per_week)
    SELECT 'mentor_plus', 'Mentor-Included', 800000,
           ARRAY['Everything in AI-Only','Human mentor reviews practice history','2× 1-on-1 mentor sessions per week']::TEXT[], 2
    WHERE NOT EXISTS (SELECT 1 FROM plans WHERE id = 'mentor_plus');
  `);

  // 2) Subscriptions table — create if missing; otherwise migrate columns
  await pool
    .query(
      `
    CREATE TABLE IF NOT EXISTS subscriptions (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL REFERENCES plans(id),
      status TEXT NOT NULL DEFAULT 'active',
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
      current_period_start TIMESTAMPTZ NOT NULL,
      current_period_end TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `
    )
    .catch(() => {});

  // Migration path: older table version without id/plan_id
  await pool
    .query(
      `
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS id BIGSERIAL;
  `
    )
    .catch(() => {});
  // Drop old primary key on user_id if exists, then set pk on id
  await pool
    .query(
      `DO $$ BEGIN
      BEGIN
        ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_pkey;
      EXCEPTION WHEN undefined_object THEN NULL;
      END;
      BEGIN
        ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END;
    END $$;`
    )
    .catch(() => {});

  await pool.query(`
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_id TEXT;
  `);
  // Backfill plan_id from legacy column 'plan' if present
  await pool
    .query(
      `DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='subscriptions' AND column_name='plan'
        ) THEN
          UPDATE subscriptions SET plan_id = plan WHERE plan_id IS NULL;
        END IF;
      END $$;`
    )
    .catch(() => {});

  // Legacy column compatibility: allow price_vnd to be NULL if it exists and was NOT NULL
  await pool
    .query(
      `DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='subscriptions' AND column_name='price_vnd'
        ) THEN
          BEGIN
            ALTER TABLE subscriptions ALTER COLUMN price_vnd DROP NOT NULL;
          EXCEPTION WHEN others THEN NULL;
          END;
        END IF;
      END $$;`
    )
    .catch(() => {});

  // Legacy 'plan' column: make it nullable so inserts without it succeed
  await pool
    .query(
      `DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='subscriptions' AND column_name='plan'
        ) THEN
          BEGIN
            ALTER TABLE subscriptions ALTER COLUMN plan DROP NOT NULL;
          EXCEPTION WHEN others THEN NULL;
          END;
        END IF;
      END $$;`
    )
    .catch(() => {});

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
  `);

  // 3) Payments table referencing subscriptions(id)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_id BIGINT REFERENCES subscriptions(id) ON DELETE SET NULL,
      amount_vnd INTEGER NOT NULL CHECK (amount_vnd >= 0),
      currency TEXT NOT NULL DEFAULT 'VND',
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'succeeded',
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

// The database schema is now managed by the init scripts in the /database/init folder.
// The ensureSchema function has been removed.
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

// --- Subscriptions & Plans ---
const BILLING_CYCLE_DAYS = 30; // fixed 30-day cycle per requirements

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

async function getActiveSubscription(userId) {
  const q = `
    SELECT s.*, p.name AS plan_name, p.price_vnd, p.mentor_sessions_per_week
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE s.user_id = $1 AND s.status = 'active'
    ORDER BY s.created_at DESC
    LIMIT 1`;
  const { rows } = await pool.query(q, [userId]);
  return rows[0] || null;
}

// List available plans
app.get("/subscriptions/plans", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, price_vnd, features, mentor_sessions_per_week FROM plans ORDER BY price_vnd ASC`
    );
    res.json({ plans: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get my subscription
app.get("/subscriptions/me", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id || req.user.email || "unknown";
    const sub = await getActiveSubscription(userId);
    if (!sub) return res.json({ exists: false });
    res.json({
      exists: true,
      subscription: {
        id: sub.id,
        plan_id: sub.plan_id,
        plan_name: sub.plan_name,
        price_vnd: sub.price_vnd,
        cancel_at_period_end: sub.cancel_at_period_end,
        current_period_start: sub.current_period_start,
        current_period_end: sub.current_period_end,
        mentor_sessions_per_week: sub.mentor_sessions_per_week,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Choose a plan (initial subscribe) – demo: activate immediately
app.post("/subscriptions/choose", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id || req.user.email || "unknown";
    const { plan_id } = req.body || {};
    if (!plan_id) return res.status(400).json({ error: "plan_id required" });

    // Validate plan
    const planRes = await pool.query(
      `SELECT id, name, price_vnd FROM plans WHERE id = $1`,
      [plan_id]
    );
    if (!planRes.rows.length)
      return res.status(404).json({ error: "Plan not found" });

    // Check existing active subscription
    const existing = await getActiveSubscription(userId);
    if (existing) {
      return res.status(400).json({
        error: "Already subscribed. Use upgrade endpoint to change plan.",
      });
    }

    const start = new Date();
    const end = addDays(start, BILLING_CYCLE_DAYS);
    const insertRes = await pool.query(
      `INSERT INTO subscriptions (user_id, plan_id, status, cancel_at_period_end, current_period_start, current_period_end)
       VALUES ($1, $2, 'active', FALSE, $3, $4)
       RETURNING id`,
      [userId, plan_id, start.toISOString(), end.toISOString()]
    );

    // Demo: record full payment immediately (no real gateway)
    const price = planRes.rows[0].price_vnd;
    await pool.query(
      `INSERT INTO payments (user_id, subscription_id, amount_vnd, kind, status, metadata)
       VALUES ($1, $2, $3, 'full', 'succeeded', $4)`,
      [
        userId,
        insertRes.rows[0].id,
        price,
        JSON.stringify({ demo: true, note: "Initial subscribe" }),
      ]
    );

    res.json({ ok: true, subscription_id: insertRes.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cancel at period end (schedule)
app.post("/subscriptions/cancel", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id || req.user.email || "unknown";
    const sub = await getActiveSubscription(userId);
    if (!sub) return res.status(404).json({ error: "No active subscription" });
    await pool.query(
      `UPDATE subscriptions SET cancel_at_period_end = TRUE WHERE id = $1`,
      [sub.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Helper: compute proration quote
async function computeUpgradeQuote(userId, newPlanId) {
  const sub = await getActiveSubscription(userId);
  if (!sub) throw new Error("No active subscription");
  const oldPrice = Number(sub.price_vnd || 0);
  const planRes = await pool.query(
    `SELECT id, name, price_vnd FROM plans WHERE id = $1`,
    [newPlanId]
  );
  if (!planRes.rows.length) throw new Error("Plan not found");
  const newPlan = planRes.rows[0];
  const newPrice = Number(newPlan.price_vnd || 0);

  const dailyOld = oldPrice / BILLING_CYCLE_DAYS;
  const dailyNew = newPrice / BILLING_CYCLE_DAYS;
  const dailyDiff = Math.max(0, Math.round(dailyNew - dailyOld));

  const now = new Date();
  const periodEnd = new Date(sub.current_period_end);
  const msPerDay = 24 * 60 * 60 * 1000;
  let remainingDays = Math.ceil((periodEnd - now) / msPerDay);
  if (remainingDays < 0) remainingDays = 0;

  const amount = dailyDiff * remainingDays;
  return {
    subscription_id: sub.id,
    from_plan_id: sub.plan_id,
    from_plan_price_vnd: oldPrice,
    to_plan_id: newPlan.id,
    to_plan_price_vnd: newPrice,
    remaining_days: remainingDays,
    daily_difference_vnd: dailyDiff,
    amount_due_now_vnd: amount,
    renewal_date: sub.current_period_end,
    cancel_at_period_end: sub.cancel_at_period_end,
  };
}

// Get upgrade quote (pro-rata)
app.get("/subscriptions/upgrade/quote", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id || req.user.email || "unknown";
    const newPlanId = String(req.query.new_plan_id || "").trim();
    if (!newPlanId)
      return res.status(400).json({ error: "new_plan_id required" });
    const quote = await computeUpgradeQuote(userId, newPlanId);
    res.json(quote);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Perform upgrade with demo payment (immediate access, keep renewal date)
app.post("/subscriptions/upgrade", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id || req.user.email || "unknown";
    const { new_plan_id } = req.body || {};
    if (!new_plan_id)
      return res.status(400).json({ error: "new_plan_id required" });

    await client.query("BEGIN");
    const quote = await computeUpgradeQuote(userId, new_plan_id);

    // Override pending cancel and switch plan immediately
    await client.query(
      `UPDATE subscriptions
       SET plan_id = $1, cancel_at_period_end = FALSE
       WHERE id = $2`,
      [quote.to_plan_id, quote.subscription_id]
    );

    // Record demo payment of prorated difference
    if (quote.amount_due_now_vnd > 0) {
      await client.query(
        `INSERT INTO payments (user_id, subscription_id, amount_vnd, kind, status, metadata)
         VALUES ($1, $2, $3, 'proration', 'succeeded', $4)`,
        [
          userId,
          quote.subscription_id,
          quote.amount_due_now_vnd,
          JSON.stringify({ demo: true, reason: "plan_upgrade_proration" }),
        ]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true, charged_vnd: quote.amount_due_now_vnd });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    return res.status(400).json({ error: e.message });
  } finally {
    client.release();
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

function fallbackRoadmapTitles(category, level, count = 8) {
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
    .map((t) => `${t} (${String(category).toUpperCase()} ${level})`);
}

// --- Conversation helpers ---
function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}
function cosineSimilarity(a, b) {
  const va = new Map();
  for (const t of a) va.set(t, (va.get(t) || 0) + 1);
  const vb = new Map();
  for (const t of b) vb.set(t, (vb.get(t) || 0) + 1);
  let dot = 0;
  for (const [t, ca] of va.entries()) {
    const cb = vb.get(t) || 0;
    dot += ca * cb;
  }
  const magA = Math.sqrt([...va.values()].reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt([...vb.values()].reduce((s, v) => s + v * v, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

async function ttsForText(text, voiceCode) {
  try {
    const resp = await fetch(`${PRONUNCIATION_INTERNAL.replace(/\/$/, "")}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: voiceCode || undefined }),
    });
    if (!resp.ok) return null;
    const j = await resp.json();
    return j?.url || null; // already prefixed with /api/pronunciation
  } catch (_) {
    return null;
  }
}

async function aiNextMessage(history, title, level) {
  // Try OpenAI with short history; fallback to ai-service generic prompt
  if (OPENAI_API_KEY && OPENAI_BASE_URL) {
    const messages = [
      { role: "system", content: `You are AESP conversation coach. Topic: ${title}. Keep messages short and A2-B1 friendly.` },
      ...history.slice(-4),
      { role: "user", content: "Reply with the next line of AI only." },
    ];
    try {
      const resp = await fetch(`${OPENAI_BASE_URL.replace(/\/$/, "")}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ model: OPENAI_MODEL_CHAT, messages, temperature: 0.7, max_tokens: 120 }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      }
    } catch (_) {}
  }
  // Fallback: generic follow-up
  return `Thanks for sharing. Could you tell me a bit more about ${title.toLowerCase()}?`;
}

async function aiSuggestLearnerReply(aiText, title, level) {
  if (OPENAI_API_KEY && OPENAI_BASE_URL) {
    const prompt = `Given the AI line: "${aiText}", suggest a concise learner reply (one sentence) suitable for level ${level} on topic ${title}. Return only the sentence.`;
    try {
      const resp = await fetch(`${OPENAI_BASE_URL.replace(/\/$/, "")}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ model: OPENAI_MODEL_CHAT, messages: [
          { role: "system", content: "You are AESP conversation coach." },
          { role: "user", content: prompt }
        ], temperature: 0.7, max_tokens: 80 }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      }
    } catch (_) {}
  }
  return `Here is my answer about ${title.toLowerCase()}.`;
}

async function aiGenerateRoadmapTitles(category, level, count = 8) {
  // Prefer direct OpenAI-compatible endpoint; fallback to heuristics if unavailable or failing
  if (!OPENAI_API_KEY || !OPENAI_BASE_URL) {
    return fallbackRoadmapTitles(category, level, count);
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
  try {
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
      return fallbackRoadmapTitles(category, level, count);
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
        : fallbackRoadmapTitles(category, level, count);
    } catch {
      // last resort: split by lines
      const lines = text
        .split(/\r?\n/)
        .map((s) => s.replace(/^[\-*\d\.\s]+/, "").trim())
        .filter(Boolean)
        .slice(0, count);
      return lines.length
        ? lines
        : fallbackRoadmapTitles(category, level, count);
    }
  } catch {
    return fallbackRoadmapTitles(category, level, count);
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

// DEMO ONLY: Force set current plan (allows switching to AI-Only to demo upgrade flow)
// Do NOT enable in production environments.
app.post("/subscriptions/demo/set-plan", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id || req.user.email || "unknown";
    const { plan_id } = req.body || {};
    if (!plan_id) return res.status(400).json({ error: "plan_id required" });
    // Validate plan exists
    const planRes = await pool.query(
      `SELECT id, price_vnd FROM plans WHERE id = $1`,
      [plan_id]
    );
    if (!planRes.rows.length)
      return res.status(404).json({ error: "Plan not found" });

    const sub = await getActiveSubscription(userId);
    if (!sub) {
      // If no subscription, create one starting now
      const start = new Date();
      const end = addDays(start, BILLING_CYCLE_DAYS);
      const { rows } = await pool.query(
        `INSERT INTO subscriptions (user_id, plan_id, status, cancel_at_period_end, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', FALSE, $3, $4)
         RETURNING id`,
        [userId, plan_id, start.toISOString(), end.toISOString()]
      );
      return res.json({ ok: true, subscription_id: rows[0]?.id, demo: true });
    }
    // If subscription exists, switch plan immediately, keep renewal date
    await pool.query(
      `UPDATE subscriptions SET plan_id = $1, cancel_at_period_end = FALSE WHERE id = $2`,
      [plan_id, sub.id]
    );
    // Optional: record a zero-amount demo payment for audit
    await pool.query(
      `INSERT INTO payments (user_id, subscription_id, amount_vnd, kind, status, metadata)
       VALUES ($1, $2, 0, 'demo_switch', 'succeeded', $3)`,
      [userId, sub.id, JSON.stringify({ demo: true, note: "force set plan" })]
    );
    res.json({ ok: true, demo: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    const userKey = req.user.id || req.user.email || "unknown";
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

// --- Conversation (chat lesson) endpoints ---

// Start a chat session for a lesson
app.post("/learning-path/lessons/:id/start", requireAuth, async (req, res) => {
  try {
    const lessonId = Number(req.params.id);
    if (!Number.isFinite(lessonId)) return res.status(400).json({ error: "Invalid lesson id" });
    const { mode = "scripted", turns = 4 } = req.body || {};
    if (!["scripted","ai-only"].includes(mode)) return res.status(400).json({ error: "Invalid mode" });
    const targetTurns = Math.max(1, Math.min(6, Number(turns) || 4));

    const { rows: lrows } = await pool.query(
      `SELECT title, difficulty_level, category FROM PracticeLessons WHERE lesson_id = $1`,
      [lessonId]
    );
    if (!lrows.length) return res.status(404).json({ error: "Lesson not found" });
    const { title, difficulty_level, category } = lrows[0];

    // First AI message
    let aiText = await aiStartMessageViaOpenAI(title, difficulty_level);
    if (!aiText) aiText = await aiStartMessageViaAiService(title, difficulty_level, category);
    if (!aiText) aiText = `Let's talk about ${title}. Could you start?`;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ins = await client.query(
        `INSERT INTO ConversationSessions (user_id, lesson_id, mode, target_learner_turns)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [req.user.id, lessonId, mode, targetTurns]
      );
      const sessionId = ins.rows[0].id;

      // TTS for AI text; fetch preferred voice
      let voiceCode = null;
      try {
        const pref = await client.query(`SELECT ai_voice FROM user_preferences WHERE user_id = $1`, [req.user.id]);
        voiceCode = pref.rows[0]?.ai_voice || null;
      } catch(_) {}
      const ttsUrl = await ttsForText(aiText, voiceCode);

      await client.query(
        `INSERT INTO ConversationTurns (session_id, turn_index, role, text, tts_path)
         VALUES ($1, $2, 'ai', $3, $4)`,
        [sessionId, 0, aiText, ttsUrl || null]
      );

      // If scripted, suggest a learner reply for guidance
      let learnerHint = null;
      if (mode === 'scripted') {
        learnerHint = await aiSuggestLearnerReply(aiText, title, difficulty_level);
      }

      await client.query("COMMIT");
      return res.json({
        session: { id: sessionId, mode, target_learner_turns: targetTurns, lesson_id: lessonId },
        ai: { text: aiText, tts_url: ttsUrl },
        learner_hint: learnerHint,
      });
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch(_) {}
      throw e;
    } finally { client.release(); }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Submit a learner turn and get next AI line
app.post("/learning-path/sessions/:sessionId/learner-turn", requireAuth, async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "Invalid session id" });
    const { recognized_text, pa_scores } = req.body || {};
    const text = String(recognized_text || "").trim();
    if (!text) return res.status(400).json({ error: "recognized_text required" });

    // Load session, lesson and history
    const { rows: srows } = await pool.query(
      `SELECT cs.*, pl.title, pl.difficulty_level
       FROM ConversationSessions cs JOIN PracticeLessons pl ON pl.lesson_id = cs.lesson_id
       WHERE cs.id = $1 AND cs.user_id = $2`,
      [sessionId, req.user.id]
    );
    if (!srows.length) return res.status(404).json({ error: "Session not found" });
    const sess = srows[0];
    if (sess.status !== 'active') return res.status(400).json({ error: "Session completed" });

    const { rows: turns } = await pool.query(
      `SELECT turn_index, role, text FROM ConversationTurns WHERE session_id = $1 ORDER BY turn_index ASC`,
      [sessionId]
    );
    const nextIndex = (turns[turns.length - 1]?.turn_index || 0) + 1;

    // Compute semantic similarity vs previous AI line (if exists)
    let similarity = 1;
    const lastAi = [...turns].reverse().find(t => t.role === 'ai');
    if (lastAi) {
      similarity = cosineSimilarity(tokenize(text), tokenize(lastAi.text || ""));
    }

    // Combine scores: pronScore primary (0-100), similarity (0-1)
    const pron = Number(pa_scores?.pronScore ?? pa_scores?.pronunciationScore ?? 0) || 0;
    const combined = Math.max(0, Math.min(100, Math.round(pron * (0.8 + 0.2 * similarity))));

    // Store learner turn
    await pool.query(
      `INSERT INTO ConversationTurns (session_id, turn_index, role, text, scores)
       VALUES ($1, $2, 'learner', $3, $4)`,
      [sessionId, nextIndex, text, JSON.stringify({ ...pa_scores, similarity, combined })]
    );

    // Count learner turns so far
    const learnerCount = turns.filter(t => t.role === 'learner').length + 1;
    const target = Number(sess.target_learner_turns) || 4;

    // Next AI line or complete
    if (learnerCount >= target) {
      return res.json({ done: true });
    }

    // Build short history for AI
    const history = [];
    for (const t of turns.slice(-3)) {
      history.push({ role: t.role === 'ai' ? 'assistant' : 'user', content: t.text || '' });
    }
    history.push({ role: 'user', content: text });
    const aiText = await aiNextMessage(history, sess.title, sess.difficulty_level);
    const pref = await pool.query(`SELECT ai_voice FROM user_preferences WHERE user_id = $1`, [req.user.id]);
    const ttsUrl = await ttsForText(aiText, pref.rows[0]?.ai_voice || null);

    await pool.query(
      `INSERT INTO ConversationTurns (session_id, turn_index, role, text, tts_path)
       VALUES ($1, $2, 'ai', $3, $4)`,
      [sessionId, nextIndex + 1, aiText, ttsUrl || null]
    );

    let learnerHint = null;
    if (sess.mode === 'scripted') {
      learnerHint = await aiSuggestLearnerReply(aiText, sess.title, sess.difficulty_level);
    }

    res.json({ ai: { text: aiText, tts_url: ttsUrl }, learner_hint: learnerHint });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Complete a session and update progress
app.post("/learning-path/sessions/:sessionId/complete", requireAuth, async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "Invalid session id" });
    const { rows: srows } = await pool.query(
      `SELECT * FROM ConversationSessions WHERE id = $1 AND user_id = $2`,
      [sessionId, req.user.id]
    );
    if (!srows.length) return res.status(404).json({ error: "Session not found" });
    const sess = srows[0];
    const { rows: lturns } = await pool.query(
      `SELECT scores FROM ConversationTurns WHERE session_id = $1 AND role = 'learner' ORDER BY turn_index ASC`,
      [sessionId]
    );
    let avg = 0;
    if (lturns.length) {
      const vals = lturns.map(r => Number(r.scores?.combined || 0) || 0);
      avg = Math.round(vals.reduce((a,b)=>a+b,0) / vals.length);
    }
    await pool.query(
      `UPDATE ConversationSessions SET status='completed', completed_at=NOW(), final_score=$1 WHERE id=$2`,
      [avg, sessionId]
    );
    // Update LearnerProgress
    await pool.query(
      `INSERT INTO LearnerProgress (user_id, lesson_id, score)
       SELECT user_id, lesson_id, $1 FROM ConversationSessions WHERE id=$2
       ON CONFLICT (user_id, lesson_id)
       DO UPDATE SET score = EXCLUDED.score, completed_at = CURRENT_TIMESTAMP`,
      [avg, sessionId]
    );
    res.json({ ok: true, final_score: avg });
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
ensureSubscriptionsSchema()
  .catch((e) => {
    console.warn("Subscriptions schema ensure failed (continuing):", e.message);
  })
  .finally(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`${SERVICE_NAME} listening on port ${PORT}`);
    });
  });
