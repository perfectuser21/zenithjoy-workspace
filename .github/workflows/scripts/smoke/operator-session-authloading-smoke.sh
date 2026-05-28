#!/usr/bin/env bash
# Smoke test — operator-session-authloading
# 验证 OperatorPage authLoading guard + Session 健康页面关键文件存在性

set -euo pipefail

OPERATOR_PAGE="apps/dashboard/src/pages/OperatorPage.tsx"
SPEC_FILE="apps/dashboard/e2e/operator-sessions.spec.ts"
HEALTH_SCRIPT="scripts/sessions/check-health.js"
GHA_WORKFLOW=".github/workflows/session-health-check.yml"
E2E_SCRIPT="sprints/line00-session-health-medium/e2e-verify.ps1"

echo "=== operator-session-authloading smoke ==="

# 1. OperatorPage.tsx 存在
[ -f "$OPERATOR_PAGE" ] || { echo "FAIL: $OPERATOR_PAGE 不存在"; exit 1; }
echo "PASS: OperatorPage.tsx 存在"

# 2. OperatorPage 含 authLoading（auth race-condition 修复）
grep -q "authLoading" "$OPERATOR_PAGE" || { echo "FAIL: OperatorPage 缺 authLoading guard"; exit 1; }
echo "PASS: OperatorPage 含 authLoading guard"

# 3. OperatorPage useEffect deps 含 authLoading
grep -q "\[authLoading" "$OPERATOR_PAGE" || { echo "FAIL: useEffect deps 缺 authLoading"; exit 1; }
echo "PASS: useEffect deps 含 authLoading"

# 4. OperatorPage 含 8 平台中文标签
node -e "
  const src = require('fs').readFileSync('$OPERATOR_PAGE', 'utf8');
  const platforms = ['抖音','快手','小红书','视频号','头条','微博','知乎','公众号'];
  const missing = platforms.filter(p => !src.includes(p));
  if (missing.length > 0) { console.error('FAIL: OperatorPage 缺平台:', missing.join(',')); process.exit(1); }
  console.log('PASS: OperatorPage 含全部 8 平台标签');
"

# 5. E2E spec 文件存在
[ -f "$SPEC_FILE" ] || { echo "FAIL: $SPEC_FILE 不存在"; exit 1; }
echo "PASS: operator-sessions.spec.ts 存在"

# 6. E2E spec 含 4 个 test 场景
COUNT=$(grep -c "^test(" "$SPEC_FILE" 2>/dev/null || echo 0)
[ "$COUNT" -ge 4 ] || { echo "FAIL: E2E spec 只含 ${COUNT} 个 test，需 >=4"; exit 1; }
echo "PASS: E2E spec 含 ${COUNT} 个 test 场景"

# 7. check-health.js 存在
[ -f "$HEALTH_SCRIPT" ] || { echo "FAIL: $HEALTH_SCRIPT 不存在"; exit 1; }
echo "PASS: check-health.js 存在"

# 8. session-health-check.yml workflow 存在
[ -f "$GHA_WORKFLOW" ] || { echo "FAIL: $GHA_WORKFLOW 不存在"; exit 1; }
echo "PASS: session-health-check.yml 存在"

# 9. E2E verify 脚本存在（Final E2E 入口）
[ -f "$E2E_SCRIPT" ] || { echo "FAIL: $E2E_SCRIPT 不存在"; exit 1; }
echo "PASS: e2e-verify.ps1 存在"

# 10. E2E verify 脚本含 node 命令（非 Playwright 纯 Node.js 检查）
grep -q "node " "$E2E_SCRIPT" || { echo "FAIL: e2e-verify.ps1 缺 node 命令"; exit 1; }
echo "PASS: e2e-verify.ps1 含 node 验证命令"

echo "=== 全部 smoke 验证通过 ==="
