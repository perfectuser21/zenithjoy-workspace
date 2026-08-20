#!/usr/bin/env bash
# fields-smoke.sh — CRM 自定义字段管理 smoke（crm_field_management）
# 验证：list / create / update / delete 完整 CRUD
set -euo pipefail

API="${API_BASE:-http://localhost:5200}"
INT_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-}"
PASS=0; FAIL=0

ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── fields-list ──"
r=$(curl -s "$API/api/fields" -H "X-Internal-Token: $INT_TOKEN")
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 \
  && ok "GET /fields 返回数组" \
  || fail "GET /fields 响应异常 ($r)"

echo "── fields-create ──"
r=$(curl -s -X POST "$API/api/fields" \
    -H "X-Internal-Token: $INT_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"field_name":"smoke-test-field-'"$(date +%s)"'","field_type":"text","label":"Smoke Test Field"}')
echo "$r" | jq -e '.id != null' >/dev/null 2>&1 \
  && ok "POST /fields 创建成功，返回 id" \
  || fail "POST /fields 失败 ($r)"

FIELD_ID=$(echo "$r" | jq -r '.id // empty')

if [[ -n "$FIELD_ID" ]]; then
  echo "── fields-update ──"
  r2=$(curl -s -X PUT "$API/api/fields/$FIELD_ID" \
      -H "X-Internal-Token: $INT_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"label":"Smoke Updated Label"}')
  echo "$r2" | jq -e '.id != null' >/dev/null 2>&1 \
    && ok "PUT /fields/:id 更新成功" \
    || fail "PUT /fields/:id 失败 ($r2)"

  echo "── fields-delete ──"
  http_code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API/api/fields/$FIELD_ID" \
      -H "X-Internal-Token: $INT_TOKEN")
  [[ "$http_code" == "200" || "$http_code" == "204" ]] \
    && ok "DELETE /fields/:id 删除成功 (HTTP $http_code)" \
    || fail "DELETE /fields/:id 失败 (HTTP $http_code)"
fi

echo ""
echo "────────────────────────────────────"
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ fields smoke 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
