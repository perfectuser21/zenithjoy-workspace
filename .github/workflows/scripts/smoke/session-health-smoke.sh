#!/usr/bin/env bash
# session-health-smoke.sh — Session 健康检查 smoke 验证脚本
# 离线模式（SKIP_HTTP_CHECK=true）：跳过所有网络请求，仅验证脚本输出结构

set -euo pipefail

echo "=== Session Health Smoke ==="
echo "SKIP_HTTP_CHECK=${SKIP_HTTP_CHECK:-false}"

# 以离线模式运行 check-health.js，跳过实际 HTTP 请求
SKIP_HTTP_CHECK=true node scripts/sessions/check-health.js 2>&1

REPORT="session-health-report.json"

# 验证报告文件存在
if [ ! -f "$REPORT" ]; then
  echo "FAIL: $REPORT 不存在"
  exit 1
fi

echo "--- 验证 JSON 结构 ---"

# 验证是 array 且 length = 35
node -e "
const d = JSON.parse(require('fs').readFileSync('$REPORT', 'utf8'));
if (!Array.isArray(d)) { console.error('FAIL: 不是 JSON array'); process.exit(1); }
if (d.length !== 35) { console.error('FAIL: length=' + d.length + ' 期望 35'); process.exit(1); }
console.log('OK: JSON array length=' + d.length);
"

# 验证每条目 keys 完全等于 PRD 规范
node -e "
const d = JSON.parse(require('fs').readFileSync('$REPORT', 'utf8'));
const expected = JSON.stringify(['checkedAt','expiresAt','platform','secretEnv','status']);
const fail = d.find((item, i) => {
  const actual = JSON.stringify(Object.keys(item).sort());
  if (actual !== expected) { console.error('FAIL item[' + i + ']: keys=' + actual); return true; }
});
if (fail) process.exit(1);
console.log('OK: all item keys match PRD schema');
"

# 验证 status 枚举值合法
node -e "
const d = JSON.parse(require('fs').readFileSync('$REPORT', 'utf8'));
const allowed = new Set(['ok','expired','invalid','missing']);
const bad = d.filter(item => !allowed.has(item.status));
if (bad.length > 0) { console.error('FAIL: illegal status values', bad.map(x => x.status)); process.exit(1); }
console.log('OK: all status values valid');
"

echo "=== Smoke PASSED ==="
exit 0
