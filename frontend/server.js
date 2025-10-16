const express = require("express");
const path = require("path");
const serveStatic = require("serve-static");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve Vite-built files
app.use(serveStatic(path.join(__dirname, "dist")));

// SPA fallback to index.html (use catch-all middleware to avoid path parsing)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Frontend served on http://0.0.0.0:${PORT}`);
});
