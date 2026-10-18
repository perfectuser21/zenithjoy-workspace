#!/usr/bin/env bash
# 真实HTTP接口冒烟：模板、服务鉴权、非法绑定。不会创建外部资源或修改公司配置。
# 外部Notion/飞书建库、数据同步和客户分享须另用实际平台回执验收。
set -euo pipefail
API_BASE="${API_BASE:-http://127.0.0.1:5200}"
WORKSPACE_SMOKE_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:?ZENITHJOY_INTERNAL_TOKEN required}"
WORKSPACE_SMOKE_RESPONSE=$(mktemp)
trap 'rm -f "$WORKSPACE_SMOKE_RESPONSE"' EXIT

curl -fsS --max-time 20 "$API_BASE/api/internal/customer-workspaces/template" \
  -H "X-Internal-Token: $WORKSPACE_SMOKE_TOKEN" > "$WORKSPACE_SMOKE_RESPONSE"
jq -e '.success == true and .data.template_version == 1 and (.data.objects | length) == 11' "$WORKSPACE_SMOKE_RESPONSE" >/dev/null
curl -fsS --max-time 20 "$API_BASE/api/internal/customer-workspaces/template?module=leadgen" \
  -H "X-Internal-Token: $WORKSPACE_SMOKE_TOKEN" > "$WORKSPACE_SMOKE_RESPONSE"
jq -e '.success == true and (.data.objects | length) == 16 and ([.data.objects[].key] | unique | length) == 16' "$WORKSPACE_SMOKE_RESPONSE" >/dev/null

WORKSPACE_SMOKE_CODE=$(curl -sS --max-time 20 -o "$WORKSPACE_SMOKE_RESPONSE" -w '%{http_code}' "$API_BASE/api/internal/customer-workspaces/template")
test "$WORKSPACE_SMOKE_CODE" = 401
jq -e '.success == false' "$WORKSPACE_SMOKE_RESPONSE" >/dev/null
WORKSPACE_SMOKE_CODE=$(curl -sS --max-time 20 -o "$WORKSPACE_SMOKE_RESPONSE" -w '%{http_code}' \
  -X POST "$API_BASE/api/internal/customer-workspaces/invalid-company/bind" \
  -H "X-Internal-Token: $WORKSPACE_SMOKE_TOKEN" -H 'Content-Type: application/json' --data '{}')
test "$WORKSPACE_SMOKE_CODE" = 400
jq -e '.error == "EXPLICIT_APPROVED_WORKSPACE_BINDING_REQUIRED"' "$WORKSPACE_SMOKE_RESPONSE" >/dev/null
echo 'PASS: 客户工作台真实HTTP模板11/16、无凭据拒绝和非法绑定拒绝；外部开户/同步未在此验收'
