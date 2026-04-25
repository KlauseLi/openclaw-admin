---
name: claude-code
description: Delegate coding tasks to Claude Code CLI. Use when building features, reviewing PRs, refactoring larger codebases, or doing iterative coding that needs file exploration. Not for simple one-line edits or read-only code lookup. Claude Code requires a git repository; use a workdir pointing to a git-tracked project folder. Requires `/home/claude/.claude/settings.json` and `/home/claude/.claude.json` to be configured. Runs as the `claude` user via `su - claude`.
---

# Claude Code Skill

This directory is the repository-side skeleton for the OpenClaw `claude-code` skill.

Current production path:

- Primary entrypoint: `scripts/run.sh`
- Runtime user: `claude`
- Auth source: `/home/claude/.claude/settings.json`
- Workdir default: `/home/claude/workspaces/demo`
- Async job state: `/root/.openclaw/workspace/memory/claude-jobs`
- Pending job log: `/root/.openclaw/workspace/memory/pending_jobs.md`

## Prerequisites

The `claude` user must have Claude Code auth and onboarding state configured:

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-api-key",
    "ANTHROPIC_BASE_URL": "https://api.minimaxi.com/anthropic",
    "ANTHROPIC_MODEL": "MiniMax-M2.7"
  }
}
```

`/home/claude/.claude.json` must include:

```json
{
  "hasCompletedOnboarding": true
}
```

## Commands

- `sync`
- `async`
- `status`
- `result`
- `cancel`
- `list`

Usage:

```bash
bash scripts/run.sh sync "task description" -w /path/to/git/repo
bash scripts/run.sh async "task description" -w /path/to/git/repo
bash scripts/run.sh status <job_id>
bash scripts/run.sh result <job_id>
bash scripts/run.sh cancel <job_id>
bash scripts/run.sh list
```

Notes:

- `bridge/` is deprecated as a production path.
- The skill script should avoid forcing unrelated requests through proxy.
- The repository copy is used for iteration, review, and versioning before syncing into the live OpenClaw workspace.
- Exit code `2` means usage error; non-zero Claude Code failures are surfaced through stderr and job metadata.
- `async` starts its worker with `setsid nohup`; status readers reconcile dead worker PIDs so stale `running` jobs become terminal `failed` jobs instead of hanging forever.
- Current known host blocker: in this WSL environment, `claude --print` can fail before doing useful work because Bun tries to spawn `/mnt/c/Windows/System32/reg.exe`, and WSL returns `Input/output error` for that Windows executable. Fix WSL interop / Claude CLI before treating command failures as skill logic failures.
