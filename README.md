# OpenClaw Admin

这个仓库保存的是一套 OpenClaw 本地执行链路模板，当前主线已经切到 `skill script + claude 用户直调`。旧的 `proxy`、`MCP -> bridge -> Claude Code`、PM2 守护方案已经废弃，不再作为生产入口或维护方向。

- OpenClaw 是完整产品名，不拆写；官网：[openclaw.ai](https://openclaw.ai)
- OpenClaw 通过 skill script / exec 调用 Claude Code
- Claude Code 在本地真实创建和修改文件
- `claude-code` 配置完全独立于 OpenClaw JSON 配置体系
- Claude Code 切换第三方模型的关键配置是 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN` 和可选 `ANTHROPIC_MODEL`
- `proxy/`、`bridge/`、PM2 配置只保留为历史参考

当前方案已经统一到这条链路：

```text
OpenClaw -> skill script / exec -> su - claude -> Claude Code CLI
```

## 当前接续点

截至 2026-04-25，主线状态如下：

- 当前阶段已收尾：OpenClaw -> `claude-code` skill -> `run.sh async` -> Claude Code CLI 的本地执行链路已打通，并通过 smoke、中等复杂度、真实仓库小功能三层验证。
- GitHub `main` 已包含文档主线切换和 `run.sh` async 管理层加固。
- live workspace 的 `claude-code` skill 已同步到 `/root/.openclaw/workspace/skills/claude-code/`。
- 旧备份目录已移出 active skills 扫描范围：
  `/root/.openclaw/workspace/skill-backups/claude-code.bak-2026-04-24`
- `openclaw skills info claude-code` 当前应指向：
  `~/.openclaw/workspace/skills/claude-code/SKILL.md`
- 新 session 中显式提到 `claude-code skill` 后，OpenClaw 能注入该 skill，并能通过 `exec` 调用 `run.sh sync/async`。
- OpenClaw 直接对话已实测走通 `run.sh async -> su - claude -> claude --print`：job `20260425114306_151102_2572` 成功创建 `claude:claude` 属主文件。
- smoke workspace 已升级为真实开发任务验收点：`/home/claude/workspaces/openclaw-agent-smoke`，job `20260425115333_151881_5a87` 成功创建可执行 `scripts/healthcheck.sh`。
- 中等复杂度压力测试已通过：job `20260425121010_153516_00c5` 创建 `app/config.json`、`src/report.md`、`scripts/medium_check.sh` 并修改 `README.md`，`medium_check.sh` 以 `claude` 用户执行输出 `medium-smoke-ok`。
- smoke workspace 固定回归脚本已通过：job `20260425122112_154322_7f04` 创建 `scripts/validate_smoke.sh`，以 `claude` 用户执行输出 `validate-smoke-ok`。
- 真实仓库小功能修改已通过：job `20260425123748_159236_3ac5` 在本仓库新增 `scripts/check-claude-skill-state.sh`，脚本执行输出 `claude-skill-state-ok`。
- `run.sh async` 已加固：worker 使用 `setsid nohup` 启动，`status/result/list/cancel` 会把 dead PID 的陈旧 `running` 自动收尾为 `failed`。
- 曾遇到 WSL drvfs/interop 故障：`claude --print` 触发 Bun 调用 `/mnt/c/Windows/System32/reg.exe`，而 `/mnt/c` 返回 `Input/output error`。已通过在 WSL 内重新挂载 `/mnt/c` 修复。

下次如果复发，先重新挂载 `/mnt/c`，再重跑端到端 async 验证。

## 先看哪里

如果你第一次接手这个项目，推荐按这个顺序看：

1. [NEXT.md](./NEXT.md)
2. [openclaw_claude_code_skill_可执行操作指南.md](./openclaw_claude_code_skill_%E5%8F%AF%E6%89%A7%E8%A1%8C%E6%93%8D%E4%BD%9C%E6%8C%87%E5%8D%97.md)
3. [skills/claude-code/SKILL.md](./skills/claude-code/SKILL.md)
4. [skills/claude-code/scripts/run.sh](./skills/claude-code/scripts/run.sh)
5. [claude-code-model-adapters/README.md](./claude-code-model-adapters/README.md)

## 仓库里的关键文件

- `skills/claude-code/scripts/run.sh`
  当前主入口。已经支持 `sync`、`async`、`status`、`result`、`watch`、`cancel`、`list`、`cleanup` 这套任务流。
  `async` worker 已脱离调用进程组，陈旧 `running` 会在查询时自动收尾。

- `skills/claude-code/SKILL.md`
  说明这个技能包的定位、运行方式和后续演进方向。

- `scripts/check-claude-skill-state.sh`
  只读检查 live workspace 里的 `claude-code` skill 状态，成功时输出 `claude-skill-state-ok`。

- `claude-code-model-adapters/claude-cli-setup.sh`
  Linux / WSL shell 下的 Claude Code 第三方模型切换辅助脚本，用于交互式写入 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_AUTH_TOKEN`。

- `claude-code-model-adapters/claude-cli-setup.ps1`
  Windows PowerShell 下的 Claude Code 第三方模型切换辅助脚本，用于交互式写入用户级 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_AUTH_TOKEN`。

- `claude-code-model-adapters/`
  独立子项目，记录各类第三方 Claude-compatible 模型适配 Claude Code 的方法；不属于 OpenClaw 执行主链路。

- `proxy/server.js`
  废弃历史参考。旧代理路线维护成本高，已被当前 `claude-code` skill + `run.sh` 方式替代。

- `proxy/ecosystem.config.js`
  废弃历史参考。PM2 守护 proxy 的方案不再作为当前项目运维目标。

- `bridge/`
  废弃历史参考。`OpenClaw MCP -> bridge -> Claude Code` 方案已经放弃，不再作为主执行入口。

- `openclaw_claude_code_skill_可执行操作指南.md`
  当前最完整、最贴近真实部署状态的操作文档。

## 当前约定

- Claude Code 运行用户：`claude`
- Claude Code 默认工作目录：优先使用 `CLAUDE_WORK_DIR`，否则自动回退到可用目录
- Claude 配置目录：`/home/claude/.claude`
- Claude Code 认证来源：`/home/claude/.claude/settings.json`
- 第三方 Claude-compatible 模型切换：参考 `claude-code-model-adapters/claude-cli-setup.sh` 和 `claude-code-model-adapters/claude-cli-setup.ps1` 获取 / 写入 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`；当前 OpenClaw 链路最终以 `/home/claude/.claude/settings.json` 中的值为准
- `run.sh` 通过 `env -i + su - claude` 隔离执行环境，与 OpenClaw JSON 配置零耦合
- OpenClaw gateway 默认端口：`18789`
- 主入口优先使用 `skills/claude-code/scripts/run.sh`
- `proxy/`、`bridge/`、PM2、`claude-bridge` MCP 不再作为生产路径继续扩展
- OpenClaw 聊天里如需刷新旧 session 的 skill 注入状态，先发 `/new`，或用新的 `--session-id`
- 如 `/mnt/c` 出现 `d?????????` 或 `reg.exe` EIO，先在 WSL 内 remount `/mnt/c`

## 安全说明

- 真实的 `/root/.openclaw/openclaw.json` 不提交到仓库
- 真实 token、API key、channel 密钥和用户 allowlist 都只保留在本地环境
- 当前 Claude Code 执行链路不依赖仓库中的 OpenClaw JSON 示例，因此不再保留 `openclaw.example.json`
- `proxy/`、`bridge/`、PM2 内容只作为历史参考，不作为安全边界或当前运维目标

## 备注

如果后续你发现“指南”和真实运行状态有偏差，以 live workspace 的 `claude-code` skill、`run.sh`、`scripts/check-claude-skill-state.sh` 复核结果为准，然后再把指南补齐。
