const express = require("express");
const fs = require("fs");
const path = require("path");
const morgan = require("morgan");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
const port = process.env.PORT || 3040;
const upstreamBaseUrl = process.env.UPSTREAM_BASE_URL;
const upstreamApiKey = process.env.UPSTREAM_API_KEY;
const logDir = process.env.PROXY_LOG_DIR || path.join(__dirname, "logs");

if (!upstreamBaseUrl || !upstreamApiKey) {
  console.error("Missing UPSTREAM_BASE_URL or UPSTREAM_API_KEY");
  process.exit(1);
}

fs.mkdirSync(logDir, { recursive: true });

const accessLogStream = fs.createWriteStream(path.join(logDir, "access.log"), {
  flags: "a"
});

app.use(morgan("combined", { stream: accessLogStream }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, upstream: upstreamBaseUrl });
});

app.use(
  "/",
  createProxyMiddleware({
    target: upstreamBaseUrl,
    changeOrigin: true,
    ws: true,
    proxyTimeout: 300000,
    timeout: 300000,
    pathRewrite: (requestPath) => requestPath,
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader("Authorization", `Bearer ${upstreamApiKey}`);
        proxyReq.setHeader("x-api-key", upstreamApiKey);

        if (!proxyReq.getHeader("anthropic-version")) {
          proxyReq.setHeader("anthropic-version", "2023-06-01");
        }

        console.error(
          `[proxy] ${req.method} ${req.url} -> ${upstreamBaseUrl}`
        );
      },
      proxyRes: (proxyRes, req) => {
        console.error(
          `[proxy] response ${proxyRes.statusCode} for ${req.method} ${req.url}`
        );
      },
      error: (error, req, res) => {
        console.error(
          `[proxy] error for ${req.method} ${req.url}: ${error.message}`
        );

        if (!res.headersSent) {
          res.status(502).json({
            ok: false,
            error: "proxy_upstream_unavailable",
            detail: error.message
          });
        }
      }
    }
  })
);

app.listen(port, () => {
  console.log(`Proxy running at http://localhost:${port}`);
  console.log(`Upstream: ${upstreamBaseUrl}`);
});
