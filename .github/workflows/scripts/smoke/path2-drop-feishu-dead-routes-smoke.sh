#!/usr/bin/env bash
# CI-CAPABLE: line-a
# path2-drop-feishu-dead-routes-smoke.sh — Path2 已死飞书Bitable代码清理 smoke
#
# 覆盖决策 19e6480c：已确认被 acquisition.ts 本地实现取代的 Path2 飞书路由/服务全部删除，
# 端到端验证这几条路由现在真的不存在了（不是只删了 import，还要摘掉挂载）：
#   [1] GET  /api/lead-config/self          → 404（lead-config.ts 路由已删除）
#   [2] POST /api/feishu/customer-list/sync → 404（feishu-customer-list.ts 路由已删除）
#   [3] POST /api/_smoke/feishu-seed        → 非 200（_smoke-feishu-seed.ts 已删除）
#   [4] Dashboard /dashboard/feishu-bind 路由表里已摘除（FeishuBindTenant 页面已删除）
set -euo pipefail

API="${ZJ_API:-http://localhost:5200}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
PASS=0
FAIL=0

assert() {
  if [ "$1" = "$2" ]; then echo "  PASS: $3"; PASS=$((PASS+1));
  else echo "  FAIL: $3 (expected $2, got $1)"; FAIL=$((FAIL+1)); fi
}

API_REACHABLE=0
if curl -s --max-time 2 -o /dev/null "$API/health" 2>/dev/null; then
  API_REACHABLE=1
fi

echo "=== [1] GET /api/lead-config/self → 404（路由已删除） ==="
if [ "$API_REACHABLE" -eq 0 ]; then
  echo "  SKIP: API 不可达"
else
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$API/api/lead-config/self")
  assert "$CODE" "404" "lead-config 路由已摘除"
fi

echo ""
echo "=== [2] POST /api/feishu/customer-list/sync → 404（路由已删除） ==="
if [ "$API_REACHABLE" -eq 0 ]; then
  echo "  SKIP: API 不可达"
else
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST "$API/api/feishu/customer-list/sync" -H "Content-Type: application/json" -d '{}')
  assert "$CODE" "404" "feishu-customer-list 路由已摘除"
fi

echo ""
echo "=== [3] POST /api/_smoke/feishu-seed → 非 200（helper 已删除） ==="
if [ "$API_REACHABLE" -eq 0 ]; then
  echo "  SKIP: API 不可达"
else
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST "$API/api/_smoke/feishu-seed" -H "Content-Type: application/json" -d '{}')
  if [ "$CODE" != "200" ]; then
    echo "  PASS: _smoke-feishu-seed helper 已摘除 (status=$CODE)"
    PASS=$((PASS+1))
  else
    echo "  FAIL: _smoke-feishu-seed helper 仍返回 200"
    FAIL=$((FAIL+1))
  fi
fi

echo ""
echo "=== [4] FeishuBindTenant 页面组件文件已删除 + 无 import 残留 ==="
if [ -f "$ROOT/apps/dashboard/src/pages/FeishuBindTenant.tsx" ]; then
  echo "  FAIL: FeishuBindTenant.tsx 文件仍存在"
  FAIL=$((FAIL+1))
else
  echo "  PASS: FeishuBindTenant.tsx 文件已删除"
  PASS=$((PASS+1))
fi

IMPORT_HITS=$(grep -rlE "(from ['\"].*FeishuBindTenant['\"]|import\(['\"].*FeishuBindTenant['\"]\))" "$ROOT/apps/dashboard/src" 2>/dev/null || true)
if [ -n "$IMPORT_HITS" ]; then
  echo "  FAIL: 仍有文件 import FeishuBindTenant: $IMPORT_HITS"
  FAIL=$((FAIL+1))
else
  echo "  PASS: 无文件 import FeishuBindTenant"
  PASS=$((PASS+1))
fi

echo ""
echo "Smoke: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
