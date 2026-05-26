#!/usr/bin/env bash
# operator-page-smoke.sh
# ws3 — OperatorPage.tsx 文件结构验证（8×4 状态矩阵 + is_operator 守卫 + /operator 路由）
#
# 退出码：0=全过 1=文件缺失 2=内容不符
set -uo pipefail

PAGE="apps/dashboard/src/pages/OperatorPage.tsx"
NAV="apps/dashboard/src/config/navigation.config.ts"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ws3 operator-page smoke"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "▶ [1/4] 检查 OperatorPage.tsx 文件存在"
node -e "require('fs').accessSync('${PAGE}'); console.log('OK: 文件存在')" || { echo "FAIL: 文件不存在"; exit 1; }

echo "▶ [2/4] 检查 8 个平台名称"
node -e "const s=require('fs').readFileSync('${PAGE}','utf8'); const p=['抖音','快手','小红书','视频号','头条','微博','知乎','公众号']; const miss=p.filter(x=>!s.includes(x)); if(miss.length){console.error('FAIL: 缺平台',miss);process.exit(1)}; console.log('OK: 8 平台覆盖')" || exit 2

echo "▶ [3/4] 检查 4 账号类型 + is_operator 守卫 + export default"
node -e "const s=require('fs').readFileSync('${PAGE}','utf8'); ['MAIN','SUB_1','SUB_2','SUB_3'].forEach(a=>{if(!s.includes(a)){console.error('FAIL: 缺账号类型',a);process.exit(1)}}); if(!s.match(/is_operator|isOperator|xuxiao21xx/)){console.error('FAIL: 无 is_operator 守卫');process.exit(1)}; if(!s.match(/export\s+default\s+/)){console.error('FAIL: 无 export default');process.exit(1)}; if(!s.match(/立即同步/)){console.error('FAIL: 无立即同步按钮');process.exit(1)}; console.log('OK: 账号类型+守卫+export+按钮')" || exit 2

echo "▶ [4/4] 检查 /operator 路由注册"
node -e "const s=require('fs').readFileSync('${NAV}','utf8'); if(!s.match(/\/operator|'operator'|\"operator\"/)){console.error('FAIL: 未注册 /operator 路由');process.exit(1)}; console.log('OK: /operator 路由已注册')" || exit 2

echo ""
echo "✅ operator-page smoke PASS"
exit 0
