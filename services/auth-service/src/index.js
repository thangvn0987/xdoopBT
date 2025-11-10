require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const rateLimit = require("express-rate-limit");

const app = express();
// Behind a proxy/load balancer (X-Forwarded-For)
app.set("trust proxy", 1);
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser(process.env.SESSION_SECRET || "dev_secret"));
app.use(passport.initialize());

const SERVICE_NAME = process.env.SERVICE_NAME || "auth-service";
const PORT = Number(process.env.PORT) || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

// DB
const pool = new Pool({ connectionString: DATABASE_URL });

async function ensureSchema() {
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      email TEXT,
      name TEXT,
      avatar TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_providerid
      ON users (provider, provider_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
  `;
  await pool.query(sql);
}

// Rate limiting
// 1) Strict auth limiter: 10 req/IP/hour for sensitive auth routes
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
  message: { error: "Too many requests for auth endpoints. Try again later." },
});
// Apply to sensitive routes first
app.use(["/google", "/callback", "/logout", "/me"], authLimiter);

// 2) General limiter: 200 req/IP/15min for all other routes
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
});
app.use(generalLimiter);

app.get("/", (req, res) => {
  res.json({ service: SERVICE_NAME, message: "Welcome to AESP Auth Service" });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: SERVICE_NAME,
    time: new Date().toISOString(),
  });
});

// Passport Google Strategy
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL;

passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const provider = "google";
        const providerId = profile.id;
        const name = profile.displayName;
        const email =
          profile.emails && profile.emails[0] ? profile.emails[0].value : null;
        const avatar =
          profile.photos && profile.photos[0] ? profile.photos[0].value : null;

        const id = `${provider}:${providerId}`;

        // Upsert user
        await pool.query(
          `INSERT INTO users (id, provider, provider_id, email, name, avatar, last_login_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (id)
           DO UPDATE SET
             email = EXCLUDED.email,
             name = EXCLUDED.name,
             avatar = EXCLUDED.avatar,
             updated_at = NOW(),
             last_login_at = NOW()`,
          [id, provider, providerId, email, name, avatar]
        );

        const user = { id, name, email, avatar, provider };
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

// OAuth start
app.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// OAuth callback
app.get(
  "/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/" }),
  (req, res) => {
    const jwtSecret = process.env.JWT_SECRET || "dev_jwt_secret";
    const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
    const token = jwt.sign(
      {
        sub: req.user.id,
        email: req.user.email,
        name: req.user.name,
        provider: req.user.provider,
        avatar: req.user.avatar,
      },
      jwtSecret,
      { expiresIn }
    );

    // Set HttpOnly cookie
    res.cookie("aesp_token", token, {
      httpOnly: true,
      secure: false, // set true behind HTTPS in prod
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Redirect back to frontend with token (to allow client-side storage if desired)
    const redirectUrl = process.env.CORS_ORIGIN || "http://localhost:3000";
    const t = encodeURIComponent(token);
    res.redirect(`${redirectUrl}/auth/callback?token=${t}`);
  }
);

// Current user info (from JWT cookie)
app.get("/me", (req, res) => {
  try {
    let token;
    const authHeader =
      req.headers["authorization"] || req.headers["Authorization"];
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      token = authHeader.slice(7).trim();
    } else {
      token = req.signedCookies?.aesp_token || req.cookies?.aesp_token;
    }
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const jwtSecret = process.env.JWT_SECRET || "dev_jwt_secret";
    const payload = jwt.verify(token, jwtSecret);
    return res.json({
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      provider: payload.provider,
      avatar: payload.avatar,
    });
  } catch (e) {
    return res.status(401).json({ error: "Unauthorized" });
  }
});

// Logout: clear cookie
app.post("/logout", (req, res) => {
  res.clearCookie("aesp_token", {
    httpOnly: true,
    secure: false, // set true behind HTTPS in prod
    sameSite: "lax",
  });
  return res.json({ ok: true });
});

// Convenience GET logout
app.get("/logout", (req, res) => {
  res.clearCookie("aesp_token", {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
  });
  const redirectUrl = process.env.CORS_ORIGIN || "http://localhost:3000";
  res.redirect(redirectUrl + "/login");
});

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
