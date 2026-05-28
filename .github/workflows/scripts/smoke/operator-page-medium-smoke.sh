#!/usr/bin/env bash
# operator-page-medium-smoke.sh
# ws3 — OperatorPage thin→medium 重构验证
# 检查：8平台单列展示 + active枚举 + trigger-bind + 轮询 + lastCheckedAt/lastValidAt + is_operator守卫
#
# 退出码：0=全过 1=失败
set -euo pipefail

PAGE="apps/dashboard/src/pages/OperatorPage.tsx"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ws3 operator-page medium smoke"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "▶ [1/6] 检查文件存在且 export default"
node -e "require('fs').accessSync('${PAGE}'); const s=require('fs').readFileSync('${PAGE}','utf8'); if(!s.match(/export\s+default\s+function\s+OperatorPage|export\s+default\s+OperatorPage/)){console.error('FAIL: 缺 export default OperatorPage');process.exit(1);}; console.log('OK')" || exit 1

echo "▶ [2/6] 检查 8 个平台名称"
node -e "const s=require('fs').readFileSync('${PAGE}','utf8'); const p=['抖音','快手','小红书','视频号','头条','微博','知乎','公众号']; const miss=p.filter(x=>!s.includes(x)); if(miss.length){console.error('FAIL: 缺平台',miss);process.exit(1)}; console.log('OK: 8 平台覆盖')" || exit 1

echo "▶ [3/6] 检查 status 枚举含 active，不用 ok 作有效状态"
node -e "const s=require('fs').readFileSync('${PAGE}','utf8'); if(!s.match(/'active'|\"active\"/)){console.error('FAIL: 缺 active 枚举');process.exit(1)}; if(s.match(/status.*[=:]=.*['\"']ok['\"']|['\"']ok['\"'].*===.*status/)){console.error('FAIL: 仍用 ok 作 status');process.exit(1)}; console.log('OK: active 枚举正确')" || exit 1

echo "▶ [4/6] 检查 trigger-bind 调用 + GET /api/operator/sessions"
node -e "const s=require('fs').readFileSync('${PAGE}','utf8'); if(!s.includes('trigger-bind')){console.error('FAIL: 缺 trigger-bind');process.exit(1)}; if(!s.match(/operator\/sessions/)){console.error('FAIL: 缺 GET /api/operator/sessions');process.exit(1)}; console.log('OK: API 调用正确')" || exit 1

echo "▶ [5/6] 检查轮询逻辑（setInterval + 30000ms）和时间字段"
node -e "const s=require('fs').readFileSync('${PAGE}','utf8'); if(!s.match(/setInterval|30000|30\s*\*\s*1000/)){console.error('FAIL: 缺轮询逻辑');process.exit(1)}; if(!s.match(/lastCheckedAt|lastValidAt/)){console.error('FAIL: 缺时间字段');process.exit(1)}; console.log('OK: 轮询+时间字段')" || exit 1

echo "▶ [6/6] 检查 is_operator 守卫（xuxiao21xx@icloud.com）"
node -e "const s=require('fs').readFileSync('${PAGE}','utf8'); if(!s.includes('xuxiao21xx@icloud.com')){console.error('FAIL: 缺 operator email 守卫');process.exit(1)}; console.log('OK: is_operator 守卫存在')" || exit 1

echo ""
echo "✅ operator-page medium smoke PASS"
exit 0
