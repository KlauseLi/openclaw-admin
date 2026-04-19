const express = require("express");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
const PORT = process.env.PORT || 3040;
const UPSTREAM_BASE_URL = process.env.UPSTREAM_BASE_URL;
const UPSTREAM_API_KEY=process.env.UPSTREAM_API_KEY;

if (!UPSTREAM_BASE_URL || !UPSTREAM_API_KEY) {
  console.error("Missing UPSTREAM_BASE_URL or UPSTREAM_API_KEY");
  process.exit(1);
}

const logDir = path.join(__dirname, "logs");
fs.mkdirSync(logDir, { recursive: true });

const accessLogStream = fs.createWriteStream(
  path.join(logDir, "access.log"),
  { flags: "a" }
);

app.use(morgan("combined", { stream: accessLogStream }));

app.use(express.json({ verify: (req) => { req.rawBody = req.body; }, limit: "10mb" }));

app.get("/healthz", (req, res) => {
  res.json({ ok: true, upstream: UPSTREAM_BASE_URL });
});

// === MODEL REWRITE helper ===
function rewriteModelForUpstream(model) {
  if (!model) return model;
  if (UPSTREAM_BASE_URL.includes("minimax")) return "MiniMax-M2.7";
  if (UPSTREAM_BASE_URL.includes("bigmodel")) return "glm-4.7";
  return model;
}

function forwardUpstreamResponse(upstreamRes, res) {
  res.status(upstreamRes.status);

  upstreamRes.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "transfer-encoding") {
      res.setHeader(key, value);
    }
  });

  if (!upstreamRes.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstreamRes.body).pipe(res);
}

function writeProxyRequestBody(proxyReq, req) {
  if (!req.body || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return;
  }

  const contentType = proxyReq.getHeader("Content-Type") || req.get("content-type") || "";
  if (!String(contentType).includes("application/json")) {
    return;
  }

  const body = JSON.stringify(req.body);
  proxyReq.setHeader("Content-Length", Buffer.byteLength(body));
  proxyReq.write(body);
}

// === Anthropic /anthropic/v1/messages with model rewrite ===
app.post("/anthropic/v1/messages", async (req, res) => {
  const originalModel = req.body.model || "";
  const rewrittenModel = rewriteModelForUpstream(originalModel);
  const upstreamUrl = `${UPSTREAM_BASE_URL}/anthropic/v1/messages`;
  const body = JSON.stringify({ ...req.body, model: rewrittenModel });

  console.error(`[proxy] /anthropic/v1/messages: ${originalModel} -> ${rewrittenModel}`);

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${UPSTREAM_API_KEY}`,
        "x-api-key": UPSTREAM_API_KEY,
        "Content-Type": "application/json",
        "anthropic-version": req.get("anthropic-version") || "2023-06-01",
      },
      body,
    });

    console.error(`[proxy] upstream status=${upstreamRes.status}`);
    forwardUpstreamResponse(upstreamRes, res);
  } catch (err) {
    console.error(`[proxy] /anthropic/v1/messages error: ${err.message}`);
    res.status(502).json({ ok: false, error: "upstream_unavailable", detail: err.message });
  }
});

// === Claude CLI /v1/messages (beta=true) with model rewrite ===
app.post("/v1/messages", async (req, res) => {
  const originalModel = req.body.model || "";
  const rewrittenModel = rewriteModelForUpstream(originalModel);
  const upstreamUrl = `${UPSTREAM_BASE_URL}/anthropic/v1/messages`;
  const body = JSON.stringify({ ...req.body, model: rewrittenModel });

  console.error(`[proxy] /v1/messages (beta): ${originalModel} -> ${rewrittenModel}`);

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${UPSTREAM_API_KEY}`,
        "x-api-key": UPSTREAM_API_KEY,
        "Content-Type": "application/json",
        "anthropic-version": req.get("anthropic-version") || "2023-06-01",
      },
      body,
    });

    console.error(`[proxy] upstream status=${upstreamRes.status}`);
    forwardUpstreamResponse(upstreamRes, res);
  } catch (err) {
    console.error(`[proxy] /v1/messages error: ${err.message}`);
    res.status(502).json({ ok: false, error: "upstream_unavailable", detail: err.message });
  }
});

app.use("/", createProxyMiddleware({
  target: UPSTREAM_BASE_URL,
  changeOrigin: true,
  ws: true,
  proxyTimeout: 300000,
  timeout: 300000,
  pathRewrite: (pathReq) => `/anthropic${pathReq}`,
  on: {
    proxyReq: (proxyReq, req, res) => {
      proxyReq.setHeader("Authorization", `Bearer ${UPSTREAM_API_KEY}`);
      proxyReq.setHeader("x-api-key", UPSTREAM_API_KEY);

      if (!proxyReq.getHeader("anthropic-version")) {
        proxyReq.setHeader("anthropic-version", "2023-06-01");
      }

      writeProxyRequestBody(proxyReq, req);

      console.error(`[proxy] ${req.method} ${req.url} -> ${UPSTREAM_BASE_URL}`);
    },
    proxyRes: (proxyRes, req, res) => {
      console.error(`[proxy] response ${proxyRes.statusCode} for ${req.method} ${req.url}`);

      // 非 2xx 时记录上游返回的错误体（前1KB），方便排查 4xx/5xx 问题
      if (proxyRes.statusCode >= 400) {
        const chunks = [];
        proxyRes.on("data", chunk => chunks.push(chunk));
        proxyRes.on("end", () => {
          const body = Buffer.concat(chunks).toString().slice(0, 1000);
          console.error(`[proxy] upstream error body (${proxyRes.statusCode}): ${body}`);
        });
      }
    },
    error: (err, req, res) => {
      console.error(`[proxy] error for ${req.method} ${req.url}: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({
          ok: false,
          error: "proxy_upstream_unavailable",
          detail: err.message
        });
      }
    }
  }
}));

app.listen(PORT, () => {
  console.log(`Proxy running at http://localhost:${PORT}`);
  console.log(`Upstream: ${UPSTREAM_BASE_URL}`);
});
