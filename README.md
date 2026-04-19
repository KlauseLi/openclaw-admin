# OpenClaw Admin

这个仓库保存的是一套已经跑通的 OpenClaw 本地执行链路模板，核心目标是：

- OpenClaw 通过 MCP 调用 Claude Code
- Claude Code 在本地真实创建和修改文件
- 聊天请求通过本地 Proxy 转发到上游模型
- VLM/图片请求通过 `MINIMAX_API_HOST` 直连 MiniMax

当前方案已经统一到这条链路：

```text
普通聊天请求
OpenClaw -> MCP claude-bridge -> Claude Code CLI -> Proxy -> MiniMax

VLM/图片请求
OpenClaw -> MiniMax direct (MINIMAX_API_HOST)
```

## 先看哪里

如果你第一次接手这个项目，推荐按这个顺序看：

1. [open_claw_claude_code_proxy_可执行操作指南.md](./open_claw_claude_code_proxy_%E5%8F%AF%E6%89%A7%E8%A1%8C%E6%93%8D%E4%BD%9C%E6%8C%87%E5%8D%97.md)
2. [openclaw.example.json](./openclaw.example.json)
3. [bridge/claude-bridge.mjs](./bridge/claude-bridge.mjs)
4. [proxy/server.js](./proxy/server.js)

## 仓库里的关键文件

- `bridge/claude-bridge.mjs`
  OpenClaw MCP 工具服务，负责以 `claude` 用户身份调用本地 Claude Code CLI。

- `proxy/server.js`
  本地代理层，负责聊天请求转发、model rewrite、流式响应透传和错误日志。

- `proxy/ecosystem.config.js`
  PM2 启动配置，真实 `UPSTREAM_API_KEY` 通过环境变量注入。

- `openclaw.example.json`
  脱敏后的 OpenClaw 配置模板，用于对照 MCP、gateway、插件和 channel 结构。

- `open_claw_claude_code_proxy_可执行操作指南.md`
  当前最完整、最贴近真实部署状态的操作文档。

## 当前约定

- Bridge 运行用户：`claude`
- Claude Code 工作目录：`/home/claude/workspaces/demo`
- Proxy 运行目录：`/root/ai-lab/proxy`
- Proxy 监听地址：`http://localhost:3040`
- OpenClaw gateway 默认端口：`18789`

## 安全说明

- 真实的 `openclaw.json` 不提交到仓库
- 真实 token、API key、飞书密钥都只保留在本地环境
- 仓库里只保留脱敏模板和操作说明

## 备注

如果后续你发现“指南”和“真实代码”有偏差，以仓库里的实际代码和 `openclaw.example.json` 为准，然后再把指南补齐。
