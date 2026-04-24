---
name: claude-code
description: Run Claude Code as the `claude` user from OpenClaw. Primary path for short tasks, long tasks, and future job-style execution. Bridge is deprecated and kept only as reference.
---

# Claude Code Skill

This directory is the repository-side skeleton for the OpenClaw `claude-code` skill.

Current direction:

- Primary entrypoint: `scripts/run.sh`
- Runtime user: `claude`
- Auth source: `/home/claude/.claude/settings.json`
- Workdir default: `/home/claude/workspaces/demo`
- Long-term goal: build async job management here instead of in `bridge/`

Planned commands:

- `sync`
- `async`
- `status`
- `result`
- `cancel`
- `list`

Notes:

- `bridge/` is deprecated as a production path.
- The skill script should avoid forcing unrelated requests through proxy.
- The repository copy is used for iteration, review, and versioning before syncing into the live OpenClaw workspace.
