const cors = require("cors");

// Build a consistent CORS middleware for the gateway.
// Honors CORS_ORIGIN env (comma-separated) and enables credentials.
module.exports = function buildCors() {
  const raw = process.env.CORS_ORIGIN || "";
  const allowList = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowList.length === 0) {
    // default permissive in dev: reflect request origin
    return cors({ origin: true, credentials: true });
  }
  return cors({
    origin: function (origin, cb) {
      if (!origin || allowList.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  });
};
