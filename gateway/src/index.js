require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
// Important: Do NOT parse request bodies before proxying.
// Body parsers consume the stream, causing proxied PUT/POST with JSON bodies
// to arrive empty at target services and hang (leading to client timeouts).
// Each downstream service handles its own body parsing.
// app.use(express.json());

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT) || 8080;
const services = {
  auth: `http://auth-service:3000`,
  learner: `http://learner-service:3000`,
  mentor: `http://mentor-service:3000`,
  ai: `http://ai-service:3000`,
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
app.use(
  "/api/mentor",
  createProxyMiddleware({
    target: services.mentor,
    changeOrigin: true,
    pathRewrite: { "^/api/mentor": "" },
  })
);
app.use(
  "/api/ai",
  createProxyMiddleware({
    target: services.ai,
    changeOrigin: true,
    pathRewrite: { "^/api/ai": "" },
  })
);

// Serve frontend (fallback proxy)
app.use(
  "/",
  createProxyMiddleware({ target: services.frontend, changeOrigin: true })
);

app.listen(GATEWAY_PORT, "0.0.0.0", () => {
  console.log(`Gateway listening on ${GATEWAY_PORT}`);
});
