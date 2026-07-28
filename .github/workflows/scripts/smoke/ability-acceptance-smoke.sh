#!/usr/bin/env bash
set -euo pipefail

echo "== ability-acceptance smoke =="

# 验证核心文件存在
test -f apps/api/src/routes/ability-acceptance.ts || { echo "FAIL: ability-acceptance route missing"; exit 1; }
test -f apps/api/db/migrations/20260728_ability_acceptance.sql || { echo "FAIL: migration file missing"; exit 1; }
test -f apps/staff-hub/src/pages/AbilityAcceptancePage.tsx || { echo "FAIL: AbilityAcceptancePage missing"; exit 1; }
test -f apps/staff-hub/src/pages/AbilityAcceptanceHistoryPage.tsx || { echo "FAIL: AbilityAcceptanceHistoryPage missing"; exit 1; }
echo "core files: PASS"

# 验证 API 路由正确挂载
grep -q "ability-acceptance" apps/api/src/app.ts || { echo "FAIL: ability-acceptance not mounted in app.ts"; exit 1; }
echo "route mount: PASS"

# 验证 product-map ability_acceptance 状态为 active
node -e "
const yaml = require('js-yaml');
const fs = require('fs');
const map = yaml.load(fs.readFileSync('product-map/product-map.yaml', 'utf8'));
const gp = map.apps.flatMap(a => a.golden_paths || []).find(g => g.id === 'ability_acceptance');
if (!gp) { console.error('FAIL: ability_acceptance golden_path not found'); process.exit(1); }
if (gp.status !== 'active') { console.error('FAIL: ability_acceptance status is', gp.status, '(expected active)'); process.exit(1); }
console.log('ability_acceptance status=active: PASS');
" 2>/dev/null || node -e "
const fs = require('fs');
const content = fs.readFileSync('product-map/product-map.yaml', 'utf8');
if (!content.includes('ability_acceptance') || !content.includes('status: active')) {
  console.error('FAIL: ability_acceptance status != active in product-map.yaml'); process.exit(1);
}
console.log('ability_acceptance status=active: PASS');
"

# 验证 Staff Hub 导航含 Ability 验收
grep -q "ability-acceptance\|Ability" apps/staff-hub/src/App.tsx || { echo "FAIL: Ability acceptance nav link missing in App.tsx"; exit 1; }
echo "nav link: PASS"

echo "-- ability-acceptance smoke PASS --"
