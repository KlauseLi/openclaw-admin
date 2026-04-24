#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_WORKDIR="/home/claude/workspaces/demo"
JOBS_DIR="${CLAUDE_JOBS_DIR:-/root/.openclaw/workspace/memory/claude-jobs}"
PENDING_JOBS_FILE="${PENDING_JOBS_FILE:-/root/.openclaw/workspace/memory/pending_jobs.md}"
RESULT_PREVIEW_CHARS="${RESULT_PREVIEW_CHARS:-4000}"

usage() {
  cat >&2 <<'EOF'
Usage:
  run.sh sync "<task>" [-w workdir]
  run.sh async "<task>" [-w workdir]
  run.sh status <job_id>
  run.sh result <job_id>
  run.sh cancel <job_id>
  run.sh list

Notes:
  - `sync` runs Claude Code and waits for the final result.
  - `async` starts a background worker and prints the job_id.
  - Async job metadata is stored under /root/.openclaw/workspace/memory/claude-jobs by default.
EOF
  exit 2
}

timestamp_utc() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

ensure_jobs_dir() {
  mkdir -p "$JOBS_DIR"
  mkdir -p "$(dirname "$PENDING_JOBS_FILE")"
}

job_meta_path() {
  echo "$JOBS_DIR/$1.meta"
}

job_stdout_path() {
  echo "$JOBS_DIR/$1.stdout.log"
}

job_stderr_path() {
  echo "$JOBS_DIR/$1.stderr.log"
}

job_exit_path() {
  echo "$JOBS_DIR/$1.exit"
}

generate_job_id() {
  printf "%s_%s_%s\n" "$(date -u +%Y%m%d%H%M%S)" "$$" "$(od -An -N2 -tx1 /dev/urandom | tr -d ' \n')"
}

shell_escape() {
  printf "%q" "$1"
}

append_pending_log() {
  local message="$1"
  printf "[%s] %s\n" "$(timestamp_utc)" "$message" >> "$PENDING_JOBS_FILE"
}

load_meta() {
  local job_id="$1"
  local meta_file
  meta_file="$(job_meta_path "$job_id")"
  [[ -f "$meta_file" ]] || return 1

  unset JOB_ID STATUS CREATED_AT STARTED_AT FINISHED_AT WORKDIR PID EXIT_CODE SIGNAL CANCELLED_AT PROMPT
  # shellcheck disable=SC1090
  source "$meta_file"
}

write_meta() {
  local meta_file tmp_file
  meta_file="$(job_meta_path "$JOB_ID")"
  tmp_file="${meta_file}.tmp"

  cat > "$tmp_file" <<EOF
JOB_ID=$(shell_escape "${JOB_ID:-}")
STATUS=$(shell_escape "${STATUS:-}")
CREATED_AT=$(shell_escape "${CREATED_AT:-}")
STARTED_AT=$(shell_escape "${STARTED_AT:-}")
FINISHED_AT=$(shell_escape "${FINISHED_AT:-}")
WORKDIR=$(shell_escape "${WORKDIR:-}")
PID=$(shell_escape "${PID:-}")
EXIT_CODE=$(shell_escape "${EXIT_CODE:-}")
SIGNAL=$(shell_escape "${SIGNAL:-}")
CANCELLED_AT=$(shell_escape "${CANCELLED_AT:-}")
PROMPT=$(shell_escape "${PROMPT:-}")
EOF

  mv "$tmp_file" "$meta_file"
}

preview_file() {
  local file_path="$1"
  local max_chars="${2:-$RESULT_PREVIEW_CHARS}"

  if [[ ! -f "$file_path" ]]; then
    return
  fi

  python3 - "$file_path" "$max_chars" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
max_chars = int(sys.argv[2])
text = path.read_text(encoding="utf-8", errors="replace")
if len(text) > max_chars:
    text = text[:max_chars] + "..."
sys.stdout.write(text)
PY
}

emit_job_json() {
  local detail_level="${1:-status}"
  local stdout_path stderr_path stdout_preview stderr_preview stdout_full stderr_full

  stdout_path="$(job_stdout_path "$JOB_ID")"
  stderr_path="$(job_stderr_path "$JOB_ID")"
  stdout_preview="$(preview_file "$stdout_path")"
  stderr_preview="$(preview_file "$stderr_path")"
  stdout_full=""
  stderr_full=""

  if [[ "$detail_level" == "result" ]]; then
    if [[ -f "$stdout_path" ]]; then
      stdout_full="$(cat "$stdout_path")"
    fi
    if [[ -f "$stderr_path" ]]; then
      stderr_full="$(cat "$stderr_path")"
    fi
  fi

  export JOB_ID STATUS CREATED_AT STARTED_AT FINISHED_AT WORKDIR PID EXIT_CODE SIGNAL CANCELLED_AT PROMPT
  export STDOUT_PATH="$stdout_path" STDERR_PATH="$stderr_path"
  export STDOUT_PREVIEW="$stdout_preview" STDERR_PREVIEW="$stderr_preview"
  export STDOUT_FULL="$stdout_full" STDERR_FULL="$stderr_full"
  export DETAIL_LEVEL="$detail_level"

  python3 - <<'PY'
import json
import os

payload = {
    "job_id": os.environ.get("JOB_ID", ""),
    "status": os.environ.get("STATUS", ""),
    "created_at": os.environ.get("CREATED_AT", "") or None,
    "started_at": os.environ.get("STARTED_AT", "") or None,
    "finished_at": os.environ.get("FINISHED_AT", "") or None,
    "work_dir": os.environ.get("WORKDIR", "") or None,
    "pid": int(os.environ["PID"]) if os.environ.get("PID", "").isdigit() else None,
    "exit_code": int(os.environ["EXIT_CODE"]) if os.environ.get("EXIT_CODE", "").lstrip("-").isdigit() else None,
    "signal": os.environ.get("SIGNAL", "") or None,
    "cancelled_at": os.environ.get("CANCELLED_AT", "") or None,
    "prompt": os.environ.get("PROMPT", ""),
    "stdout_path": os.environ.get("STDOUT_PATH", ""),
    "stderr_path": os.environ.get("STDERR_PATH", ""),
    "stdout_preview": os.environ.get("STDOUT_PREVIEW", ""),
    "stderr_preview": os.environ.get("STDERR_PREVIEW", ""),
}

if os.environ.get("DETAIL_LEVEL") == "result":
    payload["stdout"] = os.environ.get("STDOUT_FULL", "")
    payload["stderr"] = os.environ.get("STDERR_FULL", "")

print(json.dumps(payload, ensure_ascii=False, indent=2))
PY
}

emit_list_json() {
  local first=1
  local meta_file

  printf "[\n"
  shopt -s nullglob
  for meta_file in "$JOBS_DIR"/*.meta; do
    JOB_ID=""
    STATUS=""
    CREATED_AT=""
    STARTED_AT=""
    FINISHED_AT=""
    WORKDIR=""
    PID=""
    EXIT_CODE=""
    SIGNAL=""
    CANCELLED_AT=""
    PROMPT=""
    # shellcheck disable=SC1090
    source "$meta_file"

    local stdout_path stderr_path stdout_preview stderr_preview
    stdout_path="$(job_stdout_path "$JOB_ID")"
    stderr_path="$(job_stderr_path "$JOB_ID")"
    stdout_preview="$(preview_file "$stdout_path")"
    stderr_preview="$(preview_file "$stderr_path")"

    export JOB_ID STATUS CREATED_AT STARTED_AT FINISHED_AT WORKDIR PID EXIT_CODE SIGNAL CANCELLED_AT PROMPT
    export STDOUT_PATH="$stdout_path" STDERR_PATH="$stderr_path"
    export STDOUT_PREVIEW="$stdout_preview" STDERR_PREVIEW="$stderr_preview"

    if [[ "$first" -eq 0 ]]; then
      printf ",\n"
    fi

    python3 - <<'PY'
import json
import os

payload = {
    "job_id": os.environ.get("JOB_ID", ""),
    "status": os.environ.get("STATUS", ""),
    "created_at": os.environ.get("CREATED_AT", "") or None,
    "started_at": os.environ.get("STARTED_AT", "") or None,
    "finished_at": os.environ.get("FINISHED_AT", "") or None,
    "work_dir": os.environ.get("WORKDIR", "") or None,
    "pid": int(os.environ["PID"]) if os.environ.get("PID", "").isdigit() else None,
    "exit_code": int(os.environ["EXIT_CODE"]) if os.environ.get("EXIT_CODE", "").lstrip("-").isdigit() else None,
    "signal": os.environ.get("SIGNAL", "") or None,
    "cancelled_at": os.environ.get("CANCELLED_AT", "") or None,
    "stdout_path": os.environ.get("STDOUT_PATH", ""),
    "stderr_path": os.environ.get("STDERR_PATH", ""),
    "stdout_preview": os.environ.get("STDOUT_PREVIEW", ""),
    "stderr_preview": os.environ.get("STDERR_PREVIEW", ""),
}

print(json.dumps(payload, ensure_ascii=False, indent=2), end="")
PY

    first=0
  done
  shopt -u nullglob
  printf "\n]\n"
}

run_as_claude() {
  local workdir="$1"
  local prompt="$2"
  local escaped_workdir escaped_prompt safe_path

  escaped_workdir="$(shell_escape "$workdir")"
  escaped_prompt="$(shell_escape "$prompt")"
  safe_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  su - claude -c "env -i HOME=/home/claude USER=claude LOGNAME=claude SHELL=/bin/bash TERM=xterm-256color PATH=$safe_path bash -lc 'cd $escaped_workdir && claude --print --permission-mode bypassPermissions $escaped_prompt'"
}

cmd_sync() {
  local prompt="$1"
  local workdir="${2:-$DEFAULT_WORKDIR}"
  [[ -n "$prompt" ]] || usage
  run_as_claude "$workdir" "$prompt"
}

cmd_async() {
  local prompt="$1"
  local workdir="${2:-$DEFAULT_WORKDIR}"
  local job_id worker_pid

  [[ -n "$prompt" ]] || usage
  ensure_jobs_dir

  job_id="$(generate_job_id)"
  JOB_ID="$job_id"
  STATUS="queued"
  CREATED_AT="$(timestamp_utc)"
  STARTED_AT=""
  FINISHED_AT=""
  WORKDIR="$workdir"
  PID=""
  EXIT_CODE=""
  SIGNAL=""
  CANCELLED_AT=""
  PROMPT="$prompt"
  write_meta

  : > "$(job_stdout_path "$job_id")"
  : > "$(job_stderr_path "$job_id")"

  nohup bash "$SCRIPT_PATH" __worker "$job_id" >/dev/null 2>&1 </dev/null &
  worker_pid=$!

  load_meta "$job_id"
  PID="$worker_pid"
  write_meta

  append_pending_log "job=$job_id status=queued pid=$worker_pid workdir=$workdir"
  printf "%s\n" "$job_id"
}

cmd_worker() {
  local job_id="$1"
  local stdout_path stderr_path exit_file exit_code signal

  ensure_jobs_dir
  load_meta "$job_id" || exit 1

  stdout_path="$(job_stdout_path "$job_id")"
  stderr_path="$(job_stderr_path "$job_id")"
  exit_file="$(job_exit_path "$job_id")"

  STATUS="running"
  STARTED_AT="$(timestamp_utc)"
  PID="$$"
  write_meta
  append_pending_log "job=$job_id status=running pid=$PID"

  set +e
  run_as_claude "$WORKDIR" "$PROMPT" >"$stdout_path" 2>"$stderr_path"
  exit_code=$?
  set -e
  printf "%s\n" "$exit_code" > "$exit_file"

  load_meta "$job_id"
  FINISHED_AT="$(timestamp_utc)"
  EXIT_CODE="$exit_code"
  SIGNAL=""

  if [[ "$STATUS" == "cancelling" || "$exit_code" == "143" || "$exit_code" == "137" ]]; then
    STATUS="cancelled"
    CANCELLED_AT="${CANCELLED_AT:-$FINISHED_AT}"
  elif [[ "$exit_code" == "0" ]]; then
    STATUS="succeeded"
  else
    STATUS="failed"
  fi

  write_meta
  append_pending_log "job=$job_id status=$STATUS exit=$exit_code"
}

cmd_status() {
  local job_id="$1"
  [[ -n "$job_id" ]] || usage
  load_meta "$job_id" || {
    echo "Job not found: $job_id" >&2
    exit 1
  }
  emit_job_json "status"
}

cmd_result() {
  local job_id="$1"
  [[ -n "$job_id" ]] || usage
  load_meta "$job_id" || {
    echo "Job not found: $job_id" >&2
    exit 1
  }
  emit_job_json "result"
}

cmd_cancel() {
  local job_id="$1"
  [[ -n "$job_id" ]] || usage
  load_meta "$job_id" || {
    echo "Job not found: $job_id" >&2
    exit 1
  }

  if [[ "$STATUS" != "queued" && "$STATUS" != "running" && "$STATUS" != "cancelling" ]]; then
    emit_job_json "status"
    return
  fi

  if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
    STATUS="cancelling"
    CANCELLED_AT="$(timestamp_utc)"
    write_meta
    kill -TERM "$PID" 2>/dev/null || true
    append_pending_log "job=$job_id status=cancelling pid=$PID"
  fi

  load_meta "$job_id"
  emit_job_json "status"
}

cmd_list() {
  ensure_jobs_dir
  emit_list_json
}

MODE="${1:-}"
[[ -n "$MODE" ]] || usage
shift || true

case "$MODE" in
  sync)
    PROMPT="${1:-}"
    WORKDIR="$DEFAULT_WORKDIR"
    shift || true
    if [[ "${1:-}" == "-w" ]]; then
      WORKDIR="${2:-}"
      [[ -n "$WORKDIR" ]] || usage
    fi
    cmd_sync "$PROMPT" "$WORKDIR"
    ;;
  async)
    PROMPT="${1:-}"
    WORKDIR="$DEFAULT_WORKDIR"
    shift || true
    if [[ "${1:-}" == "-w" ]]; then
      WORKDIR="${2:-}"
      [[ -n "$WORKDIR" ]] || usage
    fi
    cmd_async "$PROMPT" "$WORKDIR"
    ;;
  status)
    cmd_status "${1:-}"
    ;;
  result)
    cmd_result "${1:-}"
    ;;
  cancel)
    cmd_cancel "${1:-}"
    ;;
  list)
    cmd_list
    ;;
  __worker)
    cmd_worker "${1:-}"
    ;;
  *)
    usage
    ;;
esac
