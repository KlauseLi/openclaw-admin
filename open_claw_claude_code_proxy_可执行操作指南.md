# OpenClaw + Claude Code + Proxy 可执行操作指南

这份指南基于当前已跑通的真实版本整理。当前主方向已经从 `claude-bridge` 切到 `skill script / exec 直调 Claude Code`，bridge 只保留为历史参考。

- OpenClaw 通过 skill script / exec 调用 Claude Code
- Claude Code 在本地真实创建 / 修改文件
- 需要代理的聊天请求通过本地 Proxy 访问上游模型
- Proxy 由 PM2 守护，避免终端关闭后掉线

---

## 一、当前实际架构

```
VLM/图片请求: OpenClaw -> MiniMax 直连 (MINIMAX_API_HOST)
                绕过 proxy，不经过 localhost:3040

Claude Code 执行请求: OpenClaw
                     -> skill script / exec
                     -> su - claude
                     -> Claude Code CLI

需要代理的聊天请求: Claude Code
                     -> Proxy (http://localhost:3040, model rewrite)
                     -> MiniMax (/anthropic/v1/messages)
```

说明：

- OpenClaw 负责调度
- `skills/claude-code/scripts/run.sh` 是当前推荐入口，通过 `su - claude` 执行 Claude Code
- Claude Code 负责真实执行文件操作（沙箱限制：只能写工作目录下的文件）
- Proxy 只处理需要代理的聊天请求，同时做 model rewrite（`claude-sonnet-4-6` → `MiniMax-M2.7`）
- **VLM/图片请求走 MiniMax 直连**，由 `MINIMAX_API_HOST` 环境变量控制，绕过 proxy
- `bridge/` 不再作为生产方案继续扩展，避免把本来不该走 proxy 的请求卷入旧链路

---

## 二、当前目录结构

```text
/root/.openclaw/workspace/
  └── skills/
      └── claude-code/
          ├── SKILL.md
          └── scripts/
              └── run.sh

/home/claude/
  ├── .claude/
  │   └── settings.json
  ├── .claude.json
  └── workspaces/demo/

/root/ai-lab/
  └── proxy/
      ├── server.js
      ├── ecosystem.config.js
      ├── logs/
      │   └── access.log
      └── node_modules/
/root/.openclaw/workspace/memory/  ← 后续 async job 状态建议落这里
```

仓库内建议同步保持的骨架：

```text
skills/
  └── claude-code/
      ├── SKILL.md
      └── scripts/
          └── run.sh

bridge/   ← deprecated reference only
proxy/
```

> 说明：
> 从本节开始，后面仍保留了一批旧的 `bridge` 配置、日志和验证内容，主要用于历史对照与迁移参考。
> 它们不再代表当前推荐生产方案。后续如果继续整理文档，应优先把这些章节逐步替换成 `skills/claude-code/scripts/run.sh` 的实际用法。

当前推荐直接使用下面这组命令：

```bash
# 短任务
bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh sync "任务描述" -w /工作目录

# 长任务
bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh async "任务描述" -w /工作目录
bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh status <job_id>
bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh result <job_id>
bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh cancel <job_id>
bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh list
```

当前实测已通过：

- `sync`
- `async`
- `status`
- `result`
- `cancel`
- `list`

### 当前生产接入方式

`claude-code` 作为 workspace skill 被 OpenClaw 自动发现，不需要再通过 `mcp.servers.claude-bridge` 注册生产入口。确认方式：

```bash
openclaw skills list | grep claude-code
openclaw skills info claude-code
```

预期 `claude-code` 来源为 `openclaw-workspace` 且状态为 `ready`。实际执行入口仍然是：

```bash
bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh sync "任务描述" -w /工作目录
```

异步任务状态默认写入：

```text
/root/.openclaw/workspace/memory/claude-jobs/
/root/.openclaw/workspace/memory/pending_jobs.md
```

`openclaw.example.json` 中的 `mcp.servers` 默认保持为空。除非需要回放历史 bridge 方案，否则不要重新启用 `claude-bridge`。

### 当前接续状态（2026-04-25）

已经完成并推送到 GitHub `main`：

- `d5255a3 docs: align claude skill runbook with run.sh mainline`
- `84e0f52 fix: harden claude async job state handling`

live workspace 状态：

- 仓库版 `skills/claude-code/SKILL.md` 已同步到 `/root/.openclaw/workspace/skills/claude-code/SKILL.md`
- 仓库版 `skills/claude-code/scripts/run.sh` 已同步到 `/root/.openclaw/workspace/skills/claude-code/scripts/run.sh`
- 旧备份目录已移出 active skills 扫描范围：
  `/root/.openclaw/workspace/skill-backups/claude-code.bak-2026-04-24`
- `openclaw skills info claude-code` 当前应显示：
  `Path: ~/.openclaw/workspace/skills/claude-code/SKILL.md`

端到端验证状态：

- 新 session 中显式提到 `claude-code skill` 后，OpenClaw agent 会注入 `claude-code`
- agent 已能通过 `exec` 实际调用 `run.sh sync` 并创建 `claude:claude` 属主文件
- agent 已能通过 `exec` 实际调用 `run.sh async` 并返回 `job_id`
- `run.sh async` worker 已用 `setsid nohup` 加固
- `status` / `result` / `list` / `cancel` 会自动识别 dead PID，把陈旧 `running` job 收尾为 `failed`

当前阻塞：

```text
claude --print
  -> Bun posix_spawn /mnt/c/Windows/System32/reg.exe
  -> EIO: i/o error
```

直接测试 `/mnt/c/Windows/System32/reg.exe` 也会返回 `Input/output error`，所以当前阻塞在 WSL/Windows interop 或 Claude Code CLI 的平台探测，不在 OpenClaw skill 注入或 async job 管理层。下次优先修这个问题，然后重跑第十一节和第十三节的验证。

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

## 四、Skill 主线文件

路径：`/root/.openclaw/workspace/skills/claude-code/`

当前生产文件：

```text
/root/.openclaw/workspace/skills/claude-code/SKILL.md
/root/.openclaw/workspace/skills/claude-code/scripts/run.sh
```

仓库对应文件：

```text
skills/claude-code/SKILL.md
skills/claude-code/scripts/run.sh
```

关键点：

- OpenClaw 通过 workspace skill 发现 `claude-code`
- `run.sh` 通过 `su - claude` 运行 Claude Code CLI
- 短任务用 `sync`
- 长任务用 `async` 启动，再用 `status` / `result` / `cancel` / `list` 管理
- job metadata 写入 `/root/.openclaw/workspace/memory/claude-jobs`
- pending 摘要写入 `/root/.openclaw/workspace/memory/pending_jobs.md`

`claude` 用户需要具备：

```text
/home/claude/.claude/settings.json
/home/claude/.claude.json
```

其中 `settings.json` 里配置 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL`；`.claude.json` 至少需要 `hasCompletedOnboarding:true`。

---

## 五、Bridge 文件（历史参考）

路径：`/home/claude/ai-lab/bridge/claude-bridge.mjs`

下面内容只用于历史对照，不再是当前推荐生产入口。当前生产入口见上一节的 `skills/claude-code/scripts/run.sh`。

历史版本：

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

## 六、OpenClaw MCP 配置（历史参考）

生产主线不需要配置 `claude-bridge` MCP。当前推荐在 `/root/.openclaw/openclaw.json` 中保持：

```json
"mcp": {
  "servers": {}
}
```

如果需要回放旧 bridge 方案，才把以下配置写入 `/root/.openclaw/openclaw.json` 的 `mcp.servers` 段落：

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

## 七、Proxy 文件

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

## 八、PM2 配置

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

## 九、首次安装步骤

### 1. 创建目录

```bash
mkdir -p /root/.openclaw/workspace/skills/claude-code/scripts
mkdir -p /root/.openclaw/workspace/memory/claude-jobs
mkdir -p /home/claude/workspaces/demo
mkdir -p /root/ai-lab/proxy/logs
```

### 2. 同步 Skill 文件

```bash
cp -r skills/claude-code /root/.openclaw/workspace/skills/
chmod +x /root/.openclaw/workspace/skills/claude-code/scripts/run.sh
```

### 3. 安装 Proxy 依赖

```bash
cd /root/ai-lab/proxy
npm init -y
npm install express http-proxy-middleware morgan
```

### 4. 修复 Claude 配置权限（避免 session-env 权限错误）

```bash
chown -R claude:claude /home/claude/.claude/
chown claude:claude /home/claude/.claude.json
```

---

## 十、启动步骤

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
# 重启以加载 skill / 配置更新
pkill -f openclaw; sleep 2; openclaw &
```

### 4. 检查 claude-code skill

```bash
openclaw skills list | grep claude-code
```

预期能看到 `claude-code` 为 `ready`。

### 5. 直接检查 run.sh

短任务：

```bash
bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh sync "echo skill-ok" -w /home/claude/workspaces/demo
```

长任务：

```bash
job_id="$(bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh async "echo async-ok" -w /home/claude/workspaces/demo)"
bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh status "$job_id"
bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh result "$job_id"
```

---

## 十一、验证步骤

### A. 直接验证 Claude CLI 走 Proxy

```bash
export MINIMAX_API_KEY="你的key"
export ANTHROPIC_BASE_URL="http://localhost:3040"
export HOME="/home/claude"

claude --bare --print --output-format json -- "echo direct-proxy-ok"
```

预期输出 JSON 包含 `"result":"direct-proxy-ok"`。

### B. 验证 OpenClaw 识别 claude-code skill

```bash
openclaw skills info claude-code
```

### C. 查看 Proxy 请求日志

```bash
tail -n 20 /root/ai-lab/proxy/logs/access.log
pm2 logs proxy --lines 20 --nostream
```

预期看到 `POST /v1/messages?beta=true ... 200`，且日志显示 `claude-sonnet-4-6 -> MiniMax-M2.7`。

### D. 查看 run.sh 异步任务记录

```bash
tail -n 20 /root/.openclaw/workspace/memory/pending_jobs.md
ls -lt /root/.openclaw/workspace/memory/claude-jobs | head
```

---

## 十二、常见问题

### 1. Claude Code 返回 "Not logged in · Please run /login"

原因：`claude` 用户的 Claude Code 配置不完整，常见是 `/home/claude/.claude/settings.json` 缺少 `ANTHROPIC_AUTH_TOKEN` 或 `/home/claude/.claude.json` 缺少 `hasCompletedOnboarding:true`。

修复：确认这两个文件存在且属主为 `claude`，然后用 `su - claude` 直接验证 Claude CLI。

### 2. 异步任务状态文件写入失败

原因：`/root/.openclaw/workspace/memory/` 或 `claude-jobs/` 不存在。

修复：
```bash
mkdir -p /root/.openclaw/workspace/memory/claude-jobs
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

### 6. `claude --print` 报 `reg.exe` EIO

现象：

```text
EIO: i/o error, posix_spawn '/mnt/c/Windows/System32/reg.exe'
```

已确认：

```bash
su - claude -c "claude --version"   # 正常
su - claude -c 'cd /home/claude/workspaces/openclaw-agent-smoke && claude --print "测试"'  # 触发 EIO
/mnt/c/Windows/System32/reg.exe query "HKCU\\Console"  # WSL 侧直接 Input/output error
```

结论：这是当前 WSL 对 Windows 可执行文件 interop 的问题，Claude Code CLI 的 Bun 运行时在 `--print` 路径里触发了 Windows 平台探测。优先修复 WSL interop / Windows mount 后再继续验证 Claude Code 实际执行。

---

## 十三、已知局限

### 1. `run.sh sync` 适合短任务，不适合长时间执行任务

当前链路仍然要注意调用方超时：

- OpenClaw / channel / agent 调用侧可能有自己的等待时间
- 同步 `run.sh sync` 会一直等待 Claude CLI 返回，仍应只用于较短任务

已确认的真实行为是：

- 如果 Claude Code 实际任务执行时间较长，OpenClaw 这一层可能会先超时返回
- 这时底层 `claude` 进程不一定会立刻停止，可能还会继续跑
- 但 OpenClaw 侧已经拿不到最终结果，所以用户看到的是调用超时

这不是网络问题，也不是 Proxy 超时主导，而是同步调用天然不适合长时间任务。

### 2. 当前适合的任务类型

适合：

- 简短 shell 命令
- 简单文件创建或小范围修改
- 几十秒内能完成的任务

不适合：

- 长时间代码扫描
- 大规模文件改写
- 需要长时间跑测试、构建、安装依赖的任务

### 3. 现阶段的应对方式

- 把任务拆小，优先让每次 `sync` 调用在较短时间内完成
- 把“分析”和“执行”拆成多次调用，不要一次塞进太长流程
- 如果任务天然是长任务，直接使用 `async` + `status` + `result`

一句话总结：

**这套方案当前把短任务放在 `sync`，把长任务放在 `async`，不要把长时间执行完全挂在一次同步调用里。**

### 4. 已实现的异步替代方案

为了解决长任务阻塞问题，当前 `skills/claude-code/scripts/run.sh` 已经补上了一套异步任务命令：

- `sync`
  用于几十秒内能完成的短任务。

- `async`
  启动后台 Claude 任务，立即返回 `job_id`。

- `status`
  查询任务状态，典型状态包括 `running`、`succeeded`、`failed`、`cancelled`、`timed_out`。

- `result`
  读取任务最终结果、stdout、stderr 和解析后的 `parsed_result`。

- `cancel`
  取消正在运行的后台任务。

- `list`
  查看最近的任务列表和历史状态。

异步管理层加固点：

- `async` 用 `setsid nohup` 启动 worker，避免 OpenClaw `exec` 返回时连带清理后台进程。
- `status` / `result` / `list` / `cancel` 会调用状态 reconciliation。
- 如果 meta 里还是 `running`，但 PID 已不存在：
  - 有 exit 文件则按 exit code 收尾
  - 无 exit 文件则标记为 `failed`
  - `exit_code=255`
  - `signal=worker_missing`

推荐调用方式：

1. 短任务继续直接调用 `sync`
2. 长任务先调 `async`
3. 拿到 `job_id` 后，轮询 `status`
4. 状态结束后，再调 `result`
5. 如需中止，调用 `cancel`

这套方式的关键点不是“拉长单次同步调用超时”，而是把长任务从“单次同步调用”改成“启动 + 轮询 + 取结果”的异步模型。

### 5. 当前验证结果

已在 WSL 环境中验证通过以下场景：

- `sync` 短任务成功返回
- `async` 可启动后台任务并轮询到 `succeeded`
- `result` 可读到最终 `parsed_result`
- `cancel` 可将运行中任务变成 `cancelled`
- `list` 可列出历史任务
- OpenClaw agent 新 session 可注入 `claude-code` skill
- OpenClaw agent 可通过 `exec` 调用 `run.sh async` 并拿到 `job_id`
- 陈旧 `running` job 可自动收尾为 `failed / worker_missing`

当前未通过项：

- Claude Code CLI 实际执行 `claude --print`，受 `/mnt/c/Windows/System32/reg.exe` EIO 阻塞

推荐复用这组命令验证：

```bash
bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh sync "echo sync-ok" -w /home/claude/workspaces/demo
job_id="$(bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh async "echo async-ok" -w /home/claude/workspaces/demo)"
bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh status "$job_id"
bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh result "$job_id"
bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh list
```

---

## 十四、清理日志

```bash
# run.sh pending job 摘要
> /root/.openclaw/workspace/memory/pending_jobs.md

# proxy access 日志
> /root/ai-lab/proxy/logs/access.log
```

---

## 十五、备份建议

至少备份：

```text
/root/.openclaw/workspace/skills/claude-code/ （skill 入口）
/root/.openclaw/workspace/memory/claude-jobs/ （异步任务状态）
/root/ai-lab/proxy/                   （proxy 代码 + 配置）
/root/.openclaw/openclaw.json         （OpenClaw 配置）
/home/claude/workspaces/demo/         （项目文件）
```

推荐备份到 Windows：

```bash
tar -czvf /mnt/c/Users/litaozhe/Desktop/ai-lab-backup.tar.gz \
  /root/.openclaw/workspace/skills/claude-code/ \
  /root/.openclaw/workspace/memory/claude-jobs/ \
  /root/ai-lab/proxy/ \
  /root/.openclaw/openclaw.json \
  /home/claude/workspaces/demo/
```

---

## 十六、关键文件路径汇总

| 文件 | 路径 |
|------|------|
| Skill 说明 | `/root/.openclaw/workspace/skills/claude-code/SKILL.md` |
| Skill 入口 | `/root/.openclaw/workspace/skills/claude-code/scripts/run.sh` |
| Async job 状态目录 | `/root/.openclaw/workspace/memory/claude-jobs/` |
| Pending job 摘要 | `/root/.openclaw/workspace/memory/pending_jobs.md` |
| Proxy 代码 | `/root/ai-lab/proxy/server.js` |
| Proxy PM2 配置 | `/root/ai-lab/proxy/ecosystem.config.js` |
| Proxy 日志目录 | `/root/ai-lab/proxy/logs/` |
| OpenClaw 配置 | `/root/.openclaw/openclaw.json` |
| Claude Code 工作目录 | `/home/claude/workspaces/demo` |
