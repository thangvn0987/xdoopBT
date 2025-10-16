require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:3000",
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser(process.env.SESSION_SECRET || "dev_secret"));
app.use(passport.initialize());

const SERVICE_NAME = process.env.SERVICE_NAME || "auth-service";
const PORT = Number(process.env.PORT) || 3000;

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

passport.use(new GoogleStrategy(
  {
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: GOOGLE_CALLBACK_URL,
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      // TODO: upsert user into DB here, using profile.id / emails[0]
      const user = {
        id: profile.id,
        name: profile.displayName,
        email: profile.emails && profile.emails[0] ? profile.emails[0].value : undefined,
        avatar: profile.photos && profile.photos[0] ? profile.photos[0].value : undefined,
        provider: 'google'
      };
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

// OAuth start
app.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// OAuth callback
app.get('/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/' }),
  (req, res) => {
    const jwtSecret = process.env.JWT_SECRET || 'dev_jwt_secret';
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    const token = jwt.sign({
      sub: req.user.id,
      email: req.user.email,
      name: req.user.name,
      provider: req.user.provider,
    }, jwtSecret, { expiresIn });

    // Set HttpOnly cookie
    res.cookie('aesp_token', token, {
      httpOnly: true,
      secure: false, // set true behind HTTPS in prod
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Redirect back to frontend
    const redirectUrl = process.env.CORS_ORIGIN || 'http://localhost:3000';
    res.redirect(redirectUrl + '/');
  }
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}`);
});
