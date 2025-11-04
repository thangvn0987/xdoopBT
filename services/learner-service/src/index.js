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
    } catch {}
    res.status(400).json({ error: e.message });
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

// --- Profiles ---
// Get current user's profile (learner_profiles)
app.get("/profiles/me", requireAuth, async (req, res) => {
  try {
    const userKey = req.user.id || req.user.email || "unknown";
    const { rows } = await pool.query(
      `SELECT user_id, goals, interests, created_at, updated_at
       FROM learner_profiles WHERE user_id = $1`,
      [userKey]
    );
    if (!rows.length) {
      return res.json({
        exists: false,
        user_id: userKey,
        goals: "",
        interests: [],
      });
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
    interests = interests.slice(0, 30).map((s) => s.substring(0, 48));

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
ensureSubscriptionsSchema()
  .catch((e) => {
    console.warn("Subscriptions schema ensure failed (continuing):", e.message);
  })
  .finally(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`${SERVICE_NAME} listening on port ${PORT}`);
    });
  });
