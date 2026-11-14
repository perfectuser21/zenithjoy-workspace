#!/usr/bin/env bash
# Isolated test-only task authority shared by existing content CI consumers.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
: "${RUNNER_TEMP:?job-owned RUNNER_TEMP required}"
: "${GITHUB_ENV:?CI environment handoff file required}"
case "${1:-start}" in
  start)
    python3 "$ROOT/services/content-pipeline/tests/helpers/brain_protocol_server.py" \
      --ready-file "$RUNNER_TEMP/content-brain-url" \
      --state-file "$RUNNER_TEMP/content-brain-state.json" > "$RUNNER_TEMP/content-brain-fixture.log" 2>&1 &
    fixture_pid=$!
    printf '%s\n' "$fixture_pid" > "$RUNNER_TEMP/content-brain.pid"
    for _ in $(seq 1 30); do
      if [ -s "$RUNNER_TEMP/content-brain-url" ]; then break; fi
      kill -0 "$fixture_pid"
      sleep 1
    done
    fixture_url="$(cat "$RUNNER_TEMP/content-brain-url")"
    case "$fixture_url" in http://127.0.0.1:*) ;; *) exit 1;; esac
    curl --fail --silent "$fixture_url/health"
    printf 'BRAIN_URL=%s\nCECELIA_BRAIN_URL=%s\nBRAIN_STATE_FILE=%s\n' \
      "$fixture_url" "$fixture_url" "$RUNNER_TEMP/content-brain-state.json" >> "$GITHUB_ENV"
    ;;
  stop)
    if [ -f "$RUNNER_TEMP/content-brain.pid" ]; then
      kill "$(cat "$RUNNER_TEMP/content-brain.pid")" 2>/dev/null || true
    fi
    ;;
  *) exit 2;;
esac
