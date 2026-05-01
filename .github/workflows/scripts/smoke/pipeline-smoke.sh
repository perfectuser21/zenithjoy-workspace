#!/usr/bin/env bash
# pipeline-smoke.sh — 内容工厂 Pipeline smoke（media_content_factory）
# 验证：dashboard-stats / trigger / 单条查询 / 列表
set -euo pipefail

API="${API_BASE:-http://localhost:5200}"
INT_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-}"
PASS=0; FAIL=0

ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── pipeline-dashboard-stats ──"
r=$(curl -s "$API/api/pipeline/dashboard-stats" -H "X-Internal-Token: $INT_TOKEN")
echo "$r" | jq -e '.total != null and .running != null' >/dev/null 2>&1 \
  && ok "GET /pipeline/dashboard-stats 返回 {total, running, ...}" \
  || fail "GET /pipeline/dashboard-stats 响应异常 ($r)"

echo "── pipeline-list ──"
r=$(curl -s "$API/api/pipeline" -H "X-Internal-Token: $INT_TOKEN")
echo "$r" | jq -e '.data != null or type == "array"' >/dev/null 2>&1 \
  && ok "GET /pipeline 端点可达" \
  || fail "GET /pipeline 响应异常 ($r)"

echo "── pipeline-trigger ──"
# 用 X-Manual-Override 绕过 topic_id 强校验，测试路由+创建链路
r=$(curl -s -X POST "$API/api/pipeline/trigger" \
    -H "X-Internal-Token: $INT_TOKEN" \
    -H "X-Manual-Override: true" \
    -H "Content-Type: application/json" \
    -d '{"content_type":"video","topic":"smoke-test-topic"}')
echo "$r" | jq -e '.success == true and .data.id != null' >/dev/null 2>&1 \
  && ok "POST /pipeline/trigger 创建成功，返回 pipeline id" \
  || fail "POST /pipeline/trigger 失败 ($r)"

PIPELINE_ID=$(echo "$r" | jq -r '.data.id // empty')

if [[ -n "$PIPELINE_ID" ]]; then
  echo "── pipeline-get-single ──"
  r2=$(curl -s "$API/api/pipeline/$PIPELINE_ID" -H "X-Internal-Token: $INT_TOKEN")
  echo "$r2" | jq -e '.data.id != null or .id != null' >/dev/null 2>&1 \
    && ok "GET /pipeline/:id 返回 pipeline 详情" \
    || fail "GET /pipeline/:id 响应异常 ($r2)"
fi

echo ""
echo "────────────────────────────────────"
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ pipeline smoke 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
