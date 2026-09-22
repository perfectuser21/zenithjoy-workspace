#!/bin/bash
# dispatch-two-step-smoke.sh
# 派活面板两步式（decision c4f24a3d）
#
# 主理人原话：「所有的任务都挤到一起，都是一个面。你其实应该是让我选择，
# 比如说我到底是哪一种任务，**然后才进入它的输入窗口**。」
#
# 守的就是"别再退回一个面"。源码级断言 + 真跑组件测试两道。
set -e

F=apps/dashboard/src/components/DispatchJobDialog.tsx

echo "=== Scenario 1: 存在两步状态，且由「选没选活」决定 ==="
node -e "
const c = require('fs').readFileSync('$F', 'utf8');
if (!/const step:\s*'pick'\s*\|\s*'fill'/.test(c)) { console.error('FAIL: 两步状态没了——面板回到单页展开式'); process.exit(1); }
if (!/=\s*job\s*\?\s*'fill'\s*:\s*'pick'/.test(c)) { console.error('FAIL: 步骤不再由「选没选活」决定'); process.exit(1); }
console.log('OK');
"
echo "✅ Scenario 1 通过"

echo "=== Scenario 2: 第一步不渲染输入区，第二步不渲染活列表 ==="
node -e "
const c = require('fs').readFileSync('$F', 'utf8');
// 输入区（字段+时间窗口+派下去）必须挂在 step==='fill' 下
if (!/\{step === 'fill' && job && \(/.test(c)) { console.error('FAIL: 输入区没有挂在第二步上'); process.exit(1); }
// 活列表与设备/部门下拉必须挂在 step==='pick' 下
const pickGuards = (c.match(/\{step === 'pick' && \(/g) || []).length;
if (pickGuards < 2) { console.error('FAIL: 选择区没有挂在第一步上（设备部门下拉 + 活列表两处）'); process.exit(1); }
console.log('OK');
"
echo "✅ Scenario 2 通过"

echo "=== Scenario 3: 第二步有返回、有只读上下文，且提交中禁用返回 ==="
node -e "
const c = require('fs').readFileSync('$F', 'utf8');
if (!c.includes('backToPick')) { console.error('FAIL: 没有返回第一步的路径'); process.exit(1); }
if (!c.includes('dispatch-context')) { console.error('FAIL: 第二步缺只读上下文（派给谁）'); process.exit(1); }
const backBtn = c.slice(c.indexOf('onClick={backToPick}'), c.indexOf('onClick={backToPick}') + 260);
if (!/disabled=\{busy\}/.test(backBtn)) { console.error('FAIL: 提交中返回键未禁用'); process.exit(1); }
if (!/aria-label=\"返回\"/.test(backBtn)) { console.error('FAIL: 返回键没有可访问名，测试与读屏都点不到'); process.exit(1); }
console.log('OK');
"
echo "✅ Scenario 3 通过"

echo "=== Scenario 4: 已填的值按活分别存（返回重选不串味） ==="
node -e "
const c = require('fs').readFileSync('$F', 'utf8');
if (!c.includes('valuesByJob')) { console.error('FAIL: 值不再按活分别存——返回后重选会丢值或串味'); process.exit(1); }
if (!/all\[j\.id\] \? all :/.test(c)) { console.error('FAIL: 重选同一件活会被重置成默认值'); process.exit(1); }
console.log('OK');
"
echo "✅ Scenario 4 通过"

# Scenario 5: 行为回归。
#
# 源码级断言防不住"把判断挪个位置"，所以行为必须真跑一遍。但**这里不是它该跑的地方**：
# Smoke Glob Runner 这个 job 不装 apps/dashboard 的依赖（lucide-react / react-router-dom
# 都解析不到，同 job 里别的 dashboard smoke 也是这个原因只做源码级检查）。
#
# 真正守行为的是 apps/dashboard 的 vitest job 里的 DispatchJobDialog.test.tsx（27 条，
# 含"第一步看不见输入框""返回后重选同一件活保留值""提交中返回键禁用"）。
# 那条 job 装依赖、会跑、会红——不是没人守，是守在对的地方。
#
# 本地跑本脚本时依赖通常是装好的，那就顺手真跑一遍；装不了就明说由谁守，不静默跳过。
echo "=== Scenario 5: 行为回归 ==="
# 让 node 自己去解析，别猜 node_modules 布局：这个 monorepo 把 lucide-react
# hoist 到了根，写死 apps/dashboard/node_modules/... 会让"真跑"那条分支变成死代码。
if ( cd apps/dashboard && node -e "require.resolve('lucide-react')" ) >/dev/null 2>&1; then
  ( cd apps/dashboard && npx vitest run src/components/DispatchJobDialog.test.tsx --reporter=dot )
  echo "✅ Scenario 5 通过（本地真跑）"
else
  echo "   本 job 未装 dashboard 依赖 → 行为回归由 apps/dashboard vitest job 的"
  echo "   DispatchJobDialog.test.tsx 守（27 条）。此处只做源码级断言。"
  # 守卫的守卫：那个测试文件必须还在，且还在断言两步式的关键行为
  node -e "
  const t = require('fs').readFileSync('apps/dashboard/src/components/DispatchJobDialog.test.tsx', 'utf8');
  for (const must of ['第一步只让选，看不到任何输入框', '返回后重新点同一件活', '提交中返回键禁用']) {
    if (!t.includes(must)) { console.error('FAIL: 行为用例被删了: ' + must); process.exit(1); }
  }
  console.log('OK');
  "
  echo "✅ Scenario 5 通过（行为用例在位）"
fi

echo ""
echo "✅ dispatch-two-step smoke 全绿（先选活 → 才进入这件活的输入窗口）"
