#!/usr/bin/env bash
# golden-path-f1-anchor-smoke.sh — GP锚定闭环 变异测试（刀1+刀2累积）
#
# 范围（按刀累积追加，不新起平行文件）：
# 刀1（零网络零DB）：
#   ① schema校验逻辑对格式错误正确判红
#   ② smoke_files存在性/非空占位校验正确触发
#   ③ gp_anchor_enforcement自身注册数据正确
# 刀2（新增）：
#   ④ lint-gp-anchor.sh 对非法/合法GP-Anchor声明正确判红/判绿
# 不测 Brain API 400（刀4）——依赖的交付物此刻还不存在。刀4落地时应往本文件
# 追加断言，而非另起新文件。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

# smoke-glob-runner job 只跑 `npm ci --workspace=apps/api`，不装根 package.json 的
# ajv/yaml（lib.mjs 依赖）。自愈式装依赖，与仓库既有 smoke 脚本（如
# dev-quick-verify-smoke.sh）"现场重建"惯例一致，不改动共享 CI workflow 文件。
if ! node -e "require.resolve('ajv')" >/dev/null 2>&1; then
  echo "[setup] 根依赖(ajv/yaml)未装，现场跑 npm ci"
  npm ci --no-audit --no-fund >/dev/null 2>&1
fi

FAIL=0

echo "=== ① schema校验：格式错误必须判红 ==="
node --input-type=module -e "
import { validateSchema } from '$REPO_ROOT/scripts/product-map/lib.mjs';
const { errors } = validateSchema({ surfaces: ['web'], editions: ['wecom'], golden_paths: [] });
if (errors.length === 0) { console.error('FAIL: 缺apps字段的畸形输入应报错，实际无错误'); process.exit(1); }
console.log('PASS: 畸形输入被正确判红');
" || FAIL=1

echo "=== ② smoke_files存在性/非空校验：必须正确触发 ==="
node --input-type=module -e "
import { validateSmokeFiles } from '$REPO_ROOT/scripts/product-map/lib.mjs';

// 负向1：路径不存在
const r1 = validateSmokeFiles({ golden_paths: [{ id: 'test_gp', smoke_files: ['.github/workflows/scripts/smoke/nonexistent-fake.sh'] }] }, '$REPO_ROOT');
if (r1.ok || !r1.errors.some(e => e.includes('nonexistent-fake.sh'))) {
  console.error('FAIL: 缺失路径未被正确识别');
  process.exit(1);
}
console.log('PASS: 缺失smoke_files路径被正确判红');

// 正向：当前product-map.yaml里已注册的smoke_files全部存在且非空
import { loadAndValidateProductMap } from '$REPO_ROOT/scripts/product-map/lib.mjs';
const { map, errors } = await loadAndValidateProductMap();
if (errors.length > 0) { console.error('FAIL: product-map.yaml本身有schema错误', errors); process.exit(1); }
const r2 = validateSmokeFiles(map, '$REPO_ROOT');
if (!r2.ok) { console.error('FAIL: 已注册smoke_files未全部通过校验', r2.errors); process.exit(1); }
console.log('PASS: 已注册smoke_files全部存在且非空占位');
" || FAIL=1

echo "=== ③ gp_anchor_enforcement自身注册数据正确 ==="
node --input-type=module -e "
import { loadAndValidateProductMap } from '$REPO_ROOT/scripts/product-map/lib.mjs';
const { map } = await loadAndValidateProductMap();
const gp = map.golden_paths.find(g => g.id === 'gp_anchor_enforcement');
if (!gp) { console.error('FAIL: gp_anchor_enforcement未注册'); process.exit(1); }
const VALID_STATUSES = ['proposed', 'active'];
if (!VALID_STATUSES.includes(gp.status)) { console.error('FAIL: status应为proposed或active，实际:', gp.status); process.exit(1); }
if (!gp.smoke_files || !gp.smoke_files.includes('.github/workflows/scripts/smoke/golden-path-f1-anchor-smoke.sh')) {
  console.error('FAIL: smoke_files未正确指向自身'); process.exit(1);
}
console.log('PASS: gp_anchor_enforcement注册数据正确');
" || FAIL=1

echo "=== ④ lint-gp-anchor.sh：非法/合法GP-Anchor声明正确判红/判绿 ==="
LINT="$REPO_ROOT/.github/workflows/scripts/lint-gp-anchor.sh"

# 负向：无声明
if PR_BODY="" bash "$LINT" origin/main >/tmp/f1-lint-check.log 2>&1; then
  echo "FAIL: 空PR body应判红，实际判绿"; FAIL=1
elif ! grep -q "GP-ANCHOR-MISSING" /tmp/f1-lint-check.log; then
  echo "FAIL: 空PR body错误信息缺GP-ANCHOR-MISSING"; FAIL=1
else
  echo "PASS: 空PR body正确判红"
fi

# 负向：id不存在
if PR_BODY="GP-Anchor: line99/nonexistent_gp#step1" bash "$LINT" origin/main >/tmp/f1-lint-check.log 2>&1; then
  echo "FAIL: 不存在的id应判红，实际判绿"; FAIL=1
elif ! grep -q "GP-ANCHOR-ID-NOTFOUND" /tmp/f1-lint-check.log; then
  echo "FAIL: 不存在id的错误信息缺GP-ANCHOR-ID-NOTFOUND"; FAIL=1
else
  echo "PASS: 不存在的id正确判红"
fi

# 正向：keep-green合法声明
if ! PR_BODY="GP-Anchor: line01/customer_first_success keep-green" bash "$LINT" origin/main >/tmp/f1-lint-check.log 2>&1; then
  echo "FAIL: 合法keep-green声明应判绿，实际判红"; cat /tmp/f1-lint-check.log; FAIL=1
else
  echo "PASS: 合法keep-green声明正确判绿"
fi

if [ "$FAIL" -ne 0 ]; then
  echo "❌ golden-path-f1-anchor-smoke.sh 未通过"
  exit 1
fi

echo "✅ golden-path-f1-anchor-smoke.sh 全部通过"
