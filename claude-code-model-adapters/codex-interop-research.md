# Codex 与 Claude Code 互操作研究

这个文件记录 OpenAI Codex 与 Claude Code 互操作的调研入口。

当前状态：只做研究，不进入生产链路。

## 背景

“让 OpenAI Codex 适配 Claude Code”不是一个单纯的模型配置问题。

需要先区分几个不同目标：

- 在 Claude Code 中调用 Codex 做 review / rescue / background job
- 让 Claude Code 通过 Anthropic-compatible proxy 调用 OpenAI-compatible 模型
- 在 Claude Code、Codex CLI、OpenClaw 之间做任务委托和状态管理统一
- 在多个 CLI / agent 工具之间保持本地 coding session 的连续性

这些路线的工程复杂度和维护成本差异很大。

## 候选路线

### 1. Claude Code 插件调用 Codex

参考项目：

- [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc)

特点：

- 通过 Claude Code plugin 调用本机 Codex CLI
- 依赖本机 Codex 安装和登录状态
- 更像“从 Claude Code 工作流委托 Codex”，不是把 Codex 伪装成 Claude 模型
- 可能是优先级最高、风险最低的验证路线

### 2. Anthropic API 转 OpenAI-compatible proxy

参考项目：

- [vibheksoni/UniClaudeProxy](https://github.com/vibheksoni/UniClaudeProxy)
- [m0n0x41d/anthropic-proxy-rs](https://github.com/m0n0x41d/anthropic-proxy-rs)
- [fuergaosi233/claude-code-proxy](https://github.com/fuergaosi233/claude-code-proxy)
- [nenadilic84/claudex](https://github.com/nenadilic84/claudex)
- [maxnowack/anthropic-proxy](https://github.com/maxnowack/anthropic-proxy)

特点：

- 让 Claude Code 仍然以 Anthropic API 方式调用
- 本地 proxy 把请求转换为 OpenAI-compatible API
- 理论上可以接 OpenAI、OpenRouter 或其他兼容端点
- 风险在于 tool calling、streaming、错误恢复、模型映射和上下文行为都需要持续维护
- 与本项目已废弃的 `proxy/bridge` 路线有相似维护成本，不能轻易进入主线

### 3. 多工具统一适配层

参考项目：

- [beyond5959/acp-adapter](https://github.com/beyond5959/acp-adapter)
- [kittors/CliRelay](https://github.com/kittors/CliRelay)
- [Finesssee/ProxyPilot](https://github.com/Finesssee/ProxyPilot)
- [openai/codex discussion: local proxy for cross-provider session continuity](https://github.com/openai/codex/discussions/16319)

特点：

- 尝试统一 Claude Code、Codex CLI、Gemini CLI 等工具
- 更接近“跨工具任务委托 / 会话连续性 / 状态管理”的长期项目
- 复杂度最高，不适合作为下一步直接实现

## 当前建议

短期只做路线研究，不写生产代码。

优先级：

1. 先研究 `openai/codex-plugin-cc`，确认 Claude Code 中委托 Codex 的真实能力边界。
2. 再研究 Anthropic-to-OpenAI proxy 是否能稳定覆盖 Claude Code 的 agent 用法。
3. 最后再考虑跨工具统一适配层。

当前 OpenClaw 主链路仍保持不变：

```text
OpenClaw -> claude-code skill -> run.sh -> env -i + su - claude -> Claude Code CLI
```

这个研究方向不应重新引入旧的 `proxy/bridge` 生产路线，除非后续有明确验证收益。

