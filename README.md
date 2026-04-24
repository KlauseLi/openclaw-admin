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

## 先看哪里

如果你第一次接手这个项目，推荐按这个顺序看：

1. [open_claw_claude_code_proxy_可执行操作指南.md](./open_claw_claude_code_proxy_%E5%8F%AF%E6%89%A7%E8%A1%8C%E6%93%8D%E4%BD%9C%E6%8C%87%E5%8D%97.md)
2. [openclaw.example.json](./openclaw.example.json)
3. [skills/claude-code/SKILL.md](./skills/claude-code/SKILL.md)
4. [skills/claude-code/scripts/run.sh](./skills/claude-code/scripts/run.sh)
5. [proxy/server.js](./proxy/server.js)

## 仓库里的关键文件

- `skills/claude-code/scripts/run.sh`
  当前主入口骨架。后续的同步、异步、状态查询、结果读取、取消任务，都会优先在这里演进。

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
- Claude Code 工作目录：`/home/claude/workspaces/demo`
- Claude 配置目录：`/home/claude/.claude`
- Proxy 运行目录：`/root/ai-lab/proxy`
- Proxy 监听地址：`http://localhost:3040`
- OpenClaw gateway 默认端口：`18789`
- 主入口优先使用 `skills/claude-code/scripts/run.sh`
- `bridge/` 不再作为生产路径继续扩展

## 安全说明

- 真实的 `openclaw.json` 不提交到仓库
- 真实 token、API key、飞书密钥都只保留在本地环境
- 仓库里只保留脱敏模板和操作说明

## 备注

如果后续你发现“指南”和“真实代码”有偏差，以仓库里的实际代码和 `openclaw.example.json` 为准，然后再把指南补齐。
