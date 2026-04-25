# Next Session Handoff

## Current State

As of 2026-04-25, the completed baseline is closed and documented:

```text
OpenClaw -> claude-code skill -> run.sh async -> Claude Code CLI
```

The baseline passed three levels of validation:

- Smoke tasks in `/home/claude/workspaces/openclaw-agent-smoke`
- Medium multi-file async task
- Low-risk real repository script creation

The current phase is now `stability-pressure-testing`, tracked under `stability/`.

## Last Known Git State

- Branch: `main`
- Remote: `origin/main`
- Stability-stage starting commit: `3f2f86b docs: start stability testing stage`
- Working tree was clean when this handoff was written.

## Important Files

- `README.md`
- `openclaw_claude_code_skill_可执行操作指南.md`
- `claude-code-model-adapters/README.md`
- `skills/claude-code/SKILL.md`
- `skills/claude-code/scripts/run.sh`
- `scripts/check-claude-skill-state.sh`
- `claude-code-model-adapters/claude-cli-setup.sh`
- `claude-code-model-adapters/claude-cli-setup.ps1`
- `stability/README.md`
- `stability/test-plan.md`
- `stability/results/2026-04-25.md`

## Model Backend Note

Claude Code switches to a third-party Claude-compatible backend through:

- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_AUTH_TOKEN`
- optional `ANTHROPIC_MODEL`

The helper scripts in `claude-code-model-adapters/claude-cli-setup.sh` and `claude-code-model-adapters/claude-cli-setup.ps1` are useful for collecting and writing those values for a normal shell user. This adapter folder is a subproject for third-party model setup, not the OpenClaw execution path. In the OpenClaw production path, `run.sh` uses `env -i + su - claude`, so the effective runtime source remains `/home/claude/.claude/settings.json` for the `claude` user.

## Baseline Recheck

Before continuing pressure tests, run:

```bash
bash scripts/check-claude-skill-state.sh
su - claude -c 'cd /home/claude/workspaces/openclaw-agent-smoke && ./scripts/validate_smoke.sh'
```

Expected:

```text
claude-skill-state-ok
validate-smoke-ok
```

## Next Step

Continue with `ST-01` from `stability/test-plan.md`:

```text
Run the fixed smoke validator through OpenClaw direct chat.
```

Suggested OpenClaw prompt:

```text
请使用 claude-code skill 的 async/watch/result --raw 路径，在 /home/claude/workspaces/openclaw-agent-smoke 中执行 ./scripts/validate_smoke.sh。请返回 job_id，用 watch 等待完成，再用 result --raw 汇报最终结果。不要直接执行脚本。
```

After OpenClaw returns, verify:

```bash
bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh status <job_id>
bash /root/.openclaw/workspace/skills/claude-code/scripts/run.sh result --raw <job_id>
```

Record the result in:

```text
stability/results/2026-04-25.md
```

Then update `stability/test-plan.md` from `Planned` to `Passed` or `Failed` for ST-01.

## Boundary

Do not reopen the completed baseline unless a stability test exposes a concrete bug. If a bug appears, record the failing job id, exact result, and suspected cause before changing `run.sh` or `SKILL.md`.
