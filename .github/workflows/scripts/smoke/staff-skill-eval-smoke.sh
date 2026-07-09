#!/usr/bin/env bash
# staff-skill-eval-smoke.sh — Staff Tools Hub + Skill Evaluator API smoke
# sprint: sprints/07090821-staff-tools-skill-eval
# task: 23b96c28-cf91-4657-bd26-46cd33837f16
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"
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

# glob-runner 跑到本脚本时已是长跑窗口后段（同批 sse-smoke.sh 等既存 debt 脚本
# 同一时刻同样报连接失败 000，属已知系统性 flakiness）；起手先等 API 活过来，
# 避免瞬时不可达被 set -e 直接 abort 整个脚本、吞掉真实 PASS/FAIL 结果
ALIVE=0
for i in $(seq 1 10); do
  if curl -fs -o /dev/null "${API_BASE}/health" 2>/dev/null; then
    ALIVE=1
    break
  fi
  sleep 1
done
if [ "$ALIVE" -eq 0 ]; then
  echo "⚠️ ${API_BASE}/health 10s 内未恢复，以下检查按连接失败(000)计入 FAIL（而非静默中断整个脚本）"
fi

# 1. POST /api/staff/skill-eval/upload 不带认证头 → 403
S=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API_BASE}/api/staff/skill-eval/upload" 2>/dev/null || echo "000")
check "POST upload 不带认证头 → 403" "403" "$S"

# 2. GET /api/staff/skill-eval/status/:jobId 不带认证头 → 403
S=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/staff/skill-eval/status/test-job-id" 2>/dev/null || echo "000")
check "GET status 不带认证头 → 403" "403" "$S"

# 3. STAFF_EMAILS 未配置时不带头 → 403（等价于测试1，因为没有 STAFF_EMAILS 就一定 403）
# 注：此项在有后端时验证 staffGuard 的"空白名单=拒绝"逻辑
S=$(curl -s -o /dev/null -w "%{http_code}" -H "X-User-Email: " -X POST "${API_BASE}/api/staff/skill-eval/upload" 2>/dev/null || echo "000")
check "POST upload 空 email 头 → 403" "403" "$S"

echo ""
echo "=== 结果 ==="
echo "PASS=$PASS FAIL=$FAIL"

if [ "$FAIL" -eq 0 ]; then
  echo "✅ 全部通过"
  exit 0
else
  echo "❌ 有失败项"
  exit 1
fi
