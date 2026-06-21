#!/usr/bin/env bash
# offscreen-version-gate-smoke.sh
# Sprint cp-06190205 — OFFSCREEN_X 几何推导 + 静默自检 + line04 模块版本 1.0.47 一致性 smoke
#
# 验证链路（不依赖运行中的服务，纯仓内一致性 + 推导逻辑真链路）：
#   1. node 解析 services/agent/modules/line04/manifest.json → version == EXPECTED
#   2. node 解析 services/agent/build-modules/line04/manifest.json → version == EXPECTED（打包真源）
#   3. grep apps/api/src 的 HEARTBEAT_MODULES line04-wechat-cs required_version == EXPECTED
#      （这是本 feat 改的 apps/*/src 文件，心跳下发该版本，旧客户端据此自动更新）
#   4. python3 真跑 config.compute_offscreen_x：mock 虚拟屏 vleft=0 vw=2560 → 必得 -1400（几何推导，不写死）
#
# 退出码：0 全过 / 2 modules manifest / 3 build-modules manifest / 4 service required_version / 5 推导逻辑
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
EXPECTED="1.0.47"
echo "offscreen-version-gate-smoke: 期望 line04 版本 = $EXPECTED (repo=$REPO_ROOT)"

command -v node >/dev/null 2>&1   || { echo "FAIL: 缺 node"; exit 6; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: 缺 python3"; exit 6; }

MOD_MANIFEST="$REPO_ROOT/services/agent/modules/line04/manifest.json"
V1=$(node -e "process.stdout.write(require('$MOD_MANIFEST').version)")
[ "$V1" = "$EXPECTED" ] || { echo "FAIL: modules/line04 manifest version=$V1 != $EXPECTED"; exit 2; }
echo "  OK: modules/line04 manifest = $V1"

BUILD_MANIFEST="$REPO_ROOT/services/agent/build-modules/line04/manifest.json"
V2=$(node -e "process.stdout.write(require('$BUILD_MANIFEST').version)")
[ "$V2" = "$EXPECTED" ] || { echo "FAIL: build-modules/line04 manifest version=$V2 != $EXPECTED"; exit 3; }
echo "  OK: build-modules/line04 manifest = $V2"

SVC="$REPO_ROOT/apps/api/src/services/walking-skeleton.service.ts"
grep -qE "'line04-wechat-cs': \{ status: 'active', required_version: '$EXPECTED' \}" "$SVC" \
  || { echo "FAIL: walking-skeleton.service.ts line04 required_version != $EXPECTED"; exit 4; }
echo "  OK: HEARTBEAT_MODULES line04 required_version = $EXPECTED"

# 几何推导真链路：mock GetSystemMetrics(vleft=0 vw=2560 vh=1600) → compute_offscreen_x(1200) == -1400
DERIVED=$(cd "$REPO_ROOT/services/agent/wechat-rpa" && python3 -c "
import config
config._get_system_metrics = lambda: (lambda i: {76:0,77:0,78:2560,79:1600}[i])
print(config.compute_offscreen_x(1200))
") || { echo "FAIL: python3 跑 compute_offscreen_x 出错（config 缺失/语法错误？）"; exit 5; }
[ "$DERIVED" = "-1400" ] || { echo "FAIL: compute_offscreen_x mock vleft=0 期望 -1400，实际 ${DERIVED}"; exit 5; }
echo "  OK: compute_offscreen_x 几何推导 = ${DERIVED} (不写死 -2600)"

echo "offscreen-version-gate-smoke: PASS"
