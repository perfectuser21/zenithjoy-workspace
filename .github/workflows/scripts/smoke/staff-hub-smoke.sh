#!/usr/bin/env bash
set -euo pipefail

echo "== staff-hub smoke =="
node scripts/check-staff-hub-llm-imports.mjs
test -f apps/staff-hub/src/App.tsx
test -f apps/staff-hub/src/pages/SkillEvalPage.tsx
# Path 健康已下线合并进业务线健康看板（line-health），2026-07-29
test -f apps/staff-hub/src/pages/LineHealthPage.tsx
node -e "const fs=require('fs');const c=fs.readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(c.includes('/staff/skill-eval'))process.exit(1);console.log('dashboard route removed')"

echo "-- 起真实API进程，验证feishu-login真实behavior --"
cd apps/api
npm run build >/dev/null 2>&1
PORT="${STAFF_HUB_SMOKE_PORT:-52101}"
export PORT
export NODE_ENV=development
export STAFF_EMAILS="${STAFF_EMAILS:-smoke-staff@zenithjoy.local}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-smoke-dev-secret-not-for-prod}"
export TOAPI_API_KEY="${TOAPI_API_KEY:-smoke-unused}"

node -r dotenv/config dist/index.js > /tmp/staff-hub-smoke-api.log 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

for i in $(seq 1 20); do
  if curl -s -o /dev/null "http://localhost:${PORT}/health"; then break; fi
  sleep 0.5
done

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:${PORT}/api/staff/feishu-login" \
  -H "Content-Type: application/json" -d '{}')
if [ "$STATUS" != "400" ]; then
  echo "FAIL: /api/staff/feishu-login 缺code应400，实得 $STATUS"; exit 1
fi
echo "feishu-login 缺code->400: PASS"

STATUS2=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/api/staff/line-health" \
  -H "X-User-Email: not-in-whitelist@example.com")
if [ "$STATUS2" != "403" ]; then
  echo "FAIL: line-health 非白名单邮箱应403，实得 $STATUS2"; exit 1
fi
echo "line-health 非白名单->403: PASS"

kill $API_PID 2>/dev/null || true
trap - EXIT
cd ../..

echo "staff-hub smoke: PASS"
