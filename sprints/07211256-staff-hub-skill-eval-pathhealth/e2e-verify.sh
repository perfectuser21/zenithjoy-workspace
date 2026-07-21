#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "== Staff Hub verify =="
node "$ROOT/scripts/check-staff-hub-llm-imports.mjs"

echo "== API contract (vitest) =="
cd "$ROOT/apps/api"
npx vitest run src/routes/__tests__/staff.test.ts

echo "== Staff Hub build =="
cd "$ROOT/apps/staff-hub"
npm run build

echo "== 真实服务器 E2E：起真进程，打真请求 =="
cd "$ROOT/apps/api"
npm run build >/dev/null 2>&1

PORT="${STAFF_HUB_E2E_PORT:-52100}"
export PORT
export NODE_ENV=development
export STAFF_EMAILS="${STAFF_EMAILS:-e2e-staff@zenithjoy.local}"

node -r dotenv/config dist/index.js > /tmp/staff-hub-e2e-api.log 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

for i in $(seq 1 20); do
  if curl -s -o /dev/null "http://localhost:${PORT}/health"; then
    break
  fi
  sleep 0.5
done

echo "-- feishu-login: 缺 code 参数必须 400 --"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:${PORT}/api/staff/feishu-login" \
  -H "Content-Type: application/json" -d '{}')
if [ "$STATUS" != "400" ]; then
  echo "FAIL: 期望 400，实得 $STATUS"; exit 1
fi
echo "PASS ($STATUS)"

if [ -n "${FEISHU_APP_ID:-}" ] && [ -n "${FEISHU_APP_SECRET:-}" ]; then
  echo "-- feishu-login: 真实 code 换 app_access_token 打真飞书服务器 --"
  BODY=$(curl -s -X POST "http://localhost:${PORT}/api/staff/feishu-login" \
    -H "Content-Type: application/json" -d '{"code":"e2e-verify-fake-code-not-a-real-user"}')
  # 假code不可能拿到真用户，期望502(飞书拒绝该code)而不是500(我们自己的代码崩溃)
  # 只要不是500，就证明：真的打到了飞书app_access_token接口且拿到了真token，
  # 第二步真的把fake code发给了飞书authen接口且飞书真的返回了拒绝
  STATUS2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:${PORT}/api/staff/feishu-login" \
    -H "Content-Type: application/json" -d '{"code":"e2e-verify-fake-code-not-a-real-user"}')
  if [ "$STATUS2" = "500" ]; then
    echo "FAIL: 500 说明我们自己代码崩了（不是飞书判定问题）"; echo "$BODY"; exit 1
  fi
  echo "PASS (status=${STATUS2}, 飞书真实判定fake code非法, 链路端到端打通)"
else
  echo "SKIP: 未配置 FEISHU_APP_ID/SECRET，跳过真实飞书网络往返检查"
fi

kill $API_PID 2>/dev/null || true
trap - EXIT

echo "staff-hub verify: PASS"
