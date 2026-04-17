# OpenClaw Admin

这个仓库现在承载的是一套可落地的 OpenClaw 执行链路模板：

- `OpenClaw`
- `MCP bridge`
- `Claude Code CLI`
- `Local proxy`
- `Upstream model provider`

目标不是只保留运维文档，而是把文档里的方案整理成一个能直接改、直接部署、直接扩展的项目骨架。

## 仓库结构

```text
.
├── bridge/
│   ├── claude-bridge.mjs
│   └── package.json
├── proxy/
│   ├── ecosystem.config.js
│   ├── package.json
│   └── server.js
├── .gitignore
└── open_claw_claude_code_proxy_可执行操作指南.md
```

## 模块说明

### `bridge/`

MCP 工具服务，负责把 OpenClaw 的工具调用转发给本地 `claude` CLI。

默认行为：

- 在指定工作目录中执行 Claude Code
- 输出 JSON 结果
- 记录 bridge 调用日志
- 超时后返回错误结果

关键环境变量：

- `CLAUDE_WORK_DIR`
- `CLAUDE_TIMEOUT`
- `BRIDGE_LOG_FILE`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_AUTH_TOKEN`

### `proxy/`

本地代理层，负责：

- 持有真实上游 API Key
- 转发 Claude CLI 请求到兼容上游
- 输出访问日志
- 暴露健康检查接口

关键环境变量：

- `PORT`
- `UPSTREAM_BASE_URL`
- `UPSTREAM_API_KEY`
- `PROXY_LOG_DIR`

## 快速开始

### 1. 安装 bridge 依赖

```bash
cd bridge
npm install
```

### 2. 安装 proxy 依赖

```bash
cd proxy
npm install
```

### 3. 配置 OpenClaw MCP

把 `bridge/claude-bridge.mjs` 注册为 MCP stdio 服务，并确保传入：

```json
{
  "CLAUDE_WORK_DIR": "/root/workspaces/demo",
  "CLAUDE_TIMEOUT": "300000",
  "ANTHROPIC_BASE_URL": "http://localhost:3040",
  "ANTHROPIC_AUTH_TOKEN": "sk-dummy"
}
```

### 4. 启动 proxy

```bash
cd proxy
pm2 start ecosystem.config.js
pm2 save
```

### 5. 验证健康状态

```bash
curl http://localhost:3040/healthz
```

## 运行约定

- `bridge` 不保存真实上游 Key
- 真实 Key 只应保存在 `proxy` 运行环境中
- `proxy/server.js` 不使用 `express.json()`，避免请求体被提前消费
- `bridge` 默认要求本机已安装 `claude` CLI

## 文档

完整实施说明见：

- [open_claw_claude_code_proxy_可执行操作指南.md](./open_claw_claude_code_proxy_%E5%8F%AF%E6%89%A7%E8%A1%8C%E6%93%8D%E4%BD%9C%E6%8C%87%E5%8D%97.md)

如果你只是排查 WSL 网关运行状态，后续可以再单独补一份 `docs/ops-wsl.md`，把运维说明和项目源码说明拆开。
