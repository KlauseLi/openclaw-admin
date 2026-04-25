# Claude Code Model Adapters

这个子项目记录各类第三方 Claude-compatible 模型接入 Claude Code 的方法。

它不属于 OpenClaw 执行主链路。当前 OpenClaw 主链路仍然是：

```text
OpenClaw -> claude-code skill -> run.sh -> env -i + su - claude -> Claude Code CLI
```

这里关注的是 Claude Code 自身如何切换模型后端。

## 当前配置点

Claude Code 切换第三方模型的关键参数是：

```text
ANTHROPIC_BASE_URL
ANTHROPIC_AUTH_TOKEN
ANTHROPIC_MODEL
```

- `ANTHROPIC_BASE_URL` 指向第三方 Claude-compatible API 入口。
- `ANTHROPIC_AUTH_TOKEN` 是第三方服务的访问 token。
- `ANTHROPIC_MODEL` 在上游需要显式模型名时使用。

## 脚本

- `claude-cli-setup.sh`
  Linux / WSL / macOS shell 下的交互式配置脚本，写入 `~/.bashrc` 和 `~/.zshrc`。

- `claude-cli-setup.ps1`
  Windows PowerShell 下的交互式配置脚本，写入用户级环境变量。

这些脚本适合用来为普通 shell 用户准备 Claude Code 的第三方模型环境变量。

## 与 OpenClaw 链路的边界

OpenClaw 当前生产路径中的 `skills/claude-code/scripts/run.sh` 会使用：

```text
env -i + su - claude
```

这意味着普通用户 shell、PowerShell 用户环境变量、root shell 环境变量不会自动传入最终执行环境。

如果要让 OpenClaw 调用 Claude Code 时使用第三方模型，最终有效配置仍应落在 `claude` 用户配置里：

```text
/home/claude/.claude/settings.json
/home/claude/.claude.json
```

