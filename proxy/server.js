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

app.get("/healthz", (req, res) => {
  res.json({ ok: true, upstream: UPSTREAM_BASE_URL });
});

// 手动收集 body，避免 express.json() 消费 stream 导致兜底代理 body 为空
function collectBody(req, callback) {
  if (req.body !== undefined) {
    callback(null, Buffer.from(JSON.stringify(req.body)));
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => callback(null, Buffer.concat(chunks)));
  req.on("error", callback);
}

// === MODEL REWRITE helper ===
function rewriteModelForUpstream(model) {
  if (!model) return model;
  if (UPSTREAM_BASE_URL.includes("minimax")) return "MiniMax-M2.7";
  if (UPSTREAM_BASE_URL.includes("bigmodel")) return "glm-4.7";
  return model;
}

async function pipeUpstreamResponse(upstreamRes, res) {
  res.status(upstreamRes.status);

  const headersToForward = [
    "content-type",
    "transfer-encoding",
    "cache-control",
    "x-request-id",
    "anthropic-version"
  ];

  for (const name of headersToForward) {
    const value = upstreamRes.headers.get(name);
    if (value !== null) {
      res.setHeader(name, value);
    }
  }

  if (!upstreamRes.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstreamRes.body).pipe(res);
}

// === Anthropic /anthropic/v1/messages with model rewrite ===
app.post("/anthropic/v1/messages", async (req, res) => {
  collectBody(req, (err, bodyBuf) => {
    if (err) {
      res.status(400).json({ error: "body_read_error" });
      return;
    }

    let reqBody;
    try {
      reqBody = JSON.parse(bodyBuf.toString());
    } catch {
      res.status(400).json({ error: "invalid_json" });
      return;
    }

    const originalModel = reqBody.model || "";
    const rewrittenModel = rewriteModelForUpstream(originalModel);
    const upstreamUrl = `${UPSTREAM_BASE_URL}/anthropic/v1/messages`;
    const rewrittenBody = JSON.stringify({ ...reqBody, model: rewrittenModel });

    console.error(`[proxy] /anthropic/v1/messages: ${originalModel} -> ${rewrittenModel}`);

    fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${UPSTREAM_API_KEY}`,
        "x-api-key": UPSTREAM_API_KEY,
        "Content-Type": "application/json",
        "anthropic-version": req.get("anthropic-version") || "2023-06-01"
      },
      body: rewrittenBody
    })
      .then((upstreamRes) => pipeUpstreamResponse(upstreamRes, res))
      .catch((fetchErr) => {
        console.error(`[proxy] /anthropic/v1/messages error: ${fetchErr.message}`);
        if (!res.headersSent) {
          res.status(502).json({ ok: false, error: "upstream_unavailable", detail: fetchErr.message });
        }
      });
  });
});

// === Claude CLI /v1/messages (beta=true) with model rewrite ===
app.post("/v1/messages", async (req, res) => {
  collectBody(req, (err, bodyBuf) => {
    if (err) {
      res.status(400).json({ error: "body_read_error" });
      return;
    }

    let reqBody;
    try {
      reqBody = JSON.parse(bodyBuf.toString());
    } catch {
      res.status(400).json({ error: "invalid_json" });
      return;
    }

    const originalModel = reqBody.model || "";
    const rewrittenModel = rewriteModelForUpstream(originalModel);
    const upstreamUrl = `${UPSTREAM_BASE_URL}/anthropic/v1/messages`;
    const rewrittenBody = JSON.stringify({ ...reqBody, model: rewrittenModel });

    console.error(`[proxy] /v1/messages (beta): ${originalModel} -> ${rewrittenModel}`);

    fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${UPSTREAM_API_KEY}`,
        "x-api-key": UPSTREAM_API_KEY,
        "Content-Type": "application/json",
        "anthropic-version": req.get("anthropic-version") || "2023-06-01"
      },
      body: rewrittenBody
    })
      .then((upstreamRes) => pipeUpstreamResponse(upstreamRes, res))
      .catch((fetchErr) => {
        console.error(`[proxy] /v1/messages error: ${fetchErr.message}`);
        if (!res.headersSent) {
          res.status(502).json({ ok: false, error: "upstream_unavailable", detail: fetchErr.message });
        }
      });
  });
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
