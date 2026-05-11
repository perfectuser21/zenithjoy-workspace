#!/usr/bin/env bash
# H-2 Bug 3 + Bug 9 hotfix smoke
# 真启 backend → curl 验证 Bug 3 mock-agent 生产可调 (token 单门禁)
# Bug 9 (Agent dual register race) 由 integration test 真验，本 smoke 仅覆盖 Bug 3 行为
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
SMOKE_TOKEN="${SMOKE_TOKEN:-smoke-secret-2026}"

echo "[h2-smoke] 验 Bug 3 — mock-agent 生产可调"
echo "[h2-smoke] api_base=$API_BASE"

# 1. 缺 X-Smoke-Token → 403
status_no_token=$(curl -sm 5 -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/_smoke/mock-agent" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"00000000-0000-0000-0000-000000000000","agent_id_text":"smoke-test"}')
echo "[h2-smoke] 缺 token → HTTP $status_no_token (expect 403)"
[ "$status_no_token" = "403" ] || { echo "[h2-smoke] FAIL: 缺 token 不是 403"; exit 1; }

# 2. 错 X-Smoke-Token → 403
status_bad=$(curl -sm 5 -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/_smoke/mock-agent" \
  -H "Content-Type: application/json" -H "X-Smoke-Token: wrong-token" \
  -d '{"tenant_id":"00000000-0000-0000-0000-000000000000","agent_id_text":"smoke-test"}')
echo "[h2-smoke] 错 token → HTTP $status_bad (expect 403)"
[ "$status_bad" = "403" ] || { echo "[h2-smoke] FAIL: 错 token 不是 403"; exit 1; }

# 3. 正确 token + 缺 body → 400 (验 token 单门禁通过到 handler)
status_400=$(curl -sm 5 -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/_smoke/mock-agent" \
  -H "Content-Type: application/json" -H "X-Smoke-Token: $SMOKE_TOKEN" \
  -d '{}')
echo "[h2-smoke] 正确 token 缺 body → HTTP $status_400 (expect 400)"
[ "$status_400" = "400" ] || { echo "[h2-smoke] FAIL: 正确 token 缺 body 不是 400 (说明 token 门禁有问题)"; exit 1; }

echo "[h2-smoke] PASS — Bug 3 mock-agent 生产可调 真生效"
