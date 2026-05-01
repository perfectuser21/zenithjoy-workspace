#!/usr/bin/env bash
# snapshots-smoke.sh — 平台数据快照 smoke（media_platform_data）
# 验证：ingest / 按平台查询 / 按 workId 查询
set -euo pipefail

API="${API_BASE:-http://localhost:5200}"
INT_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-}"
PASS=0; FAIL=0
SMOKE_PLATFORM="douyin"
SMOKE_CONTENT_ID="smoke-snapshot-$(date +%s)"

ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── snapshots-ingest ──"
# ingest API: { platform, items: [{content_id, scraped_date, title, views, ...}] }
r=$(curl -s -X POST "$API/api/snapshots/ingest" \
    -H "X-Internal-Token: $INT_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"platform\":\"$SMOKE_PLATFORM\",\"items\":[{\"content_id\":\"$SMOKE_CONTENT_ID\",\"scraped_date\":\"$(date +%Y-%m-%d)\",\"title\":\"smoke\",\"views\":1000,\"likes\":50,\"comments\":10,\"shares\":5,\"saves\":3}]}")
echo "$r" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "POST /snapshots/ingest 摄入成功" \
  || fail "POST /snapshots/ingest 失败 ($r)"

echo "── snapshots-by-platform ──"
r=$(curl -s "$API/api/snapshots/$SMOKE_PLATFORM" -H "X-Internal-Token: $INT_TOKEN")
echo "$r" | jq -e '.success == true and (.data | type) == "array"' >/dev/null 2>&1 \
  && ok "GET /snapshots/:platform 返回 {success, data: []}" \
  || fail "GET /snapshots/:platform 响应异常 ($r)"

echo "── snapshots-by-work ──"
# work/:workId 按 work_id 查询（daily_snapshots 存的是 content_id，不是 work_id）
# 验证端点可达 + 返回数组
r=$(curl -s "$API/api/snapshots/work/00000000-0000-0000-0000-000000000001" -H "X-Internal-Token: $INT_TOKEN")
echo "$r" | jq -e 'type == "array" or (.data != null)' >/dev/null 2>&1 \
  && ok "GET /snapshots/work/:workId 端点可达，返回数组" \
  || fail "GET /snapshots/work/:workId 响应异常 ($r)"

echo ""
echo "────────────────────────────────────"
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ snapshots smoke 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
