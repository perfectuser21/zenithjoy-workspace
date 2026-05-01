#!/usr/bin/env bash
# topics-smoke.sh — 话题管理 smoke
# 验证：list / create / get / patch / delete 完整 CRUD
set -euo pipefail

API="${API_BASE:-http://localhost:5200}"
INT_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-}"
PASS=0; FAIL=0

ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── topics-list ──"
r=$(curl -s "$API/api/topics" -H "X-Internal-Token: $INT_TOKEN")
echo "$r" | jq -e '.success == true and .data.items != null' >/dev/null 2>&1 \
  && ok "GET /topics 返回 {success, data: {items, total, ...}}" \
  || fail "GET /topics 响应异常 ($r)"

echo "── topics-create ──"
SMOKE_TITLE="smoke-topic-$(date +%s)"
r=$(curl -s -X POST "$API/api/topics" \
    -H "X-Internal-Token: $INT_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"$SMOKE_TITLE\",\"keywords\":[\"smoke\",\"test\"],\"status\":\"待研究\"}")
echo "$r" | jq -e '.success == true and .data.id != null' >/dev/null 2>&1 \
  && ok "POST /topics 创建成功，返回 id" \
  || fail "POST /topics 失败 ($r)"

TOPIC_ID=$(echo "$r" | jq -r '.data.id // empty')

if [[ -n "$TOPIC_ID" ]]; then
  echo "── topics-get ──"
  r2=$(curl -s "$API/api/topics/$TOPIC_ID" -H "X-Internal-Token: $INT_TOKEN")
  echo "$r2" | jq -e '.success == true and .data.id != null' >/dev/null 2>&1 \
    && ok "GET /topics/:id 返回话题详情" \
    || fail "GET /topics/:id 失败 ($r2)"

  echo "── topics-patch ──"
  r3=$(curl -s -X PATCH "$API/api/topics/$TOPIC_ID" \
      -H "X-Internal-Token: $INT_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"status":"已通过"}')
  echo "$r3" | jq -e '.success == true' >/dev/null 2>&1 \
    && ok "PATCH /topics/:id 更新 status 成功" \
    || fail "PATCH /topics/:id 失败 ($r3)"

  echo "── topics-delete ──"
  r4=$(curl -s -X DELETE "$API/api/topics/$TOPIC_ID" -H "X-Internal-Token: $INT_TOKEN")
  echo "$r4" | jq -e '.success == true' >/dev/null 2>&1 \
    && ok "DELETE /topics/:id 删除成功" \
    || fail "DELETE /topics/:id 失败 ($r4)"
fi

echo ""
echo "────────────────────────────────────"
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ topics smoke 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
