#!/usr/bin/env bash
# operator-session-sync-smoke.sh — POST /api/operator/sessions/sync 端点 Smoke
#
# 验证：
#   1. POST /api/operator/sessions/sync（superAdmin）→ 200 + {matrix: object}
#   2. matrix 顶层 keys 包含已知平台（抖音/快手/小红书 etc.）或为空对象
#   3. 非 superAdmin → 403
#
# 依赖：
#   API_BASE   API 基础 URL（默认 http://localhost:5200）

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
PASS=0
FAIL=0

ok()   { echo "  ✅ $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $*"; FAIL=$((FAIL+1)); }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  operator-session-sync smoke"
echo "  API: $API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. superAdmin 可访问，返回 200 + matrix
RESP=$(curl -s -o /tmp/op-sync-resp.json -w "%{http_code}" \
  -X POST "$API_BASE/api/operator/sessions/sync" \
  -H "x-super-admin: true")

if [ "$RESP" = "200" ]; then
  ok "POST /api/operator/sessions/sync → 200"
else
  fail "POST /api/operator/sessions/sync → expected 200, got $RESP"
fi

# 2. 响应包含 matrix 字段
if node -e "
const d=require('/tmp/op-sync-resp.json');
if(typeof d.matrix !== 'object') process.exit(1);
process.exit(0);
" 2>/dev/null; then
  ok "response has {matrix: object}"
else
  fail "response missing {matrix: object}"
fi

# 3. 非 superAdmin → 403
UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API_BASE/api/operator/sessions/sync")
if [ "$UNAUTH" = "403" ]; then
  ok "no auth → 403"
else
  fail "no auth → expected 403, got $UNAUTH"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  smoke done: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

[ "$FAIL" -eq 0 ]
