#!/usr/bin/env bash
# staff-workbench smoke —— 员工工作台（任务 9cc10ff2 · 决策 af0d0818 执行层）
#
# 起真实 apps/api 进程，真实 curl 打两个新端点：
#   1. 两端点无认证头 → 403（staffGuard 不遗漏）
#   2. GET /api/staff/workbench/summary 带认证 → 200 + metrics 三键 + degraded 诚实透传
#      （CI 沙盒够不着 Brain：CECELIA_BRAIN_URL 显式指向必然拒连端口，degraded 快速稳定复现）
#   3. POST /api/staff/workbench/feedback 空 content → 400（校验先于反代）；
#      有 content → 502（Brain 拒连时诚实报 BRAIN_UNAVAILABLE，不假装成功）
set -euo pipefail

echo "== staff-workbench smoke =="

test -f apps/api/src/services/workbench.ts
test -f apps/api/src/routes/staff.ts
test -f apps/staff-hub/src/pages/HomePage.tsx

cd apps/api
npm run build >/dev/null 2>&1
PORT="${STAFF_WORKBENCH_SMOKE_PORT:-52112}"
export PORT
export NODE_ENV=development
export STAFF_EMAILS="${STAFF_EMAILS:-smoke-staff@zenithjoy.local}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-smoke-dev-secret-not-for-prod}"
export TOAPI_API_KEY="${TOAPI_API_KEY:-smoke-unused}"
export CECELIA_BRAIN_URL="http://127.0.0.1:39999"
AUTH_HEADER="X-User-Email: ${STAFF_EMAILS%%,*}"
API="http://localhost:${PORT}"

node -r dotenv/config dist/index.js > /tmp/staff-workbench-smoke-api.log 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

startup_diagnostic() {
  echo "FAIL: staff-workbench API startup=$1 child_exit=${2:-unknown}" >&2
  # Bound and redact diagnostics before sending them to the CI job log.
  python3 - /tmp/staff-workbench-smoke-api.log <<'PY_DIAGNOSTIC' >&2 || echo "startup diagnostic unavailable (no raw log fallback)" >&2
import os, re, sys
with open(sys.argv[1], 'rb') as stream:
    stream.seek(0, 2)
    offset = max(0, stream.tell() - 16384)
    stream.seek(offset)
    text = stream.read().decode('utf-8', errors='replace')
if offset:
    text = text.partition('\n')[2]
text = '\n'.join(text.splitlines()[-80:])
for key, value in sorted(os.environ.items(), key=lambda item: len(item[1]), reverse=True):
    if len(value) >= 4 and re.search(r'TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|CREDENTIAL|AUTHORIZATION', key, re.I):
        text = text.replace(value, '[REDACTED]')
text = re.sub(r'(-----BEGIN [^-]*PRIVATE KEY-----)[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)', '[REDACTED PRIVATE KEY]', text)
text = re.sub(r'(?i)(\bBearer\s+)[^\s\"\']+', r'\1[REDACTED]', text)
text = re.sub(r'(?i)([a-z][a-z0-9+.-]*://)[^/\s:@]+:[^/\s@]+@', r'\1[REDACTED]@', text)
text = re.sub(r'(?i)((?:api[_-]?key|access[_-]?token|token|password|passwd|secret|authorization)[\"\']?\s*[:=]\s*[\"\']?)[^&\s\"\']+', r'\1[REDACTED]', text)
print(text)
PY_DIAGNOSTIC
}

READY=0
for _ in $(seq 1 30); do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    CHILD_EXIT=0
    wait "$API_PID" || CHILD_EXIT=$?
    startup_diagnostic exited "$CHILD_EXIT"
    exit 1
  fi
  if curl -s -o /dev/null "${API}/health"; then READY=1; break; fi
  sleep 0.5
done
if [ "$READY" -ne 1 ]; then
  if kill -0 "$API_PID" 2>/dev/null; then
    startup_diagnostic not-ready running
  else
    CHILD_EXIT=0
    wait "$API_PID" || CHILD_EXIT=$?
    startup_diagnostic exited "$CHILD_EXIT"
  fi
  exit 1
fi

fail() { echo "FAIL: $1"; exit 1; }

echo "-- 1. 两个工作台端点无认证头一律 403 --"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API}/api/staff/workbench/summary")
[ "$CODE" = "403" ] || fail "summary 无认证头应 403，实得 $CODE"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API}/api/staff/workbench/feedback" \
  -H "Content-Type: application/json" -d '{"content":"x"}')
[ "$CODE" = "403" ] || fail "feedback 无认证头应 403，实得 $CODE"
echo "   403: PASS"

echo "-- 2. GET summary 带认证 → 200 + metrics 三键 + degraded 透传 --"
SUMMARY=$(curl -sf "${API}/api/staff/workbench/summary" -H "$AUTH_HEADER") || fail "summary 端点不可达"
echo "$SUMMARY" | jq -e '.success == true' >/dev/null || fail "summary success 应为 true"
echo "$SUMMARY" | jq -e '.availability == "degraded"' >/dev/null \
  || fail "CI 沙盒够不着 Brain，summary availability 应为 degraded"
echo "$SUMMARY" | jq -e '.metrics | has("pending_acceptance") and has("ai_running") and has("completed_7d")' >/dev/null \
  || fail "metrics 必须含三键"
echo "$SUMMARY" | jq -e '(.pending_runs | type == "array") and (.ai_tasks | type == "array")' >/dev/null \
  || fail "pending_runs/ai_tasks 必须恒为数组"
echo "   summary 200 + metrics + degraded: PASS"

echo "-- 3. POST feedback 空 content → 400；有 content 且 Brain 拒连 → 502 诚实报错 --"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API}/api/staff/workbench/feedback" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" -d '{"content":"   "}')
[ "$CODE" = "400" ] || fail "feedback 空 content 应 400，实得 $CODE"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API}/api/staff/workbench/feedback" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" -d '{"content":"smoke 反馈"}')
[ "$CODE" = "502" ] || fail "Brain 拒连时 feedback 应 502（不假装成功），实得 $CODE"
echo "   feedback 400/502: PASS"

kill $API_PID 2>/dev/null || true
trap - EXIT
echo "== staff-workbench smoke: ALL PASS =="
