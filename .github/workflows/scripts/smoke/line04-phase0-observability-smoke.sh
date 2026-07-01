#!/usr/bin/env bash
# line04-phase0-observability-smoke.sh
#
# 本 PR 把 Path 4「客户私域 AI 接管」的可观测性从 🔴 推到 ✅：
#   客户机监听（listen_chat）每轮把「模块版本 + 每条未读为何没回」上报中台心跳 diag，
#   同事机器无 SSH 也能在中台看板看实情（Phase 0，为 Phase 1 窗口管家打观测基础）。
#
# 真实链路验证（非占位）：
#   [1] 三版本面一致（modules / build-modules / 中台心跳 required_version）= 客户机能真升级到带观测的版本
#   [2] build_diag 真输出含 module_version + skip_reasons（中台看板要读的两个新字段）
#   [3] _SkipCounter 真累计 skip reason（"每条为何没回"的数据源）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

echo "[1/3] 三版本面一致（modules / build-modules / 中台心跳）"
V_MOD=$(node -e "process.stdout.write(require('./services/agent/modules/line04/manifest.json').version)")
V_BUILD=$(node -e "process.stdout.write(require('./services/agent/build-modules/line04/manifest.json').version)")
V_HB=$(grep -oE "'line04-wechat-cs': \{ status: 'active', required_version: '[0-9.]+' \}" \
       apps/api/src/services/walking-skeleton.service.ts | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")
echo "  modules=$V_MOD build-modules=$V_BUILD heartbeat=$V_HB"
if [ "$V_MOD" != "$V_BUILD" ] || [ "$V_MOD" != "$V_HB" ]; then
  echo "FAIL: line04 三个版本面不一致，客户机拿不到带观测的新版"
  exit 1
fi

echo "[2/3] build_diag 真输出含 module_version + skip_reasons；[3/3] _SkipCounter 真累计"
ZENITHJOY_MODULE_VERSION="$V_MOD" python3 - <<'PY'
import os
import sys
sys.path.insert(0, "services/agent/wechat-rpa")
import listen_chat

c = listen_chat._SkipCounter()
c.record("dup")
c.record("group")
c.record("dup")
snap = c.snapshot()
assert snap["total"] == {"dup": 2, "group": 1}, snap
assert snap["delta"] == {"dup": 2, "group": 1}, snap

diag = listen_chat.build_diag(
    main_window_found=True, login_present=False, logged_in=True,
    screen_locked=False, sessions_seen=3, unread_senders=["a", "b"],
    replied_count=0, last_error=None, skip_snapshot=snap)
want = os.environ["ZENITHJOY_MODULE_VERSION"]
assert diag["module_version"] == want, diag["module_version"]
assert diag["skip_reasons"]["total"] == {"dup": 2, "group": 1}, diag["skip_reasons"]
assert diag["unread_count"] == 2, diag["unread_count"]
print("  module_version=%s skip_reasons.total=%s" % (diag["module_version"], diag["skip_reasons"]["total"]))
PY

echo "PASS: line04 Phase 0 观测埋点 — 版本三面一致 + 心跳 diag 含 module_version+skip_reasons"
