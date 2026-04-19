# OpenClaw + Claude Code + Proxy 可执行操作指南

这份指南基于当前已跑通的真实版本整理，目标是：

- OpenClaw 通过 MCP 调用 Claude Code
- Claude Code 在本地真实创建 / 修改文件
- Claude Code 通过本地 Proxy 访问上游模型
- Proxy 由 PM2 守护，避免终端关闭后掉线

---

## 一、当前实际架构

```
VLM/图片请求: OpenClaw -> MiniMax 直连 (MINIMAX_API_HOST)
                绕过 proxy，不经过 localhost:3040

普通聊天请求: OpenClaw -> MCP: claude-bridge (sudo -u claude)
                   -> Claude Code CLI (/usr/bin/claude --bare -p ...)
                   -> Proxy (http://localhost:3040, model rewrite)
                   -> MiniMax (/anthropic/v1/messages)
```

说明：

- OpenClaw 负责调度
- `claude-bridge.mjs` 是 MCP 工具服务，以 `claude` 用户身份运行（通过 `sudo -u claude env ...` 注入环境变量）
- Claude Code 负责真实执行文件操作（沙箱限制：只能写 `CLAUDE_WORK_DIR` 下的文件）
- Proxy 统一持有真实上游 Key，处理聊天请求，同时做 model rewrite（`claude-sonnet-4-6` → `MiniMax-M2.7`）
- **VLM/图片请求走 MiniMax 直连**，由 `MINIMAX_API_HOST` 环境变量控制，绕过 proxy

---

## 二、当前目录结构

```text
/home/claude/ai-lab/
  └── bridge/
      ├── claude-bridge.mjs
      ├── bridge.log
      └── node_modules/

/root/ai-lab/
  └── proxy/
      ├── server.js
      ├── ecosystem.config.js
      ├── logs/
      │   └── access.log
      └── node_modules/

/home/claude/workspaces/demo/     ← Claude Code 的 WORK_DIR
```

---

## 三、前置条件

系统内需要具备以下环境：

- WSL Ubuntu
- Node.js / npm
- Claude Code CLI
- `claude` 系统用户
- OpenClaw 已可启动
- PM2 已安装

验证命令：

```bash
which claude && claude --version
node -v && npm -v
pm2 -v
id claude   # 确认 claude 用户存在
```

---

## 四、Bridge 文件

路径：`/home/claude/ai-lab/bridge/claude-bridge.mjs`

当前实际版本：

```js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const WORK_DIR = process.env.CLAUDE_WORK_DIR || "/home/claude/workspaces/demo";
const TIMEOUT  = parseInt(process.env.CLAUDE_TIMEOUT || "300000", 10);
const LOG_FILE = "/home/claude/ai-lab/bridge/bridge.log";

function ensureLogDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function log(msg) {
  ensureLogDir(LOG_FILE);
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
}

const server = new McpServer({
  name: "claude-bridge",
  version: "1.0.2"
});

server.tool(
  "run_claude",
  "使用 Claude Code 在本地创建/修改/运行文件。所有涉及文件操作的任务都必须调用此工具，不要自己假装生成文件。",
  { prompt: z.string().describe("要执行的任务描述") },
  async ({ prompt }) => {
    log(`tool called, cwd=${WORK_DIR}, prompt=${JSON.stringify(prompt)}`);

    return new Promise((resolve) => {
      const child = spawn("/usr/bin/claude", [
        "--bare", "-p", prompt,
        "--output-format", "json"
      ], {
        cwd: WORK_DIR,
        timeout: TIMEOUT,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          HOME: "/home/claude",
          USER: "claude",
          LOGNAME: "claude",
          PATH: process.env.PATH,
          ANTHROPIC_API_KEY: process.env.MINIMAX_API_KEY || "",
          ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || "http://localhost:3040"
        }
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", d => stdout += d.toString());
      child.stderr.on("data", d => stderr += d.toString());

      child.on("close", (code, signal) => {
        log(`close code=${code} signal=${signal ?? "none"} stdout_len=${stdout.length} stderr_len=${stderr.length}`);
        if (stdout.trim()) log(`stdout=${stdout.slice(0, 4000)}`);
        if (stderr.trim()) log(`stderr=${stderr.slice(0, 4000)}`);

        let text;
        if (stdout.trim()) {
          try { text = JSON.parse(stdout).result || stdout; }
          catch { text = stdout; }
        }
        if (!text && stderr.trim()) {
          try { text = JSON.parse(stderr).result || stderr; }
          catch { text = stderr; }
        }
        if (!text) {
          text = `Exit code: ${code}, signal: ${signal ?? "none"}`;
        }

        resolve({
          content: [{ type: "text", text }],
          isError: code !== 0
        });
      });

      child.on("error", (err) => {
        log(`spawn error: ${err.message}`);
        resolve({
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true
        });
      });
    });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
log("bridge: transport connected, waiting for messages...");
await new Promise((resolve) => setTimeout(resolve, 200));
log("bridge: transport closed");
```

**关键点说明**：
- `spawn("/usr/bin/claude", ["--bare", ...])` — 必须用绝对路径，`--bare` 跳过交互式登录检查
- `stdio: ["ignore", "pipe", "pipe"]` — stdin 指向 /dev/null 避免 "no stdin data received" 警告
- env 显式设置 `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL`，不用 `...process.env`（sudo 会过滤）
- `ensureLogDir()` 先创建日志目录，避免首次启动时因 `bridge.log` 路径不存在而报错
- `await server.connect()` 后额外等待 200ms，减少 `sudo -u claude` 切换时的 stdio 就绪问题
- WORK_DIR 只能写 `/home/claude/workspaces/demo` 及子目录（Claude Code 沙箱限制）

---

## 五、OpenClaw MCP 配置

把以下配置写入 `/root/.openclaw/openclaw.json` 的 `mcp.servers` 段落：

```json
"mcp": {
  "servers": {
    "claude-bridge": {
      "command": "/usr/bin/sudo",
      "args": [
        "-u", "claude", "env",
        "MINIMAX_API_KEY=${MINIMAX_API_KEY}",
        "MINIMAX_API_HOST=${MINIMAX_API_HOST}",
        "HOME=/home/claude",
        "ANTHROPIC_BASE_URL=http://localhost:3040",
        "/usr/bin/node",
        "/home/claude/ai-lab/bridge/claude-bridge.mjs"
      ],
      "type": "stdio",
      "env": {
        "HOME": "/home/claude",
        "USER": "claude",
        "LOGNAME": "claude",
        "CLAUDE_WORK_DIR": "/home/claude/workspaces/demo",
        "CLAUDE_TIMEOUT": "300000",
        "MINIMAX_API_KEY": "${MINIMAX_API_KEY}",
        "MINIMAX_API_HOST": "${MINIMAX_API_HOST}"
      }
    }
  }
}
```

说明：

- 用 `sudo -u claude env KEY=value` 方式注入环境变量（sudo 会过滤 `env:` dict 里的 `ANTHROPIC_API_KEY`，所以通过 sudo 的 args 传）
- `MINIMAX_API_KEY` 来自运行 OpenClaw 的 shell 环境变量
- `MINIMAX_API_HOST` 供 VLM/图片请求直连 MiniMax 使用
- OpenClaw 重启后生效：`pkill -f openclaw; openclaw &`

---

## 六、Proxy 文件

路径：`/root/ai-lab/proxy/server.js`

当前实际版本：

```js
const express = require("express");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
const PORT = process.env.PORT || 3040;
const UPSTREAM_BASE_URL = process.env.UPSTREAM_BASE_URL;
const UPSTREAM_API_KEY = process.env.UPSTREAM_API_KEY;

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

// 手动收集 body，避免 express.json() 消费 stream 导致兜底代理 body 为空
function collectBody(req, callback) {
  if (req.body !== undefined) return callback(null, Buffer.from(JSON.stringify(req.body)));
  const chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", () => callback(null, Buffer.concat(chunks)));
  req.on("error", callback);
}

app.get("/healthz", (req, res) => {
  res.json({ ok: true, upstream: UPSTREAM_BASE_URL });
});

// === Model Rewrite helper ===
function rewriteModelForUpstream(model) {
  if (!model) return model;
  if (UPSTREAM_BASE_URL.includes("minimax")) return "MiniMax-M2.7";
  if (UPSTREAM_BASE_URL.includes("bigmodel")) return "glm-4.7";
  return model;
}

// === 流式转发：透传上游响应体 + 响应头 ===
async function pipeUpstreamResponse(upstreamRes, res) {
  res.status(upstreamRes.status);
  const headersToForward = ["content-type", "transfer-encoding", "cache-control", "x-request-id", "anthropic-version"];
  for (const name of headersToForward) {
    const val = upstreamRes.headers.get(name);
    if (val !== null) res.setHeader(name, val);
  }
  if (upstreamRes.body) {
    Readable.fromWeb(upstreamRes.body).pipe(res);
  } else {
    res.end();
  }
}

// === Anthropic /anthropic/v1/messages with model rewrite ===
app.post("/anthropic/v1/messages", async (req, res) => {
  collectBody(req, (err, bodyBuf) => {
    if (err) return res.status(400).json({ error: "body_read_error" });
    let reqBody;
    try { reqBody = JSON.parse(bodyBuf.toString()); }
    catch { return res.status(400).json({ error: "invalid_json" }); }

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
        "anthropic-version": req.get("anthropic-version") || "2023-06-01",
      },
      body: rewrittenBody,
    }).then(upstreamRes => pipeUpstreamResponse(upstreamRes, res))
      .catch(err => {
        console.error(`[proxy] /anthropic/v1/messages error: ${err.message}`);
        if (!res.headersSent) res.status(502).json({ ok: false, error: "upstream_unavailable", detail: err.message });
      });
  });
});

// === Claude CLI /v1/messages (beta=true) with model rewrite ===
app.post("/v1/messages", async (req, res) => {
  collectBody(req, (err, bodyBuf) => {
    if (err) return res.status(400).json({ error: "body_read_error" });
    let reqBody;
    try { reqBody = JSON.parse(bodyBuf.toString()); }
    catch { return res.status(400).json({ error: "invalid_json" }); }

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
        "anthropic-version": req.get("anthropic-version") || "2023-06-01",
      },
      body: rewrittenBody,
    }).then(upstreamRes => pipeUpstreamResponse(upstreamRes, res))
      .catch(err => {
        console.error(`[proxy] /v1/messages error: ${err.message}`);
        if (!res.headersSent) res.status(502).json({ ok: false, error: "upstream_unavailable", detail: err.message });
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
        res.status(502).json({ ok: false, error: "proxy_upstream_unavailable", detail: err.message });
      }
    }
  }
}));

app.listen(PORT, () => {
  console.log(`Proxy running at http://localhost:${PORT}`);
  console.log(`Upstream: ${UPSTREAM_BASE_URL}`);
});
```

**关键点说明**：
- **没有** `express.json()`，用 `collectBody()` 手动收集，避免消费 stream 导致兜底代理 body 为空
- `pipeUpstreamResponse()` 流式透传上游响应，保留 `Content-Type`、`Transfer-Encoding` 等响应头
- `rewriteModelForUpstream()` 自动把 `claude-sonnet-4-6` 等映射为上游所需模型名

---

## 七、PM2 配置

路径：`/root/ai-lab/proxy/ecosystem.config.js`

```js
module.exports = {
  apps: [
    {
      name: "proxy",
      script: "./server.js",
      cwd: "/root/ai-lab/proxy",
      env: {
        PORT: "3040",
        UPSTREAM_BASE_URL: "https://api.minimaxi.com",
        UPSTREAM_API_KEY: process.env.UPSTREAM_API_KEY
      }
    }
  ]
};
```

说明：

- 真实 Key 通过 PM2 启动时的环境变量注入：`export UPSTREAM_API_KEY="你的key" && pm2 start ...`
- `UPSTREAM_BASE_URL` 只配到根域名，`/anthropic` 前缀由 `pathRewrite` 统一添加

---

## 八、首次安装步骤

### 1. 创建目录

```bash
mkdir -p /home/claude/ai-lab/bridge
mkdir -p /home/claude/workspaces/demo
mkdir -p /root/ai-lab/proxy/logs
```

### 2. 安装 Bridge 依赖

```bash
cd /home/claude/ai-lab/bridge
npm init -y
npm install @modelcontextprotocol/sdk zod
```

### 3. 安装 Proxy 依赖

```bash
cd /root/ai-lab/proxy
npm init -y
npm install express http-proxy-middleware morgan
```

### 4. 修复 session-env 权限（避免 sandbox 错误）

```bash
chown -R claude:claude /home/claude/.claude/
```

---

## 九、启动步骤

### 1. 启动 Proxy（由 PM2 管理）

```bash
export UPSTREAM_API_KEY="你的MiniMax API Key"
cd /root/ai-lab/proxy
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # 如果是首次，执行输出命令
```

### 2. 检查 Proxy 状态

```bash
pm2 list
curl http://localhost:3040/healthz
# → {"ok":true,"upstream":"https://api.minimaxi.com"}
```

### 3. 启动 OpenClaw

```bash
openclaw
# 重启以加载 MCP 配置更新
pkill -f openclaw; sleep 2; openclaw &
```

### 4. 检查 bridge 进程

```bash
ps -ef | grep "claude-bridge" | grep -v grep
```

预期能看到：

```
/usr/bin/sudo -u claude env ... /usr/bin/node /home/claude/ai-lab/bridge/claude-bridge.mjs
```

---

## 十、验证步骤

### A. 直接验证 Claude CLI 走 Proxy

```bash
export MINIMAX_API_KEY="你的key"
export ANTHROPIC_BASE_URL="http://localhost:3040"
export HOME="/home/claude"

claude --bare --print --output-format json -- "echo direct-proxy-ok"
```

预期输出 JSON 包含 `"result":"direct-proxy-ok"`。

### B. 验证 OpenClaw 通过 MCP 创建文件

```bash
openclaw agent --agent main --message "用run_claude工具执行: echo openclaw-ok && date" --json --local
```

### C. 查看 Proxy 请求日志

```bash
tail -n 20 /root/ai-lab/proxy/logs/access.log
pm2 logs proxy --lines 20 --nostream
```

预期看到 `POST /v1/messages?beta=true ... 200`，且日志显示 `claude-sonnet-4-6 -> MiniMax-M2.7`。

### D. 查看 Bridge 日志

```bash
tail -n 20 /home/claude/ai-lab/bridge/bridge.log
```

---

## 十一、常见问题

### 1. bridge 返回 "Not logged in · Please run /login"

原因：`sudo` 过滤了 `env:` dict 里的 `ANTHROPIC_API_KEY`，导致 Claude CLI 拿不到 Key。

修复：确认 `openclaw.json` 的 MCP 配置已改为 `sudo -u claude env MINIMAX_API_KEY=...` 格式（见第五节），然后重启 OpenClaw。

### 2. "permission denied, open '/home/claude/ai-lab/bridge/bridge.log'"

原因：目录不存在或属主不对。

修复：
```bash
mkdir -p /home/claude/ai-lab/bridge
touch /home/claude/ai-lab/bridge/bridge.log
chown claude:claude /home/claude/ai-lab/bridge/bridge.log
```

### 3. session-env 权限错误

```bash
chown -R claude:claude /home/claude/.claude/
```

### 4. `pm2 list` 中 `proxy` 为 `errored`

```bash
pm2 logs proxy --lines 50
# 常见原因：缺少 UPSTREAM_API_KEY 环境变量
export UPSTREAM_API_KEY="你的key" && pm2 restart proxy
```

### 5. Claude Code 沙箱阻止写文件

Claude Code 安全沙箱只允许在 `CLAUDE_WORK_DIR`（`/home/claude/workspaces/demo`）下写文件，`/tmp/` 等路径会被拒绝。这是正常行为，不是 bug。

---

## 十二、清理日志

```bash
# bridge 日志
> /home/claude/ai-lab/bridge/bridge.log

# proxy access 日志
> /root/ai-lab/proxy/logs/access.log
```

---

## 十三、备份建议

至少备份：

```text
/home/claude/ai-lab/bridge/         （bridge 代码 + 日志）
/root/ai-lab/proxy/                   （proxy 代码 + 配置）
/root/.openclaw/openclaw.json         （MCP 配置）
/home/claude/workspaces/demo/         （项目文件）
```

推荐备份到 Windows：

```bash
tar -czvf /mnt/c/Users/litaozhe/Desktop/ai-lab-backup.tar.gz \
  /home/claude/ai-lab/bridge/ \
  /root/ai-lab/proxy/ \
  /root/.openclaw/openclaw.json \
  /home/claude/workspaces/demo/
```

---

## 十四、关键文件路径汇总

| 文件 | 路径 |
|------|------|
| Bridge 代码 | `/home/claude/ai-lab/bridge/claude-bridge.mjs` |
| Bridge 日志 | `/home/claude/ai-lab/bridge/bridge.log` |
| Proxy 代码 | `/root/ai-lab/proxy/server.js` |
| Proxy PM2 配置 | `/root/ai-lab/proxy/ecosystem.config.js` |
| Proxy 日志目录 | `/root/ai-lab/proxy/logs/` |
| OpenClaw MCP 配置 | `/root/.openclaw/openclaw.json` |
| Claude Code 工作目录 | `/home/claude/workspaces/demo` |
