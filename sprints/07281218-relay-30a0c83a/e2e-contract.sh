#!/usr/bin/env bash
# =============================================================================
# e2e-contract.sh — Ability Acceptance API 集成合同 E2E
#
# Sprint ID: 30a0c83a-47f4-4151-9636-a8cd2b6f1d7a
# Sprint Dir: sprints/07281218-relay-30a0c83a
# 合同对应: contract-draft.md Phase B（B1-B9）
#
# 前置条件:
#   export API_BASE="http://localhost:3000"         # API 服务地址
#   export DB="postgres://user:pass@localhost/db"   # psql DSN
#   export STAFF_EMAIL="staff@test.com"             # 白名单邮箱（须在 STAFF_EMAILS env 中）
#   export TENANT_A_ID="tenant-aaa"
#   export TENANT_B_ID="tenant-bbb"
#   API 服务已运行，DB 迁移已执行，STAFF_EMAILS 含 $STAFF_EMAIL
#
# 运行: bash sprints/07281218-relay-30a0c83a/e2e-contract.sh
# =============================================================================

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"
STAFF_EMAIL="${STAFF_EMAIL:-staff@test.com}"
TENANT_A_ID="${TENANT_A_ID:-tenant-test-a}"
TENANT_B_ID="${TENANT_B_ID:-tenant-test-b}"
DB="${DB:-}"

PASS=0
FAIL=0
FIRST_RUN_ID=""

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓ PASS${NC} — $1"; ((PASS++)); }
fail() { echo -e "${RED}✗ FAIL${NC} — $1"; ((FAIL++)); }

assert_http() {
  local label="$1"
  local expected_code="$2"
  local actual_code="$3"
  if [ "$actual_code" = "$expected_code" ]; then
    pass "$label (HTTP $actual_code)"
  else
    fail "$label — 期望 HTTP $expected_code，实际 $actual_code"
  fi
}

assert_json_field() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$label (值: $actual)"
  else
    fail "$label — 期望 '$expected'，实际 '$actual'"
  fi
}

echo ""
echo "=============================================="
echo " Ability Acceptance API 集成合同 E2E"
echo " API_BASE: $API_BASE"
echo " STAFF_EMAIL: $STAFF_EMAIL"
echo "=============================================="
echo ""

# ─── B1: 无认证头访问 GET /runs → HTTP 403 ──────────────────────────────────
echo "── B1: 无认证头 → 403 ──"
HTTP_CODE=$(curl -s -o /tmp/b1.json -w "%{http_code}" \
  "${API_BASE}/api/staff/ability-acceptance/runs")
assert_http "B1 无认证头 GET /runs" "403" "$HTTP_CODE"
ERROR_CODE=$(cat /tmp/b1.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('code',''))" 2>/dev/null || echo "")
assert_json_field "B1 error.code === FORBIDDEN" "FORBIDDEN" "$ERROR_CODE"

# ─── B2: 带认证头访问 GET /versions → HTTP 200，版本非空 ──────────────────────
echo ""
echo "── B2: GET /versions → 200，版本字段非空 ──"
HTTP_CODE=$(curl -s -o /tmp/b2.json -w "%{http_code}" \
  -H "X-User-Email: ${STAFF_EMAIL}" \
  -H "X-Tenant-Id: ${TENANT_A_ID}" \
  "${API_BASE}/api/staff/ability-acceptance/versions")
assert_http "B2 GET /versions" "200" "$HTTP_CODE"
STAGING_VER=$(cat /tmp/b2.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('staging',{}).get('version',''))" 2>/dev/null || echo "")
if [ -n "$STAGING_VER" ]; then
  pass "B2 staging.version 非空 (值: $STAGING_VER)"
else
  fail "B2 staging.version 为空"
fi

# ─── B3: 首次 POST /runs → created:true + run_id UUID ────────────────────────
echo ""
echo "── B3: 首次 POST /runs → created:true ──"
HTTP_CODE=$(curl -s -o /tmp/b3.json -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-User-Email: ${STAFF_EMAIL}" \
  -H "X-Tenant-Id: ${TENANT_A_ID}" \
  -d '{"app_id":"customer_app","line_id":"line02","surface":"android","task_id":"30a0c83a","sha":"abc1234"}' \
  "${API_BASE}/api/staff/ability-acceptance/runs")
assert_http "B3 POST /runs" "200" "$HTTP_CODE"
CREATED=$(cat /tmp/b3.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d.get('data',{}).get('created','')).lower())" 2>/dev/null || echo "")
assert_json_field "B3 data.created === true" "true" "$CREATED"
FIRST_RUN_ID=$(cat /tmp/b3.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('run_id',''))" 2>/dev/null || echo "")
if echo "$FIRST_RUN_ID" | grep -qE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
  pass "B3 run_id 为 UUID 格式 ($FIRST_RUN_ID)"
else
  fail "B3 run_id 不是 UUID 格式: '$FIRST_RUN_ID'"
fi

# ─── B4: 同参数二次 POST /runs → created:false + 相同 run_id ─────────────────
echo ""
echo "── B4: 二次 POST /runs → created:false（幂等）──"
HTTP_CODE=$(curl -s -o /tmp/b4.json -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-User-Email: ${STAFF_EMAIL}" \
  -H "X-Tenant-Id: ${TENANT_A_ID}" \
  -d '{"app_id":"customer_app","line_id":"line02","surface":"android","task_id":"30a0c83a","sha":"abc1234"}' \
  "${API_BASE}/api/staff/ability-acceptance/runs")
assert_http "B4 二次 POST /runs" "200" "$HTTP_CODE"
CREATED2=$(cat /tmp/b4.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d.get('data',{}).get('created','')).lower())" 2>/dev/null || echo "")
assert_json_field "B4 data.created === false" "false" "$CREATED2"
SECOND_RUN_ID=$(cat /tmp/b4.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('run_id',''))" 2>/dev/null || echo "")
assert_json_field "B4 run_id 与第一次相同" "$FIRST_RUN_ID" "$SECOND_RUN_ID"

# ─── B5: POST /runs/:runId/devices/1/checks (result=PASS) → 200 ──────────────
echo ""
echo "── B5: POST checks (result=PASS) → 200 ──"
if [ -z "$FIRST_RUN_ID" ]; then
  fail "B5 跳过（FIRST_RUN_ID 为空，B3 失败）"
else
  HTTP_CODE=$(curl -s -o /tmp/b5.json -w "%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-User-Email: ${STAFF_EMAIL}" \
    -H "X-Tenant-Id: ${TENANT_A_ID}" \
    -d '{"template_id":"tpl-001","result":"PASS","evidence":"截图已附"}' \
    "${API_BASE}/api/staff/ability-acceptance/runs/${FIRST_RUN_ID}/devices/1/checks")
  assert_http "B5 POST /checks" "200" "$HTTP_CODE"
  SUCCESS=$(cat /tmp/b5.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d.get('success','')).lower())" 2>/dev/null || echo "")
  assert_json_field "B5 success === true" "true" "$SUCCESS"
fi

# ─── B6: POST /runs/:runId/submit → 200，status=submitted ────────────────────
echo ""
echo "── B6: POST /submit → 200，status=submitted ──"
if [ -z "$FIRST_RUN_ID" ]; then
  fail "B6 跳过（FIRST_RUN_ID 为空）"
else
  HTTP_CODE=$(curl -s -o /tmp/b6.json -w "%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-User-Email: ${STAFF_EMAIL}" \
    -H "X-Tenant-Id: ${TENANT_A_ID}" \
    "${API_BASE}/api/staff/ability-acceptance/runs/${FIRST_RUN_ID}/submit")
  assert_http "B6 POST /submit" "200" "$HTTP_CODE"
  STATUS=$(cat /tmp/b6.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('status',''))" 2>/dev/null || echo "")
  assert_json_field "B6 data.status === submitted" "submitted" "$STATUS"
fi

# ─── B7: submit 后 POST /checks → 400 RUN_ALREADY_SUBMITTED ─────────────────
echo ""
echo "── B7: submit 后再 POST checks → 400 RUN_ALREADY_SUBMITTED ──"
if [ -z "$FIRST_RUN_ID" ]; then
  fail "B7 跳过（FIRST_RUN_ID 为空）"
else
  HTTP_CODE=$(curl -s -o /tmp/b7.json -w "%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-User-Email: ${STAFF_EMAIL}" \
    -H "X-Tenant-Id: ${TENANT_A_ID}" \
    -d '{"template_id":"tpl-001","result":"FAIL"}' \
    "${API_BASE}/api/staff/ability-acceptance/runs/${FIRST_RUN_ID}/devices/1/checks")
  assert_http "B7 POST /checks after submit" "400" "$HTTP_CODE"
  ERR_CODE=$(cat /tmp/b7.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('code',''))" 2>/dev/null || echo "")
  assert_json_field "B7 error.code === RUN_ALREADY_SUBMITTED" "RUN_ALREADY_SUBMITTED" "$ERR_CODE"
fi

# ─── B8: DB 查 acceptance_run.created_by ─────────────────────────────────────
echo ""
echo "── B8: DB 查 acceptance_run.created_by ──"
if [ -z "$DB" ]; then
  echo "  SKIP: \$DB 未设置（无 psql 连接）"
elif [ -z "$FIRST_RUN_ID" ]; then
  fail "B8 跳过（FIRST_RUN_ID 为空）"
else
  CREATED_BY=$(psql "$DB" -t -c "SELECT created_by FROM acceptance_run WHERE run_id = '${FIRST_RUN_ID}';" 2>/dev/null | tr -d ' ')
  EXPECTED_EMAIL=$(echo "$STAFF_EMAIL" | tr '[:upper:]' '[:lower:]')
  ACTUAL_EMAIL=$(echo "$CREATED_BY" | tr '[:upper:]' '[:lower:]')
  assert_json_field "B8 acceptance_run.created_by === \$STAFF_EMAIL" "$EXPECTED_EMAIL" "$ACTUAL_EMAIL"
fi

# ─── B9: tenant_b 查 runs 不含 tenant_a 的 run_id ────────────────────────────
echo ""
echo "── B9: 租户隔离 — tenant_b 查不到 tenant_a 的 run ──"
if [ -z "$FIRST_RUN_ID" ]; then
  fail "B9 跳过（FIRST_RUN_ID 为空）"
else
  HTTP_CODE=$(curl -s -o /tmp/b9.json -w "%{http_code}" \
    -H "X-User-Email: ${STAFF_EMAIL}" \
    -H "X-Tenant-Id: ${TENANT_B_ID}" \
    "${API_BASE}/api/staff/ability-acceptance/runs")
  assert_http "B9 tenant_b GET /runs" "200" "$HTTP_CODE"
  # 检查响应中不含 tenant_a 的 run_id
  if cat /tmp/b9.json | grep -q "$FIRST_RUN_ID" 2>/dev/null; then
    fail "B9 租户隔离失败 — tenant_b 响应中含 tenant_a 的 run_id: $FIRST_RUN_ID"
  else
    pass "B9 租户隔离 — tenant_b 响应中不含 tenant_a 的 run_id"
  fi
fi

# ─── 汇总 ─────────────────────────────────────────────────────────────────────
echo ""
echo "=============================================="
echo " 合同 E2E 汇总"
echo " PASS: ${PASS} / FAIL: ${FAIL}"
echo "=============================================="

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}合同 E2E 未通过 — ${FAIL} 个断言失败${NC}"
  exit 1
else
  echo -e "${GREEN}合同 E2E 全部通过${NC}"
  exit 0
fi
