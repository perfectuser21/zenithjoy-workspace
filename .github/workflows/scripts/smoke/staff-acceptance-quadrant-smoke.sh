#!/usr/bin/env bash
# staff-acceptance-quadrant smoke —— W4 四象限合看页 + 建单页 + lib.mjs 只读模式
#
# 验证：
#   1. 新增页面组件文件存在（QuadrantPage / NewRunPage）
#   2. App.tsx 路由已注册两条新路由
#   3. lib.mjs generate 产出 HTML 满足只读规范（无 <select>，无旧措辞）
#   4. TypeScript 编译通过（apps/staff-hub）
set -euo pipefail

echo "== staff-acceptance-quadrant smoke =="

# ── 1. 新增文件存在断言 ──────────────────────────────────────────────────────
test -f apps/staff-hub/src/pages/QuadrantPage.tsx         || { echo "FAIL: QuadrantPage.tsx 缺失"; exit 1; }
test -f apps/staff-hub/src/pages/NewRunPage.tsx           || { echo "FAIL: NewRunPage.tsx 缺失"; exit 1; }
test -f apps/staff-hub/src/pages/AcceptanceDetailPage.tsx || { echo "FAIL: AcceptanceDetailPage.tsx 缺失"; exit 1; }
test -f scripts/acceptance-spec/lib.mjs                   || { echo "FAIL: lib.mjs 缺失"; exit 1; }
echo "   文件存在: PASS"

# ── 2. 路由已注册 ───────────────────────────────────────────────────────────
grep -q "quadrant" apps/staff-hub/src/App.tsx || { echo "FAIL: App.tsx 缺少 quadrant 路由"; exit 1; }
grep -q "acceptance/new\|/acceptance/new" apps/staff-hub/src/App.tsx || { echo "FAIL: App.tsx 缺少 /acceptance/new 路由"; exit 1; }
echo "   路由注册: PASS"

# ── 3. lib.mjs generate 只读规范 ────────────────────────────────────────────
SPEC_FILE="acceptance-spec/line02-android.yaml"
if [ -f "$SPEC_FILE" ]; then
  node scripts/acceptance-spec/cli.mjs generate > /tmp/acceptance-quadrant-smoke-gen.html 2>&1 || \
    { echo "FAIL: cli.mjs generate 报错"; cat /tmp/acceptance-quadrant-smoke-gen.html; exit 1; }

  node -e "
    const fs = require('fs');
    const html = fs.readFileSync('/tmp/acceptance-quadrant-smoke-gen.html', 'utf8');
    const hasSelect = /<select/i.test(html);
    const hasOldText = /暂时无法验证/.test(html);
    const hasEnglish = /Staff Hub/.test(html);
    if (hasSelect)   { console.error('FAIL: 生成 HTML 含 <select> 填写控件'); process.exit(1); }
    if (hasOldText)  { console.error('FAIL: 生成 HTML 含旧措辞「暂时无法验证」'); process.exit(1); }
    if (hasEnglish)  { console.error('FAIL: 生成 HTML 含英文残留「Staff Hub」'); process.exit(1); }
    console.log('   lib.mjs generate 只读规范: PASS');
  "
else
  echo "   SKIP: $SPEC_FILE 不在当前环境，跳过 generate 检查"
fi

# ── 4. TypeScript 编译通过 ───────────────────────────────────────────────────
cd apps/staff-hub
npm run typecheck 2>&1 | tail -5 && echo "   TypeScript 编译: PASS"
cd ../..

echo "staff-acceptance-quadrant smoke: PASS"
