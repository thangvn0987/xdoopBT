const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function createAiProxy(target) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: { "^/api/ai": "" },
    proxyTimeout: 120000,
    onProxyReq: (proxyReq, req) => {
      console.log(
        `[${new Date().toISOString()}] Proxying ${req.method} ${
          req.originalUrl
        } -> ${target}${proxyReq.path}`
      );
    },
    onProxyRes: (proxyRes, req) => {
      console.log(
        `[${new Date().toISOString()}] Response from ai-service for ${
          req.method
        } ${req.originalUrl}: ${proxyRes.statusCode}`
      );
    },
    onError: (err, req, res) => {
      console.error("Proxy error to ai-service:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Proxy error", error: err.message }));
    },
  });
};
