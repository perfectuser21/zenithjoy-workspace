#!/usr/bin/env bash
# staff-skill-eval-smoke.sh — Staff Tools Hub + Skill Evaluator API smoke
# sprint: sprints/07090821-staff-tools-skill-eval
# task: 23b96c28-cf91-4657-bd26-46cd33837f16
set -e

API_BASE="${API_BASE:-http://localhost:3000}"
INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-}"
PASS=0
FAIL=0

check() {
  local desc="$1" expect="$2" actual="$3"
  if [ "$actual" = "$expect" ]; then
    echo "✓ $desc (got $actual)"
    PASS=$((PASS+1))
  else
    echo "✗ $desc (expected $expect, got $actual)"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Staff Tools Hub API Smoke ==="

# 1. POST /api/staff/skill-eval/upload 不带认证头 → 403
S=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API_BASE}/api/staff/skill-eval/upload")
check "POST upload 不带认证头 → 403" "403" "$S"

# 2. GET /api/staff/skill-eval/status/:jobId 不带认证头 → 403
S=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/staff/skill-eval/status/test-job-id")
check "GET status 不带认证头 → 403" "403" "$S"

# 3. STAFF_EMAILS 未配置时不带头 → 403（等价于测试1，因为没有 STAFF_EMAILS 就一定 403）
# 注：此项在有后端时验证 staffGuard 的"空白名单=拒绝"逻辑
S=$(curl -s -o /dev/null -w "%{http_code}" -H "X-User-Email: " -X POST "${API_BASE}/api/staff/skill-eval/upload")
check "POST upload 空 email 头 → 403" "403" "$S"

echo ""
echo "=== 结果 ==="
echo "PASS=$PASS FAIL=$FAIL"

[ "$FAIL" -eq 0 ] && echo "✅ 全部通过" && exit 0 || (echo "❌ 有失败项" && exit 1)
