#!/usr/bin/env bash
# wechat-cs-visible-delivery-smoke.sh
# Sprint 06211342 — 微信客服 B 方案（窗口可见 + 不抢焦点 + 真送达读回验证）逻辑断言
#   + line04 模块版本一致性 smoke。（PR #811 squash 遗漏，本 PR 补回。）
#
# 验证链路（纯仓内一致性 + Python 纯逻辑真链路，不依赖运行中的服务/真机）：
#   1. node 解析 services/agent/modules/line04/manifest.json     → version == EXPECTED
#   2. node 解析 services/agent/build-modules/line04/manifest.json → version == EXPECTED（打包真源）
#   3. grep apps/api/src HEARTBEAT_MODULES line04-wechat-cs required_version == EXPECTED（心跳下发）
#   4. python3 真跑 listen_chat._delivery_confirmed：读回含发送原文→DELIVERED / 不含→未送达
#      （治 _uia_send 的 sent=True 假阳性 —— PrepPRD 血泪修正第 4 条）
#   5. python3 真跑 _focus_steal_verdict：焦点归还→silent / 未归还→not silent（不抢前台焦点）
#   6. python3 验 config.OFFSCREEN_REPLY == False（窗口可见默认，不藏屏外 —— 方向反转）
#
# 退出码：0 全过 / 2 modules manifest / 3 build-modules manifest / 4 service required_version
#         / 5 B 方案逻辑断言 / 6 缺 node/python3
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
EXPECTED="1.0.110"
echo "wechat-cs-visible-delivery-smoke: 期望 line04 版本 = $EXPECTED (repo=$REPO_ROOT)"

command -v node >/dev/null 2>&1    || { echo "FAIL: 缺 node"; exit 6; }
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

# B 方案逻辑断言真链路：真送达验证 + 不抢焦点判定 + 窗口可见默认
python3 - "$REPO_ROOT" <<'PY' || { echo "FAIL: B 方案逻辑断言不通过"; exit 5; }
import sys
sys.path.insert(0, sys.argv[1] + "/services/agent/wechat-rpa")
import listen_chat, config
# 真送达：读回会话预览含发送原文才 DELIVERED（替 sent=True 自报）
assert listen_chat._delivery_confirmed("默忆\nTest 1234 verify\n12:45", "Test 1234 verify") is True
assert listen_chat._delivery_confirmed("默忆\n之前的旧消息\n12:40", "Test 1234 verify") is False
# 不抢焦点：操作后焦点归还操作前窗口 → silent；未归还 → not silent
assert listen_chat._focus_steal_verdict(100, 100, 30, 400)["silent"] is True
assert listen_chat._focus_steal_verdict(100, 200, 400, 400)["silent"] is False
# 窗口可见默认（方向反转，不藏屏外）
assert config.OFFSCREEN_REPLY is False
print("  OK: 真送达验证 + 不抢焦点判定 + 窗口可见默认")
PY

echo "wechat-cs-visible-delivery-smoke: PASS"
