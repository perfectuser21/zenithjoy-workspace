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

echo "=== Scenario 5: 组件测试真跑一遍（源码断言防不住行为回归） ==="
( cd apps/dashboard && npx vitest run src/components/DispatchJobDialog.test.tsx --reporter=dot )
echo "✅ Scenario 5 通过"

echo ""
echo "✅ dispatch-two-step smoke 全绿（先选活 → 才进入这件活的输入窗口）"
