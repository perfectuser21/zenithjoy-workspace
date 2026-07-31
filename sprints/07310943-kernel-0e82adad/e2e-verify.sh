#!/usr/bin/env bash
set -euo pipefail
: "${SPRINT_DIR:=sprints/07310943-kernel-0e82adad}"
: "${GITHUB_REF_NAME:?}"
: "${GH_REPO:=perfectuser21/zenithjoy-workspace}"
test "${RUNNER_OS:-}" = "Windows" || { echo "FAIL: windows_cloud runner required"; exit 1; }
pwsh -NoProfile -File "$SPRINT_DIR/e2e-verify.ps1" -BaseUrl http://localhost:5174 -ApiUrl http://localhost:3000 -Repeat 2 -ScreenshotDir "$SPRINT_DIR/screenshots"
EXPECTED_SHA=$(git rev-parse HEAD)
DISPATCHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ATTEMPT_MARKER="cancel-${EXPECTED_SHA:0:12}-$(date +%s)-$$"
gh workflow run e2e-line02-android-collect.yml --repo "$GH_REPO" --ref "$GITHUB_REF_NAME" -f scenario=cancel -f repeat=2 -f attempt_marker="$ATTEMPT_MARKER"
RUN_ID=""
for DISCOVERY_POLL in $(seq 1 30); do RUN_ID=$(gh run list --repo "$GH_REPO" --workflow e2e-line02-android-collect.yml --branch "$GITHUB_REF_NAME" --event workflow_dispatch --limit 20 --json databaseId,createdAt,headSha | jq -r --arg ts "$DISPATCHED_AT" --arg sha "$EXPECTED_SHA" '[.[] | select((.createdAt|fromdateiso8601) >= ($ts|fromdateiso8601) and .headSha == $sha)] | first | .databaseId // empty'); test -n "$RUN_ID" && break; sleep 2; done
test -n "$RUN_ID"
for POLL in $(seq 1 180); do STATUS=$(gh run view "$RUN_ID" --repo "$GH_REPO" --json status --jq '.status'); test "$STATUS" = completed && break; test "$POLL" -lt 180 || exit 1; sleep 5; done
RUN_META=$(gh run view "$RUN_ID" --repo "$GH_REPO" --json conclusion,headSha,url)
test "$(jq -r .conclusion <<<"$RUN_META")" = success
test "$(jq -r .headSha <<<"$RUN_META")" = "$EXPECTED_SHA"
mkdir -p "$SPRINT_DIR/evidence/android"
gh run download "$RUN_ID" --repo "$GH_REPO" --name android-cancel-evidence --dir "$SPRINT_DIR/evidence/android"
for N in 1 2; do jq -e --argjson run_id "$RUN_ID" --arg sha "$EXPECTED_SHA" --arg marker "$ATTEMPT_MARKER" --argjson repeat_index "$N" '.github_run_id==$run_id and .head_sha==$sha and .attempt_marker==$marker and .repeat_index==$repeat_index and .scenario=="cancel" and .safe_exit==true and .switch_account_panel_open==false and .continued_list_reads==0 and .report_status=="cancelled" and (.machine_id|type=="string" and length>0) and ((.cancel_requested_at|fromdateiso8601) <= (.command_received_at|fromdateiso8601)) and (((.command_received_at|fromdateiso8601)-(.cancel_requested_at|fromdateiso8601)) <= 30)' "$SPRINT_DIR/evidence/android/result-$N.json"; done
test -s "$SPRINT_DIR/screenshots/cancel-requested.png"
test -s "$SPRINT_DIR/screenshots/cancel-sent.png"
test -s "$SPRINT_DIR/screenshots/cancel-confirmed.png"
test -s "$SPRINT_DIR/screenshots/cancel-cooldown.png"
echo "OK: Windows 真后端 UI x2 + Android 真机取消 x2"
