# OpenClaw Admin

这个仓库保存的是一套 OpenClaw 本地执行链路模板，当前主线已经切到 `skill script + claude 用户直调`，不再把 `bridge` 作为生产入口。

- OpenClaw 通过 skill script / exec 调用 Claude Code
- Claude Code 在本地真实创建和修改文件
- 只有需要代理的聊天请求才通过本地 Proxy
- 不需要代理的请求不再被 bridge 误卷入

当前方案已经统一到这条链路：

```text
Claude Code 执行请求
OpenClaw -> skill script / exec -> su - claude -> Claude Code CLI

VLM/图片请求
OpenClaw -> MiniMax direct (MINIMAX_API_HOST)
```

## 当前接续点

截至 2026-04-25，主线状态如下：

- GitHub `main` 已包含文档主线切换和 `run.sh` async 管理层加固。
- live workspace 的 `claude-code` skill 已同步到 `/root/.openclaw/workspace/skills/claude-code/`。
- 旧备份目录已移出 active skills 扫描范围：
  `/root/.openclaw/workspace/skill-backups/claude-code.bak-2026-04-24`
- `openclaw skills info claude-code` 当前应指向：
  `~/.openclaw/workspace/skills/claude-code/SKILL.md`
- 新 session 中显式提到 `claude-code skill` 后，OpenClaw agent 能注入该 skill，并能通过 `exec` 调用 `run.sh sync/async`。
- `run.sh async` 已加固：worker 使用 `setsid nohup` 启动，`status/result/list/cancel` 会把 dead PID 的陈旧 `running` 自动收尾为 `failed`。
- 当前阻塞不在 OpenClaw skill 或 async job 管理层，而在 Claude Code CLI：`claude --print` 会触发 Bun 调用 `/mnt/c/Windows/System32/reg.exe`，而当前 WSL 访问该文件返回 `Input/output error`。

下次继续时优先处理 WSL/Claude CLI 的 `reg.exe EIO`，再重跑端到端 async 验证。

## 先看哪里

如果你第一次接手这个项目，推荐按这个顺序看：

1. [open_claw_claude_code_proxy_可执行操作指南.md](./open_claw_claude_code_proxy_%E5%8F%AF%E6%89%A7%E8%A1%8C%E6%93%8D%E4%BD%9C%E6%8C%87%E5%8D%97.md)
2. [openclaw.example.json](./openclaw.example.json)
3. [skills/claude-code/SKILL.md](./skills/claude-code/SKILL.md)
4. [skills/claude-code/scripts/run.sh](./skills/claude-code/scripts/run.sh)
5. [proxy/server.js](./proxy/server.js)

## 仓库里的关键文件

- `skills/claude-code/scripts/run.sh`
  当前主入口。已经支持 `sync`、`async`、`status`、`result`、`cancel`、`list` 这套任务流。
  `async` worker 已脱离调用进程组，陈旧 `running` 会在查询时自动收尾。

- `skills/claude-code/SKILL.md`
  说明这个技能包的定位、运行方式和后续演进方向。

- `proxy/server.js`
  本地代理层，负责需要代理的聊天请求转发、model rewrite、流式响应透传和错误日志。

- `proxy/ecosystem.config.js`
  PM2 启动配置，真实 `UPSTREAM_API_KEY` 通过环境变量注入。

- `bridge/`
  废弃参考实现。保留仅用于对照旧的 async job 思路，不再作为主执行入口。

- `openclaw.example.json`
  脱敏后的 OpenClaw 配置模板，用于对照 MCP、gateway、插件和 channel 结构。

- `open_claw_claude_code_proxy_可执行操作指南.md`
  当前最完整、最贴近真实部署状态的操作文档。

## 当前约定

- Claude Code 运行用户：`claude`
- Claude Code 默认工作目录：优先使用 `CLAUDE_WORK_DIR`，否则自动回退到可用目录
- Claude 配置目录：`/home/claude/.claude`
- Proxy 运行目录：`/root/ai-lab/proxy`
- Proxy 监听地址：`http://localhost:3040`
- OpenClaw gateway 默认端口：`18789`
- 主入口优先使用 `skills/claude-code/scripts/run.sh`
- `bridge/` 不再作为生产路径继续扩展
- OpenClaw 聊天里如需刷新旧 session 的 skill 注入状态，先发 `/new`，或用新的 `--session-id`

## 安全说明

- 真实的 `openclaw.json` 不提交到仓库
- 真实 token、API key、飞书密钥都只保留在本地环境
- 仓库里只保留脱敏模板和操作说明

## 备注

如果后续你发现“指南”和“真实代码”有偏差，以仓库里的实际代码和 `openclaw.example.json` 为准，然后再把指南补齐。
