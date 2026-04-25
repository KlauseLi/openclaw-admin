# Stability Test Plan

## Stage Goal

Validate operational stability beyond the completed baseline without changing the production path unless a real bug is found.

## Test Matrix

| ID | Area | Goal | Risk | Status |
|----|------|------|------|--------|
| ST-00 | Baseline | Run known-good skill and smoke validators | Low | Passed |
| ST-01 | Medium async repeat | Run the fixed smoke validator through OpenClaw direct chat | Low | Planned |
| ST-02 | Concurrent async | Start 3 short async jobs and verify all reach terminal status | Medium | Planned |
| ST-03 | Cancel | Start a longer async job and cancel it cleanly | Medium | Planned |
| ST-04 | Failure handling | Trigger a controlled Claude/task failure and verify metadata | Medium | Planned |
| ST-05 | Long-running task | Run a 10-30 minute low-risk task and watch/result it | Medium | Planned |
| ST-06 | WSL interop check | Verify `/mnt/c` and `reg.exe` before/after tests | Low | Planned |
| ST-07 | Real repo edit | Let OpenClaw modify a small repo file and verify with tests | Medium | Planned |

## Rules

- Prefer `async -> watch/status -> result --raw` for anything non-trivial.
- Never treat `status=succeeded` alone as semantic success.
- Always verify produced files, owner, permissions, and executable output where applicable.
- Keep generated test artifacts inside `/home/claude/workspaces/openclaw-agent-smoke` unless the test explicitly targets this repository.
- Record every job id in `stability/results/`.
- If a test exposes a bug, add a follow-up item before editing `run.sh` or `SKILL.md`.
