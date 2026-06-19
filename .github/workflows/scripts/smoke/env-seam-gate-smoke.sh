#!/usr/bin/env bash
# env-seam-gate-smoke.sh
#
# env 接缝通用闸门冒烟（升级 PR #800 的完整性闸门为"全 src 扫描 + 强制分类"）。
# 治根：#800 只查 2 个手写声明文件，别处新增的 process.env.X 漏网。本闸门扫遍
# apps/api/src，每个 process.env.X 都必须归类到 REQUIRED/OPTIONAL/FRAMEWORK，否则红。
#
# 验证三件事：
#   1) build 产出 dist/env-registry.js（纯函数可被 node require）
#   2) proven-to-fire：findUnclassifiedEnv 喂 process.env.ZZ_FAKE_UNCLASSIFIED → 必报未分类
#   3) 全 src 扫描分类闸门绿（现有 env 全部已归类，基线绿）
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/apps/api"

PASS=0
FAIL=0
assert() {
  if [ "$1" = "$2" ]; then echo "  PASS: $3"; PASS=$((PASS+1));
  else echo "  FAIL: $3 (expected '$2', got '$1')"; FAIL=$((FAIL+1)); fi
}

echo "=== 0: 构建 apps/api（产出 dist/env-registry.js）==="
npm run build >/tmp/zj-envgate-build.log 2>&1 || { echo "FAIL: build 失败"; cat /tmp/zj-envgate-build.log; exit 1; }
test -f dist/env-registry.js || { echo "FAIL: dist/env-registry.js 不存在"; exit 1; }
echo "  PASS: build OK"

echo "=== 1: proven-to-fire — findUnclassifiedEnv 必须拦未分类 env ==="
GATE_FIRE=$(node -e "const m=require('./dist/env-registry.js'); const r=m.findUnclassifiedEnv('const x=process.env.ZZ_FAKE_UNCLASSIFIED;'); console.log(r.includes('ZZ_FAKE_UNCLASSIFIED'));")
assert "$GATE_FIRE" "true" "findUnclassifiedEnv 拦截 ZZ_FAKE_UNCLASSIFIED（proven-to-fire）"

echo "=== 1b: 已分类 env 不被误报 ==="
GATE_OK=$(node -e "const m=require('./dist/env-registry.js'); const r=m.findUnclassifiedEnv('process.env.TOAPI_API_KEY; process.env.NODE_ENV;'); console.log(r.length===0);")
assert "$GATE_OK" "true" "已分类 env（REQUIRED/FRAMEWORK）不被误报"

echo "=== 1c: 三个清单非空且 OPTIONAL 每条带 reason ==="
LIST_OK=$(node -e "const m=require('./dist/env-registry.js'); const okReason=m.OPTIONAL_ENV.every(o=>typeof o.reason==='string'&&o.reason.trim().length>0); console.log(m.REQUIRED_ENV.length>=3 && m.OPTIONAL_ENV.length>0 && m.FRAMEWORK_ENV.length>0 && okReason);")
assert "$LIST_OK" "true" "REQUIRED>=3 / OPTIONAL 非空且每条带 reason / FRAMEWORK 非空"

echo "=== 2: 全 src 扫描分类闸门绿（vitest env-registry.test.ts）==="
GATE_SCAN=$(npx vitest run src/__tests__/env-registry.test.ts --reporter=dot >/tmp/zj-envgate-vitest.log 2>&1 && echo PASS || echo FAIL)
if [ "$GATE_SCAN" != "PASS" ]; then echo "--- vitest 日志 ---"; tail -40 /tmp/zj-envgate-vitest.log; fi
assert "$GATE_SCAN" "PASS" "全 src 扫描分类闸门绿（现有 env 全部已归类）"

echo ""
echo "Smoke PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
