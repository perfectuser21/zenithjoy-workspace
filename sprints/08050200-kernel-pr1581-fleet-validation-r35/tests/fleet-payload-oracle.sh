#!/usr/bin/env bash
set -euo pipefail

[ "${1:-}" = "--negative-matrix" ]
BUNDLE=${2:?task bundle path required}
PAYLOAD=$(jq -cer '.inputs | select(type=="object")' "$BUNDLE")

validate_input() {
  jq -e 'type=="object" and .base_repo=="perfectuser21/zenithjoy-workspace" and (.target_head_sha|type=="string" and test("^[0-9a-f]{40}$")) and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7"' >/dev/null
}

reject_input() {
  local name=$1 candidate=$2
  if printf '%s' "$candidate" | validate_input; then
    echo "FAIL: $name accepted"
    exit 1
  fi
  echo "REJECTED: $name"
}

reject_input missing_base_repo "$(jq -c 'del(.base_repo)' <<<"$PAYLOAD")"
reject_input short_target_sha "$(jq -c '.target_head_sha="c305f621"' <<<"$PAYLOAD")"
reject_input wrong_gp_anchor "$(jq -c '.gp_anchor="line02/keyword_acquisition#step6"' <<<"$PAYLOAD")"

if GH_TOKEN= GITHUB_TOKEN= gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --hostname invalid.invalid >/dev/null 2>&1; then
  echo 'FAIL: GitHub unavailable case accepted'
  exit 1
fi
echo 'REJECTED: github_unavailable => environment_failed'

if psql 'postgresql://127.0.0.1:1/unavailable?connect_timeout=1' -XtAc 'SELECT 1' >/dev/null 2>&1; then
  echo 'FAIL: Postgres unavailable case accepted'
  exit 1
fi
echo 'REJECTED: postgres_unavailable => environment_failed'
