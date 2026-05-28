#!/usr/bin/env bash
# ws2-operator-sessions-api-smoke.sh
# Line 00 Session Health Medium WS2 — operator-sessions 4 端点 smoke test
#
# 验证链路：
#   1. POST /api/operator/sessions/trigger-bind {platform:douyin} → 202 + {ok,platform,taskId}
#   2. keys 不含禁用字段（id/task/jobId/requestId）
#   3. 非法 platform → 400 + error 字段
#   4. GET  /api/operator/sessions → 200 + array 8 条，secretName 以 _COOKIES 结尾
#   5. POST /api/operator/sessions/status → 200 + {ok,updated}
#
# 退出码：0=全过，1=失败
#
# 依赖：
#   ZJ_API_URL 默认 http://localhost:5200

set -uo pipefail

ZJ_API="${ZJ_API_URL:-http://localhost:5200}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  operator-sessions API Smoke (WS2)"
echo "  ZJ_API=$ZJ_API"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

# 1. POST trigger-bind → 202
HTTP=$(curl -sf -o "$TMP" -w "%{http_code}" --max-time 10 \
  -X POST "${ZJ_API}/api/operator/sessions/trigger-bind" \
  -H "Content-Type: application/json" \
  -d '{"platform":"douyin"}')
[ "$HTTP" = "202" ] || fail "trigger-bind: 期望 202，got $HTTP"
ok "POST trigger-bind → 202"

# 2. keys 完整性：ok + platform + taskId，且不含禁用字段
BODY=$(cat "$TMP")
echo "$BODY" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const k = Object.keys(d).sort().join(',');
  if (k !== 'ok,platform,taskId') { console.error('FAIL keys='+k); process.exit(1); }
  for (const banned of ['id','task','jobId','requestId']) {
    if (banned in d) { console.error('FAIL 禁用字段 '+banned); process.exit(1); }
  }
" || fail "trigger-bind keys 校验失败"
ok "trigger-bind keys={ok,platform,taskId}，无禁用字段"

# 3. 非法 platform → 400
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  -X POST "${ZJ_API}/api/operator/sessions/trigger-bind" \
  -H "Content-Type: application/json" \
  -d '{"platform":"invalid_xyz_999"}')
[ "$HTTP" = "400" ] || fail "非法 platform: 期望 400，got $HTTP"
ok "非法 platform → 400"

# 4. GET sessions → 200 + 8 条 + secretName 以 _COOKIES 结尾
HTTP=$(curl -sf -o "$TMP" -w "%{http_code}" --max-time 10 \
  "${ZJ_API}/api/operator/sessions")
[ "$HTTP" = "200" ] || fail "GET sessions: 期望 200，got $HTTP"
node -e "
  const arr = JSON.parse(require('fs').readFileSync('${TMP}','utf8'));
  if (!Array.isArray(arr)) { console.error('FAIL: 非 array'); process.exit(1); }
  if (arr.length !== 8) { console.error('FAIL: 期望 8 条，got '+arr.length); process.exit(1); }
  const keys = Object.keys(arr[0]).sort().join(',');
  const exp = 'lastCheckedAt,lastValidAt,platform,secretName,status';
  if (keys !== exp) { console.error('FAIL keys='+keys); process.exit(1); }
  for (const item of arr) {
    if (!item.secretName.endsWith('_COOKIES')) { console.error('FAIL secretName='+item.secretName); process.exit(1); }
  }
" || fail "GET sessions 数据校验失败"
ok "GET sessions → 8 条，secretName=*_COOKIES"

# 5. POST status → 200 + {ok,updated}
HTTP=$(curl -sf -o "$TMP" -w "%{http_code}" --max-time 10 \
  -X POST "${ZJ_API}/api/operator/sessions/status" \
  -H "Content-Type: application/json" \
  -d '{"updates":[{"platform":"douyin","status":"active","checkedAt":"2026-05-27T10:00:00Z"}]}')
[ "$HTTP" = "200" ] || fail "POST status: 期望 200，got $HTTP"
node -e "
  const d = JSON.parse(require('fs').readFileSync('${TMP}','utf8'));
  if (d.ok !== true) { console.error('FAIL ok='+d.ok); process.exit(1); }
  if (typeof d.updated !== 'number') { console.error('FAIL updated type='+typeof d.updated); process.exit(1); }
  const k = Object.keys(d).sort().join(',');
  if (k !== 'ok,updated') { console.error('FAIL keys='+k); process.exit(1); }
" || fail "POST status 数据校验失败"
ok "POST status → {ok,updated}"

echo ""
echo "✅ operator-sessions API Smoke 全部通过"
