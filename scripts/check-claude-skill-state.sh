#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="/root/.openclaw/workspace/skills/claude-code"

if [[ ! -f "$SKILL_DIR/SKILL.md" ]]; then
    echo "SKILL.md missing" >&2
    exit 1
fi

if [[ ! -f "$SKILL_DIR/scripts/run.sh" ]]; then
    echo "scripts/run.sh missing" >&2
    exit 1
fi

if [[ ! -x "$SKILL_DIR/scripts/run.sh" ]]; then
    echo "scripts/run.sh not executable" >&2
    exit 1
fi

if ! openclaw skills info claude-code 2>&1 | grep -q "claude-code"; then
    echo "openclaw skills info claude-code missing claude-code" >&2
    exit 1
fi

bash "$SKILL_DIR/scripts/run.sh" list >/dev/null 2>&1

echo "claude-skill-state-ok"
