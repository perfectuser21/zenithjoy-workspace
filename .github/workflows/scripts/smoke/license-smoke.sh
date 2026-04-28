#!/usr/bin/env bash
# E2E smoke test for License v1.2 system
#
# 端到端验证 License 系统 4 大场景：
#   1. admin 能生成 license（POST /api/admin/license, 需 internalAuth）
#   2. Agent 能用 license 注册并拿到 ws_token（POST /api/agent/register）
#   3. 超过 tier 配额（basic 仅 1 台）→ 第二次注册返回 403
#   4. 无效 license_key → 返回 401
#
# 前置：
#   - apps/api 已启动监听 ${API_URL:-http://localhost:5200}
#   - Postgres zenithjoy schema + license migration 已跑
#   - 环境变量 ZENITHJOY_INTERNAL_TOKEN（默认 internal-dev-token，
#     若 apps/api 未设此 env 则放行，仍可通过）
#
# 退出码：0 = 全部通过，非 0 = 任一场景失败

set -euo pipefail

API="${API_URL:-http://localhost:5200}"
ADMIN_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-internal-dev-token}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  License v1.2 E2E Smoke"
echo "  API: $API"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "=== Smoke 1: Generate basic license ==="
RESP=$(curl -fsS -X POST "$API/api/admin/license" \
  -H "X-Internal-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tier":"basic","customer_name":"Smoke Test"}')
echo "$RESP"

LICENSE_KEY=$(echo "$RESP" | jq -r '.data.license_key // empty')
if [ -z "$LICENSE_KEY" ]; then
  echo "❌ no license_key in response"
  exit 1
fi
# 校验格式 ZJ-{B|M|S|E}-{8 base32}
if ! echo "$LICENSE_KEY" | grep -qE '^ZJ-[BMSE]-[A-Z2-9]{8}$'; then
  echo "❌ license_key format invalid: $LICENSE_KEY"
  exit 1
fi
echo "✅ license_key=$LICENSE_KEY"

echo ""
echo "=== Smoke 2: Agent register success ==="
REG=$(curl -fsS -X POST "$API/api/agent/register" \
  -H "Content-Type: application/json" \
  -d "{\"license_key\":\"$LICENSE_KEY\",\"machine_id\":\"smoke-mac-001-aaaaaaaa\",\"hostname\":\"smoke-host\",\"agent_id\":\"agent-smoke-1\",\"version\":\"1.2.0\"}")
echo "$REG"

WS_TOKEN=$(echo "$REG" | jq -r '.ws_token // empty')
TIER=$(echo "$REG" | jq -r '.tier // empty')
if [ -z "$WS_TOKEN" ]; then
  echo "❌ no ws_token in register response"
  exit 1
fi
if [ "$TIER" != "basic" ]; then
  echo "❌ expected tier=basic, got $TIER"
  exit 1
fi
echo "✅ ws_token issued (len=${#WS_TOKEN}), tier=$TIER"

echo ""
echo "=== Smoke 3: Quota exceeded (basic = 1 PC, 第二台 → 403) ==="
HTTP_CODE=$(curl -s -o /tmp/license-smoke-quota.json -w "%{http_code}" \
  -X POST "$API/api/agent/register" \
  -H "Content-Type: application/json" \
  -d "{\"license_key\":\"$LICENSE_KEY\",\"machine_id\":\"smoke-mac-002-bbbbbbbb\",\"hostname\":\"smoke-host-2\",\"agent_id\":\"agent-smoke-2\",\"version\":\"1.2.0\"}")
cat /tmp/license-smoke-quota.json
echo ""
if [ "$HTTP_CODE" != "403" ]; then
  echo "❌ expected 403 (quota exceeded), got $HTTP_CODE"
  exit 1
fi
QUOTA_CODE=$(jq -r '.code // empty' /tmp/license-smoke-quota.json)
if [ "$QUOTA_CODE" != "QUOTA_EXCEEDED" ]; then
  echo "❌ expected code=QUOTA_EXCEEDED, got $QUOTA_CODE"
  exit 1
fi
echo "✅ quota check 403 + code=QUOTA_EXCEEDED"

echo ""
echo "=== Smoke 4: Invalid license rejected (401) ==="
HTTP_CODE=$(curl -s -o /tmp/license-smoke-invalid.json -w "%{http_code}" \
  -X POST "$API/api/agent/register" \
  -H "Content-Type: application/json" \
  -d '{"license_key":"ZJ-B-FAKEINVA","machine_id":"smoke-mac-003-cccccccc","hostname":"x","agent_id":"agent-x","version":"1.2.0"}')
cat /tmp/license-smoke-invalid.json
echo ""
if [ "$HTTP_CODE" != "401" ]; then
  echo "❌ expected 401 (invalid license), got $HTTP_CODE"
  exit 1
fi
INV_CODE=$(jq -r '.code // empty' /tmp/license-smoke-invalid.json)
if [ "$INV_CODE" != "INVALID_LICENSE" ]; then
  echo "❌ expected code=INVALID_LICENSE, got $INV_CODE"
  exit 1
fi
echo "✅ invalid license 401 + code=INVALID_LICENSE"

echo ""
echo "=== Smoke 5: Re-register same machine (续签，不占新名额) ==="
RE=$(curl -fsS -X POST "$API/api/agent/register" \
  -H "Content-Type: application/json" \
  -d "{\"license_key\":\"$LICENSE_KEY\",\"machine_id\":\"smoke-mac-001-aaaaaaaa\",\"hostname\":\"smoke-host\",\"agent_id\":\"agent-smoke-1\",\"version\":\"1.2.0\"}")
RE_TOKEN=$(echo "$RE" | jq -r '.ws_token // empty')
if [ -z "$RE_TOKEN" ]; then
  echo "❌ re-register existing machine failed"
  echo "$RE"
  exit 1
fi
echo "✅ re-register existing machine OK (ws_token reissued)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🎉 All license smoke tests passed (5/5)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
