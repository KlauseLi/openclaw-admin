# Stability and Pressure Testing

This directory tracks the next stage after the Claude skill workflow reached its current completion boundary.

The completed baseline is:

```text
OpenClaw -> claude-code skill -> run.sh async -> Claude Code CLI
```

This stage should not reopen the completed baseline unless a stability test exposes a concrete bug. Keep test plans, job ids, observations, and follow-up fixes separate from the main README completion summary.

## Scope

- Long-running async job stability
- Multiple async jobs running near the same time
- Cancel and failure recovery behavior
- WSL drvfs/interop recovery checks
- Real repository edit-and-verify workflows

## Baseline Checks

Before running pressure tests, verify the current known-good path:

```bash
bash scripts/check-claude-skill-state.sh
su - claude -c 'cd /home/claude/workspaces/openclaw-agent-smoke && ./scripts/validate_smoke.sh'
```

Expected outputs:

```text
claude-skill-state-ok
validate-smoke-ok
```

## Recording Rule

Each pressure test should record:

- Date and local time
- Test goal
- Exact OpenClaw prompt or shell command
- Job id or process id
- Status/result output
- Files or side effects checked
- Pass/fail conclusion
- Any follow-up issue or fix
