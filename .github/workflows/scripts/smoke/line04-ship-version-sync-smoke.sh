#!/usr/bin/env bash
# line04-ship-version-sync-smoke.sh
# Sprint 06221415 — 修 #817 部署 gap：发货模块版本面 + 自动回复闭环代码必须真到客户机。
#
# 【根因】line04 有三个「版本面」决定客户机能否真升级拿到 #817 自动回复代码：
#   A) services/agent/modules/line04/manifest.json         ← build-line-module.sh 真读它，
#                                                             决定 COS tar 包名 + 包内 manifest
#   B) services/agent/build-modules/line04/manifest.json   ← 打包输出基线（sync-check 比对）
#   C) apps/api .../walking-skeleton.service.ts HEARTBEAT  ← 中台心跳告诉客户机 required_version
#   #817 只 bump 了 B（1.0.51），A/C 还停在 1.0.49 → 客户机被告知「你已是最新」永不重下 →
#   永远跑不上 #817 的自动回复闭环。本 smoke 强制三面一致，且 >= 最低发货版本。
#
# 【自动回复闭环必须在发货源里】发货 Python 源 = services/agent/wechat-rpa/（build 脚本 rsync 它）：
#   - auto_reply.py 必须存在（名单内自动回 / dedup / alert 决策层）
#   - listen_chat.py 必须含 process_outbound_once（出站轮询）+ fetch_outbound_tasks
#
# 退出码：0 全过 / 2 modules manifest / 3 build-modules manifest / 4 heartbeat required_version
#         / 5 三面不一致 / 6 缺 node/python3 / 7 缺自动回复闭环代码 / 8 版本低于发货下界
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
# 发货版本下界：高于 #817 误落在 build-modules 的 1.0.51，避免版本号混。
MIN_SHIP_VERSION="1.0.54"
echo "line04-ship-version-sync-smoke: 发货版本下界 = $MIN_SHIP_VERSION (repo=$REPO_ROOT)"

command -v node >/dev/null 2>&1    || { echo "FAIL: 缺 node"; exit 6; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: 缺 python3"; exit 6; }

# semver 比较：$1 >= $2 返回 0
ver_ge() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]
}

MOD_MANIFEST="$REPO_ROOT/services/agent/modules/line04/manifest.json"
V_MOD=$(node -e "process.stdout.write(require('$MOD_MANIFEST').version)") || { echo "FAIL: 读 modules manifest 失败"; exit 2; }
ver_ge "$V_MOD" "$MIN_SHIP_VERSION" || { echo "FAIL: modules/line04 version=$V_MOD < ${MIN_SHIP_VERSION}（build 脚本真读这个版本打包）"; exit 8; }
echo "  OK: modules/line04 manifest = $V_MOD (>= $MIN_SHIP_VERSION)"

BUILD_MANIFEST="$REPO_ROOT/services/agent/build-modules/line04/manifest.json"
V_BUILD=$(node -e "process.stdout.write(require('$BUILD_MANIFEST').version)") || { echo "FAIL: 读 build-modules manifest 失败"; exit 3; }
echo "  OK: build-modules/line04 manifest = $V_BUILD"

SVC="$REPO_ROOT/apps/api/src/services/walking-skeleton.service.ts"
V_HB=$(grep -oE "'line04-wechat-cs': \{ status: 'active', required_version: '[0-9.]+' \}" "$SVC" | grep -oE "[0-9]+\.[0-9]+\.[0-9]+") \
  || { echo "FAIL: 未在 walking-skeleton.service.ts 找到 line04 required_version"; exit 4; }
echo "  OK: HEARTBEAT_MODULES line04 required_version = $V_HB"

# 三面必须完全一致（治「版本面漂移」根：任一面落后客户机就拿不到新代码）。
if [ "$V_MOD" != "$V_BUILD" ] || [ "$V_MOD" != "$V_HB" ]; then
  echo "FAIL: 三个版本面不一致 — modules=$V_MOD build-modules=$V_BUILD heartbeat=$V_HB"
  echo "      三者必须相等，否则客户机被告知的版本与实际打包版本错位，永不真升级。"
  exit 5
fi
echo "  OK: 三个版本面一致 = $V_MOD"

# 自动回复闭环代码必须在发货 Python 源里（build 脚本 rsync services/agent/wechat-rpa/）。
RPA="$REPO_ROOT/services/agent/wechat-rpa"
[ -f "$RPA/auto_reply.py" ] || { echo "FAIL: 缺 $RPA/auto_reply.py（#817 自动回复决策层）"; exit 7; }
echo "  OK: auto_reply.py 存在"

grep -q "def process_outbound_once" "$RPA/listen_chat.py" \
  || { echo "FAIL: listen_chat.py 缺 process_outbound_once（出站轮询）"; exit 7; }
grep -q "def fetch_outbound_tasks" "$RPA/listen_chat.py" \
  || { echo "FAIL: listen_chat.py 缺 fetch_outbound_tasks（拉出站任务）"; exit 7; }
echo "  OK: listen_chat.py 含 process_outbound_once + fetch_outbound_tasks"

# 决策层关键函数（名单内自动回 / dedup / alert）真在 auto_reply.py 里。
for fn in decide_reply_route is_duplicate alert_on_failure; do
  grep -q "def $fn" "$RPA/auto_reply.py" \
    || { echo "FAIL: auto_reply.py 缺 $fn"; exit 7; }
done
echo "  OK: auto_reply.py 含 decide_reply_route + is_duplicate + alert_on_failure"

echo "line04-ship-version-sync-smoke: PASS"
