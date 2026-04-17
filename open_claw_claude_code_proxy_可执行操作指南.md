# OpenClaw + Claude Code + Proxy 可执行操作指南

这份指南基于当前已跑通的真实版本整理，目标是：

- OpenClaw 通过 MCP 调用 Claude Code
- Claude Code 在本地真实创建 / 修改文件
- Claude Code 通过本地 Proxy 访问上游模型
- Proxy 由 PM2 守护，避免终端关闭后掉线

---

## 一、当前实际架构

```text
OpenClaw
  -> MCP: claude-bridge
  -> Claude Code CLI
  -> Proxy (http://localhost:3040)
  -> 上游模型 (当前是 lanyiapi)
```

说明：

- OpenClaw 负责调度
- `claude-bridge.mjs` 是 MCP 工具服务
- Claude Code 负责真实执行文件操作
- Proxy 统一持有真实上游 Key
- Claude Code 只使用 dummy token 连接本地 Proxy

---

## 二、当前目录结构

```text
/root/ai-lab/
  ├── bridge/
  │   └── claude-bridge.mjs
  └── proxy/
      ├── server.js
      ├── ecosystem.config.js
      └── logs/

/root/workspaces/demo/
```

工作目录固定为：

```text
/root/workspaces/demo
```

---

## 三、前置条件

系统内需要具备以下环境：

- WSL Ubuntu
- Node.js / npm
- Claude Code CLI
- OpenClaw 已可启动
- PM2 已安装

验证命令：

```bash
which claude
claude --version
node -v
npm -v
pm2 -v
```

---

## 四、Bridge 文件

路径：

```text
/root/ai-lab/bridge/claude-bridge.mjs
```

当前实际版本：

```js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "child_process";
import fs from "fs";

const WORK_DIR = process.env.CLAUDE_WORK_DIR || "/root/workspaces/demo";
const TIMEOUT  = parseInt(process.env.CLAUDE_TIMEOUT || "300000", 10);
const LOG_FILE = "/root/ai-lab/bridge/bridge.log";

function log(msg) {
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
      const child = spawn("claude", [
        "-p", prompt,
        "--output-format", "json",
        "--dangerously-skip-permissions"
      ], {
        cwd: WORK_DIR,
        timeout: TIMEOUT,
        env: { ...process.env }
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
```

---

## 五、OpenClaw MCP 配置

把以下配置写入 OpenClaw 的 MCP 配置文件：

```json
{
  "mcp": {
    "servers": {
      "claude-bridge": {
        "command": "/usr/bin/node",
        "args": [
          "/root/ai-lab/bridge/claude-bridge.mjs"
        ],
        "type": "stdio",
        "trust": "trusted",
        "env": {
          "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          "HOME": "/root",
          "USER": "root",
          "LOGNAME": "root",
          "CLAUDE_WORK_DIR": "/root/workspaces/demo",
          "CLAUDE_TIMEOUT": "300000",
          "ANTHROPIC_BASE_URL": "http://localhost:3040",
          "ANTHROPIC_AUTH_TOKEN": "sk-dummy"
        }
      }
    }
  }
}
```

说明：

- `ANTHROPIC_BASE_URL` 指向本地 Proxy
- `ANTHROPIC_AUTH_TOKEN` 使用 dummy 即可
- 真实 Key 不在这里配置

---

## 六、Proxy 文件

路径：

```text
/root/ai-lab/proxy/server.js
```

当前实际版本：

```js
const express = require("express");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");
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

app.get("/healthz", (req, res) => {
  res.json({ ok: true, upstream: UPSTREAM_BASE_URL });
});

app.use("/", createProxyMiddleware({
  target: UPSTREAM_BASE_URL,
  changeOrigin: true,
  ws: true,
  proxyTimeout: 300000,
  timeout: 300000,
  pathRewrite: (pathReq) => pathReq,
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
```

说明：

- 不要加 `express.json()`，否则会吃掉 Claude CLI 的请求体
- 当前 Proxy 会同时发送 `Authorization` 和 `x-api-key`
- 会自动补 `anthropic-version`

---

## 七、PM2 配置

路径：

```text
/root/ai-lab/proxy/ecosystem.config.js
```

当前实际版本：

```js
module.exports = {
  apps: [
    {
      name: "proxy",
      script: "./server.js",
      cwd: "/root/ai-lab/proxy",
      env: {
        PORT: "3040",
        UPSTREAM_BASE_URL: "https://lanyiapi.com",
        UPSTREAM_API_KEY: "你的真实key"
      }
    }
  ]
};
```

说明：

- 真实 Key 只保存在这里
- 如果要切模型，只需要改这里

---

## 八、首次安装步骤

### 1. 创建目录

```bash
mkdir -p /root/ai-lab/bridge
mkdir -p /root/ai-lab/proxy
mkdir -p /root/workspaces/demo
```

### 2. 安装 Bridge 依赖

```bash
cd /root/ai-lab/bridge
npm init -y
npm install @modelcontextprotocol/sdk zod
```

### 3. 安装 Proxy 依赖

```bash
cd /root/ai-lab/proxy
npm init -y
npm install express http-proxy-middleware morgan
```

### 4. 安装 PM2

```bash
npm install -g pm2
```

---

## 九、启动步骤

### 1. 启动 Proxy（由 PM2 管理）

```bash
pm2 start /root/ai-lab/proxy/ecosystem.config.js
pm2 save
pm2 startup
```

如果 `pm2 startup` 输出一条命令，复制执行即可。

### 2. 检查 Proxy 状态

```bash
pm2 list
curl http://localhost:3040/healthz
```

预期：

- `proxy` 状态为 `online`
- `healthz` 返回 `ok: true`

### 3. 启动 OpenClaw

按你当前已有方式启动 OpenClaw。

### 4. 检查 bridge 进程

```bash
ps -ef | grep -i claude-bridge
```

预期能看到：

```text
/usr/bin/node /root/ai-lab/bridge/claude-bridge.mjs
```

---

## 十、验证步骤

### A. 直接验证 Claude CLI 走 Proxy

```bash
export ANTHROPIC_BASE_URL="http://localhost:3040"
export ANTHROPIC_AUTH_TOKEN="sk-dummy"

cd /root/workspaces/demo
claude -p "在当前目录创建 direct_proxy_test.py，写一个 print('direct proxy ok')" \
  --output-format json \
  --dangerously-skip-permissions
```

检查：

```bash
cat /root/workspaces/demo/direct_proxy_test.py
```

预期：

```python
print('direct proxy ok')
```

### B. 验证 OpenClaw 通过 MCP 创建文件

在 OpenClaw 中发送：

```text
请调用 run_claude，在当前工作目录创建 proxy_test_2.py，写一个 print("proxy ok v2")
```

检查：

```bash
cat /root/workspaces/demo/proxy_test_2.py
```

预期：

```python
print("proxy ok v2")
```

### C. 查看 Proxy 请求日志

```bash
tail -n 20 /root/ai-lab/proxy/logs/access.log
```

预期出现：

```text
POST /v1/messages?beta=true ... 200
```

---

## 十一、切换模型的方法

只改一个文件：

```text
/root/ai-lab/proxy/ecosystem.config.js
```

例如切到 MiniMax：

```js
env: {
  PORT: "3040",
  UPSTREAM_BASE_URL: "https://api.minimax.chat/v1/anthropic",
  UPSTREAM_API_KEY: "你的 MiniMax key"
}
```

然后执行：

```bash
pm2 restart proxy
pm2 save
curl http://localhost:3040/healthz
```

说明：

- Claude Code 不需要改配置
- OpenClaw MCP 配置也不需要改
- 模型切换全部发生在 Proxy 层

### 切换上游模型后的完整验证流程

当你切换到新的上游（例如 MiniMax）时，推荐按下面的完整流程验证：

```bash
# 1. 先修改 Proxy 配置文件
nano /root/ai-lab/proxy/ecosystem.config.js

# 2. 让 PM2 重新加载新配置
pm2 delete proxy
pm2 start /root/ai-lab/proxy/ecosystem.config.js --update-env
pm2 save

# 3. 确认 Proxy 已切到新上游
curl http://localhost:3040/healthz
pm2 logs proxy --lines 20

# 4. 用 Claude CLI 直测 Proxy
export ANTHROPIC_BASE_URL="http://localhost:3040"
export ANTHROPIC_AUTH_TOKEN="sk-dummy"

cd /root/workspaces/demo
claude -p "创建 minimax_verify.py，写一个 print('minimax ok')" \
  --output-format json \
  --dangerously-skip-permissions

# 5. 检查文件是否真实创建
cat /root/workspaces/demo/minimax_verify.py

# 6. 检查 Proxy 日志里是否有新请求
tail -n 10 /root/ai-lab/proxy/logs/access.log
```

### 成功判断标准

你需要同时看到下面三件事：

1. `curl http://localhost:3040/healthz` 返回的新 upstream 已变成你刚配置的地址
2. `minimax_verify.py` 被真实创建
3. `access.log` 里出现新的 `POST /v1/messages?beta=true` 请求记录

### 一句话记忆版

**改配置 → 重建 PM2 进程 → 看 healthz → Claude 直测 → 看文件 → 看 access log**

## 十二、常见问题

### 1. `Not logged in · Please run /login`

原因：

- OpenClaw 拉起 bridge 时没有拿到中转环境变量

修复：

- 在 MCP `env` 里显式加入：
  - `ANTHROPIC_BASE_URL=http://localhost:3040`
  - `ANTHROPIC_AUTH_TOKEN=sk-dummy`

### 2. `MCP error -32001: Request timed out`

原因：

- Proxy 超时
- 或之前 `server.js` 错误使用了 `express.json()` 导致请求体被吃掉

修复：

- 删除 `express.json()`
- 使用当前 `server.js` 版本

### 3. `pm2 list` 中 `proxy` 为 `errored`

原因：

- `UPSTREAM_BASE_URL` 或 `UPSTREAM_API_KEY` 没配置好

修复：

- 检查 `ecosystem.config.js`
- 执行：

```bash
pm2 logs proxy --lines 50
```

### 4. `curl http://localhost:3040/healthz` 连不上

原因：

- Proxy 未启动或已退出

修复：

```bash
pm2 restart proxy
pm2 list
```

---

## 十三、备份建议

至少备份：

```text
/root/ai-lab/
/root/workspaces/   （如果要保留项目文件）
OpenClaw 的 MCP 配置文件
```

推荐备份到 Windows：

```bash
tar -czvf /mnt/c/Users/litaozhe/Desktop/ai-lab-backup.tar.gz /root/ai-lab
```

完整备份：

```bash
tar -czvf /mnt/c/Users/litaozhe/Desktop/full-backup.tar.gz /root/ai-lab /root/workspaces
```

---

## 十四、当前系统状态总结

当前已经实现：

- OpenClaw 调度 Claude Code
- Claude Code 真实创建本地文件
- Claude Code 通过 Proxy 调用上游模型
- Proxy 由 PM2 守护
- 模型可以通过修改 Proxy 配置切换

一句话概括：

**这是一个“可调度本地执行 + 可替换模型 + 统一网关控制”的 AI 执行系统。**

