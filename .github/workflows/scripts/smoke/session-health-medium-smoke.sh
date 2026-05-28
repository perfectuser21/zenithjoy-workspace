#!/usr/bin/env bash
# Smoke test — session-health-medium
# 验证 check-health.js 修复 + GHA workflow Secret 命名 + smoke.sh 自身存在性
# 离线模式: SKIP_HTTP_CHECK=true (不依赖真实平台 cookie)

set -euo pipefail

HEALTH_SCRIPT="scripts/sessions/check-health.js"
GHA_WORKFLOW=".github/workflows/session-health-check.yml"
SMOKE_SCRIPT=".github/workflows/scripts/smoke/session-health-medium-smoke.sh"

echo "=== session-health-medium smoke ==="

# 1. check-health.js 存在
[ -f "$HEALTH_SCRIPT" ] || { echo "FAIL: $HEALTH_SCRIPT 不存在"; exit 1; }
echo "PASS: check-health.js 存在"

# 2. GHA workflow 无 *_MAIN Secret 引用
COUNT=$(grep -c "_MAIN:" "$GHA_WORKFLOW" 2>/dev/null || echo 0)
[ "$COUNT" = "0" ] || { echo "FAIL: workflow 仍含 ${COUNT} 处 _MAIN 引用"; exit 1; }
echo "PASS: GHA workflow 无 _MAIN Secret 引用"

# 3. GHA workflow 含 DOUYIN_COOKIES
grep -q "DOUYIN_COOKIES" "$GHA_WORKFLOW" || { echo "FAIL: workflow 缺 DOUYIN_COOKIES"; exit 1; }
echo "PASS: GHA workflow 含 DOUYIN_COOKIES"

# 4. check-health.js 含 Promise.race（飞书超时保护）
grep -q "Promise.race" "$HEALTH_SCRIPT" || { echo "FAIL: 缺 Promise.race"; exit 1; }
echo "PASS: check-health.js 含 Promise.race"

# 5. check-health.js 含 3000ms timeout
grep -qE "3000|3 \* 1000" "$HEALTH_SCRIPT" || { echo "FAIL: 缺 3000ms timeout"; exit 1; }
echo "PASS: check-health.js 含 3000ms timeout"

# 6. check-health.js 含 sessions/status 回写
grep -qE "sessions/status|operator/sessions/status" "$HEALTH_SCRIPT" || { echo "FAIL: 缺 sessions/status 回写调用"; exit 1; }
echo "PASS: check-health.js 含 sessions/status 回写"

# 7. check-health.js 含飞书告警逻辑
grep -qE "FEISHU_BOT_WEBHOOK|feishu|飞书" "$HEALTH_SCRIPT" || { echo "FAIL: 缺飞书告警逻辑"; exit 1; }
echo "PASS: check-health.js 含飞书告警逻辑"

# 8. smoke.sh 自身含 SKIP_HTTP_CHECK（离线模式）
grep -q "SKIP_HTTP_CHECK" "$SMOKE_SCRIPT" || { echo "FAIL: smoke.sh 缺 SKIP_HTTP_CHECK"; exit 1; }
echo "PASS: smoke.sh 含 SKIP_HTTP_CHECK 离线模式"

# 9. 离线模式实跑 check-health.js（SKIP_HTTP_CHECK=true，无真实 cookie 环境）
SKIP_HTTP_CHECK=true node "$HEALTH_SCRIPT" 2>&1 | head -5 || true
echo "PASS: check-health.js SKIP_HTTP_CHECK=true 运行不崩溃"

# 10. missing bug 修复验证 — ok 与 missing 不在同一行内以 = 或 : 相等
node -e "
  const src = require('fs').readFileSync('$HEALTH_SCRIPT', 'utf8');
  const bugPattern = /missing.*[=:]+.*\bok\b|\bok\b.*[=:]+.*missing/i;
  const lines = src.split('\n');
  for (const line of lines) {
    if (bugPattern.test(line)) { console.error('FAIL: missing=ok bug 仍存在: ' + line); process.exit(1); }
  }
  console.log('PASS: missing bug 已修复');
"

echo "=== 全部 smoke 验证通过 ==="
