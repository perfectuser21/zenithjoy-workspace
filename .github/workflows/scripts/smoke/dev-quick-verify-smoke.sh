#!/usr/bin/env bash
# dev-quick-verify-smoke.sh — T1 RPA 开发快验通道（agent execFile channel）环境接缝守卫
#
# dist/ 是 gitignore 构建产物，本 smoke 现场 build 后做静态校验，证明编译产物含真实接线：
#   1. dist/handlers/dev-quick-verify.js 存在且含白名单红线（DEV_VERIFY_WHITELIST）
#   2. dist/handlers/dev-quick-verify.js 含研发机闸（ZENITHJOY_DEV_MACHINE）
#   3. dist/index.js 含 dev_quick_verify 消息分发接线（防 handler 写了没接=死代码）
#   4. 白名单不含任意命令执行动作（shell/exec/eval/run_script 红线）

set -euo pipefail

AGENT_DIR="services/agent"
DIST_HANDLER="$AGENT_DIR/dist/handlers/dev-quick-verify.js"
DIST_INDEX="$AGENT_DIR/dist/index.js"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  dev-quick-verify smoke"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "[1] 构建 Agent dist（gitignore 产物，现场重建）"
( cd "$AGENT_DIR" && npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1 )
( cd "$AGENT_DIR" && npm run build >/dev/null 2>&1 )
[ -f "$DIST_HANDLER" ] || { echo "FAIL: build 后 $DIST_HANDLER 不存在"; exit 1; }
echo "  ✅ PASS (dist 编译成功)"

echo "[2] handler 含白名单红线 + 研发机闸"
grep -q "DEV_VERIFY_WHITELIST" "$DIST_HANDLER" || { echo "FAIL: 白名单缺失"; exit 1; }
grep -q "ZENITHJOY_DEV_MACHINE" "$DIST_HANDLER" || { echo "FAIL: 研发机闸缺失"; exit 1; }
echo "  ✅ PASS"

echo "[3] index.js 含 dev_quick_verify 消息分发接线"
grep -q "dev_quick_verify" "$DIST_INDEX" || { echo "FAIL: index 未接线 dev_quick_verify（handler 是死代码）"; exit 1; }
echo "  ✅ PASS"

echo "[4] 白名单无任意命令执行动作"
for bad in "'shell'" "'exec'" "'eval'" "'run_script'"; do
  if grep -o "DEV_VERIFY_WHITELIST[^;]*" "$AGENT_DIR/src/handlers/dev-quick-verify.ts" | grep -q "$bad"; then
    echo "FAIL: 白名单含禁止动作 $bad"; exit 1
  fi
done
echo "  ✅ PASS"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  dev-quick-verify smoke: ALL PASS"
