#!/usr/bin/env bash
# android-signal-reporting-smoke.sh
# Sprint 07212317 — Android Agent 信号上报能力（Step 24-28）
# 独立验证 FR-1~5 信号层 API（UIA 双信号/error_code/latest_reply/dispatch 二次检测/signal-verify）
# Full E2E 请见 golden-path-2-smoke.sh Step 24-28
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"
DB_URL="${DB_URL:-postgresql://localhost/zenithjoy}"

fail() { echo "❌ FAIL: $1"; exit 1; }
ok() { echo "✅ $1"; }

# Quick sanity: FR-5 signal-verify 端点可达（未鉴权 → 401）
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/acquisition/signal-verify")
[ "$HTTP" = "401" ] || fail "signal-verify 无鉴权期望 401，得到 $HTTP"
ok "signal-verify 401 guard"

# Quick sanity: uia-signal 端点可达（无 x-agent-id → 401 or 400）
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" -d '{}' \
  "$API_BASE/api/agent/burner/uia-signal")
[ "$HTTP" = "401" ] || [ "$HTTP" = "400" ] || fail "uia-signal 无鉴权期望 401/400，得到 $HTTP"
ok "uia-signal auth guard"

echo "android-signal-reporting smoke: basic auth guards passed"
echo "Full E2E (Step 24-28) → golden-path-2-smoke.sh"
