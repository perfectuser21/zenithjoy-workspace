#!/usr/bin/env bash
# line04 CI×常驻监听 桌面互斥 接线守卫（环境接缝 smoke）
#
# 背景（2026-07-18 实证）：rog 上常驻 line04 监听与 self-hosted CI runner 抢同一 session-1
# 交互桌面 = 持续真塌根因。修法两段：
#   ① CI 抢桌面的 job 在 PsExec -i 1 前 acquire 高优先级(priority=10<监听50)全局桌面租约、
#      always-release；
#   ② 监听主循环顶部查 broker /status，他人持更高优先级租约 → 整轮让位。
# 本 smoke 守住这条环境接缝：任何人把 CI 侧 acquire/release 或监听侧让位删掉 → CI 红。
# （逻辑层已有 vitest/pytest 覆盖：desktop-lease-broker-status.test.ts / test_desktop_yield.py /
#  test_mainloop_wiring.py::test_desktop_mutex_yield_wired_at_loop_top。此 smoke 专守 workflow 接线。）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $*"; exit 1; }

WF_CS=".github/workflows/wechat-cs-e2e.yml"
WF_NIGHTLY=".github/workflows/nightly-real-machine-staging.yml"
LISTEN="services/agent/wechat-rpa/listen_chat.py"

echo "[1/4] CI bubble-read-gate 抢桌面前 acquire priority=10 租约 + release"
grep -q "clientId = 'ci/bubble-read-gate'; priority = 10" "$WF_CS" \
  || fail "$WF_CS bubble-read-gate 未在 PsExec 前 acquire priority=10 桌面租约"
grep -q "leaseBase/release" "$WF_CS" \
  || fail "$WF_CS 缺 desktop-lease 释放（always-release）"

echo "[2/4] nightly wechat-bubble 抢桌面前 acquire priority=10 租约 + release"
grep -q "clientId = 'ci/wechat-bubble'; priority = 10" "$WF_NIGHTLY" \
  || fail "$WF_NIGHTLY wechat-bubble 未在 PsExec 前 acquire priority=10 桌面租约"
grep -q "leaseBase/release" "$WF_NIGHTLY" \
  || fail "$WF_NIGHTLY 缺 desktop-lease 释放（always-release）"

echo "[3/4] acquire 必须在 PsExec 之前（顺序对：先占租再抢桌面）"
for wf in "$WF_CS" "$WF_NIGHTLY"; do
  ACQ_LINE=$(grep -n "leaseBase/acquire" "$wf" | head -1 | cut -d: -f1)
  PSEXEC_LINE=$(grep -n "PsExec64.exe -i 1" "$wf" | head -1 | cut -d: -f1)
  [ -n "$ACQ_LINE" ] && [ -n "$PSEXEC_LINE" ] || fail "$wf 找不到 acquire 或 PsExec 行"
  [ "$ACQ_LINE" -lt "$PSEXEC_LINE" ] \
    || fail "$wf acquire($ACQ_LINE) 必须在 PsExec($PSEXEC_LINE) 之前，否则先抢桌面才占租=没意义"
done

echo "[4/4] 监听主循环顶部接了让位（早于扫描）"
grep -q "_should_yield_desktop(" "$LISTEN" \
  || fail "$LISTEN 缺 _should_yield_desktop 让位判定"
YIELD_LINE=$(grep -n "_should_yield_desktop(" "$LISTEN" | grep -v "def _should_yield_desktop" | head -1 | cut -d: -f1)
SCAN_LINE=$(grep -n "unread = scan_unread(" "$LISTEN" | head -1 | cut -d: -f1)
[ -n "$YIELD_LINE" ] && [ -n "$SCAN_LINE" ] || fail "找不到让位调用或 scan_unread"
[ "$YIELD_LINE" -lt "$SCAN_LINE" ] \
  || fail "让位检查($YIELD_LINE)必须在 scan_unread($SCAN_LINE)之前（loop 顶整轮让位）"

echo "PASS: line04 CI×监听 桌面互斥接线完整（CI 两 job acquire/release + 监听 loop 顶让位）"
