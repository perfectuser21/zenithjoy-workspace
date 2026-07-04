#!/bin/bash
# line02-dashboard-ia-redesign-smoke.sh
# Smoke test: Line02 Dashboard IA 重做 — Hub GP 顺序 + 触达记录视图
# Scenario 1-3: 源码级（source-level checks）；Scenario 4-5 需 API server
set -e

echo "=== Scenario 1: Hub MODULES 无 comingSoon，含 GP 卡片 ==="
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/pages/AcquisitionHubPage.tsx', 'utf8');
if (c.includes('comingSoon: true')) { console.error('FAIL: comingSoon 仍存在'); process.exit(1); }
['绑抖音小号','采集','看线索','触达记录'].forEach(t => {
  if (!c.includes(t)) { console.error('FAIL: 卡片缺失: ' + t); process.exit(1); }
});
console.log('OK');
"
echo "✅ Scenario 1 通过"

echo "=== Scenario 2: 账号管理页无抖音昵称列 ==="
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/pages/AcquisitionAccountsPage.tsx', 'utf8');
if (c.includes('抖音昵称')) { console.error('FAIL: 抖音昵称列头仍存在'); process.exit(1); }
if (!c.includes('machine-hostname-cell')) { console.error('FAIL: machine-hostname-cell 回归约束丢失'); process.exit(1); }
console.log('OK');
"
echo "✅ Scenario 2 通过"

echo "=== Scenario 3: navigation.config 路由注册 ==="
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts', 'utf8');
if (!c.includes('/area/acquisition/leads')) { console.error('FAIL: leads 路由未注册'); process.exit(1); }
if (!c.includes('/area/acquisition/outreach')) { console.error('FAIL: outreach 路由未注册'); process.exit(1); }
if (!c.includes('/dashboard/leads')) { console.error('FAIL: 旧 leads 路由被删'); process.exit(1); }
console.log('OK');
"
echo "✅ Scenario 3 通过"

echo "=== Scenario 4: outreach-history 端点源码检查 ==="
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/acquisition-dispatch.ts', 'utf8');
if (!c.includes('outreach-history')) { console.error('FAIL: 端点未注册'); process.exit(1); }
if (!c.includes('tenant_id')) { console.error('FAIL: 缺 tenant_id 过滤'); process.exit(1); }
if (!c.includes('items')) { console.error('FAIL: 缺 items 字段名'); process.exit(1); }
console.log('OK: 端点已注册，含租户过滤，使用 items 字段名');
"
echo "✅ Scenario 4 通过"

echo "=== Scenario 5: AcquisitionOutreachPage 存在且含空状态 ==="
node -e "
const fs = require('fs');
if (!fs.existsSync('apps/dashboard/src/pages/AcquisitionOutreachPage.tsx'))
  { console.error('FAIL: AcquisitionOutreachPage.tsx 不存在'); process.exit(1); }
const page = fs.readFileSync('apps/dashboard/src/pages/AcquisitionOutreachPage.tsx', 'utf8');
if (!page.includes('暂无触达记录')) { console.error('FAIL: 缺空状态文字'); process.exit(1); }
if (!(page.includes('catch') || page.includes('setError'))) { console.error('FAIL: 缺错误处理'); process.exit(1); }
console.log('OK');
"
echo "✅ Scenario 5 通过"

echo ""
echo "🎉 line02-dashboard-ia-redesign smoke 全部通过"
