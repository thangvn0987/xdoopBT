require("dotenv").config();

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const buildCors = require("./config/cors");
const createAiProxy = require("./proxy/ai");
const createPronunciationProxy = require("./proxy/pronunciation");
const rateLimit = require("express-rate-limit");

const app = express();
app.set("trust proxy", 1);
// Centralized CORS with allowlist via CORS_ORIGIN env
app.use(buildCors());

const gatewayLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 429,
    message:
      "Too many requests from this IP to the Gateway, please try again later.",
  },
});
app.use(gatewayLimiter);

// Do NOT parse bodies here; we proxy raw requests to backend services.

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT) || 8080;
const services = {
  auth: `http://auth-service:3000`,
  learner: `http://learner-service:3000`,
  mentor: `http://mentor-service:3000`,
  ai: `http://ai-service:3000`,
  pronunciation: `http://pronunciation-assessment:8085`,
  frontend: `http://frontend:3000`,
};

app.get("/health", (req, res) => {
  res.json({ status: "ok", gateway: true, time: new Date().toISOString() });
});

// Proxy API routes
app.use(
  "/api/auth",
  createProxyMiddleware({
    target: services.auth,
    changeOrigin: true,
    pathRewrite: { "^/api/auth": "" },
  })
);
app.use(
  "/api/learners",
  createProxyMiddleware({
    target: services.learner,
    changeOrigin: true,
    pathRewrite: { "^/api/learners": "" },
  })
);
// Learning Path API v1 -> learner-service (extended there)
app.use(
  "/api/v1/learning-path",
  createProxyMiddleware({
    target: services.learner,
    changeOrigin: true,
    pathRewrite: { "^/api/v1/learning-path": "/learning-path" },
  })
);
app.use(
  "/api/mentor",
  createProxyMiddleware({
    target: services.mentor,
    changeOrigin: true,
    pathRewrite: { "^/api/mentor": "" },
  })
);
app.use("/api/ai", createAiProxy(services.ai));

app.use("/api/pronunciation", createPronunciationProxy(services.pronunciation));

// Serve frontend (fallback proxy)
app.use(
  "/",
  createProxyMiddleware({ target: services.frontend, changeOrigin: true })
);

app.listen(GATEWAY_PORT, "0.0.0.0", () => {
  console.log(`Gateway listening on ${GATEWAY_PORT}`);
});
