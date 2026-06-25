#!/usr/bin/env bash
# line04-friend-scan-scroll-smoke.sh
# Track A (line04 1.0.64) — 滚动扫全活跃会话 + 读对方微信号/加微信时间 的外环 E2E。
#
# 验三件事（全自动，clean CI 可跑，零真机/零 pywinauto）：
#   1) 版本三面一致且 == 1.0.64（modules / build-modules manifest + 中台心跳 required_version）——
#      任一面落后客户机被告知「已最新」永不重下，拿不到本次滚动扫全代码。
#   2) 滚动累计纯函数 + scan_recent_contacts 真把多屏会话收齐（pytest test_friend_scan_scroll）。
#   3) 资料页微信号 + 最早消息日期解析 + 上报 payload 补字段（pytest test_contact_profile_parse）。
#
# 退出码：0 全过 / 2 版本不一致或≠1.0.64 / 3 滚动扫全 pytest 失败 / 4 解析 pytest 失败 / 6 缺 node/python3
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
EXPECT_VERSION="1.0.64"
echo "line04-friend-scan-scroll-smoke: 期望版本 = $EXPECT_VERSION (repo=$REPO_ROOT)"

command -v node >/dev/null 2>&1    || { echo "FAIL: 缺 node"; exit 6; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: 缺 python3"; exit 6; }

V_MOD=$(node -e "process.stdout.write(require('$REPO_ROOT/services/agent/modules/line04/manifest.json').version)")
V_BUILD=$(node -e "process.stdout.write(require('$REPO_ROOT/services/agent/build-modules/line04/manifest.json').version)")
SVC="$REPO_ROOT/apps/api/src/services/walking-skeleton.service.ts"
V_HB=$(grep -oE "'line04-wechat-cs': \{ status: 'active', required_version: '[0-9.]+' \}" "$SVC" | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")
echo "  modules=$V_MOD build-modules=$V_BUILD heartbeat=$V_HB"
if [ "$V_MOD" != "$EXPECT_VERSION" ] || [ "$V_BUILD" != "$EXPECT_VERSION" ] || [ "$V_HB" != "$EXPECT_VERSION" ]; then
  echo "FAIL: 版本三面必须都 == $EXPECT_VERSION（modules=$V_MOD build=$V_BUILD heartbeat=$V_HB）"
  exit 2
fi
echo "  OK: 三个版本面一致 = $EXPECT_VERSION"

cd "$REPO_ROOT/services/agent/wechat-rpa"
echo "  跑滚动扫全单测…"
python3 -m pytest tests/test_friend_scan_scroll.py -q || { echo "FAIL: 滚动扫全 pytest 未过"; exit 3; }
echo "  OK: 滚动扫全多屏收齐"

echo "  跑微信号/加微信时间解析单测…"
python3 -m pytest tests/test_contact_profile_parse.py -q || { echo "FAIL: 资料解析 pytest 未过"; exit 4; }
echo "  OK: 微信号 + 最早消息日期解析 + payload 补字段"

echo "line04-friend-scan-scroll-smoke: PASS"
