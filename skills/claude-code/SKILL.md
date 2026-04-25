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

`ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` are the switch point for a third-party Claude-compatible model backend. `ANTHROPIC_MODEL` is optional when the upstream needs an explicit model name. Helper scripts such as `claude-cli-setup.sh` / `claude-cli-setup.ps1` can prepare these values for a normal shell user, but this skill runs under `env -i + su - claude`, so the production runtime source must be the `claude` user's config under `/home/claude/.claude/`.

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
- `watch`
- `cancel`
- `list`
- `cleanup`

Usage:

```bash
bash scripts/run.sh sync "task description" -w /path/to/git/repo
bash scripts/run.sh async "task description" -w /path/to/git/repo
bash scripts/run.sh status <job_id>
bash scripts/run.sh result <job_id>
bash scripts/run.sh result --raw <job_id>
bash scripts/run.sh watch <job_id> --interval 5 --timeout 600
bash scripts/run.sh cancel <job_id>
bash scripts/run.sh list
bash scripts/run.sh cleanup --days 14 --dry-run
```

Notes:

- `bridge/` is deprecated as a production path.
- The skill script should avoid forcing unrelated requests through proxy.
- The repository copy is used for iteration, review, and versioning before syncing into the live OpenClaw workspace.
- Exit code `2` means usage error; non-zero Claude Code failures are surfaced through stderr and job metadata.
- `async` starts its worker with `setsid nohup`; status readers reconcile dead worker PIDs so stale `running` jobs become terminal `failed` jobs instead of hanging forever.
- To verify a direct OpenClaw chat actually reached Claude Code, check the job under `/root/.openclaw/workspace/memory/claude-jobs`, then confirm `run.sh status/result --raw` and that the produced file is owned by `claude:claude`.
- Known host issue: if WSL drvfs/interop breaks, `claude --print` can fail before doing useful work because Bun tries to spawn `/mnt/c/Windows/System32/reg.exe` and WSL returns `Input/output error`. Remount `/mnt/c` before treating this as a skill logic failure.
