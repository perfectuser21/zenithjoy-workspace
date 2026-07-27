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

echo "[1/6] 两条 workflow 均已删除 acquire fail-open"
for wf in "$WF_CS" "$WF_NIGHTLY"; do
  ! grep -q "proceeding anyway" "$wf" \
    || fail "$wf 仍在租约拒绝/Broker异常后继续碰生产桌面"
  grep -q "desktop-lease acquire failed closed" "$wf" \
    || fail "$wf 缺 acquire fail-closed 锚点"
done

echo "[2/6] 两条 workflow 均等待 listener 对同一 lease ID 确认"
for wf in "$WF_CS" "$WF_NIGHTLY"; do
  grep -q "yield_acknowledged" "$wf" \
    || fail "$wf 缺 yield_acknowledged 检查"
  grep -q "yield_acknowledged_by" "$wf" \
    || fail "$wf 缺 yield_acknowledged_by 检查"
  grep -q "'line04/listen_chat'" "$wf" \
    || fail "$wf 未锁定确认者 line04/listen_chat"
  grep -q "desktop-lease quiescence timeout" "$wf" \
    || fail "$wf 缺静默确认超时 fail-closed 锚点"
  grep -q "listenerLogLineCount" "$wf" \
    || fail "$wf 缺旧 Agent 滚动升级前的日志水位快照"
  grep -q "PSObject.Properties\\['lease_id'\\]" "$wf" \
    || fail "$wf 缺按 lease_id capability 隔离新旧协议"
  grep -q "Select-String -SimpleMatch '(CI)'" "$wf" \
    || fail "$wf 旧协议未锁定唯一 loop-top 安全点锚点"
  grep -q "desktop-lease legacy quiescence acknowledged" "$wf" \
    || fail "$wf 缺旧 Agent 静默确认日志"
done

echo "[3/6] CI 与 nightly 均在 PsExec 前 acquire priority=10 租约 + always-release"
grep -q "clientId = 'ci/bubble-read-gate'; priority = 10" "$WF_CS" \
  || fail "$WF_CS bubble-read-gate 未在 PsExec 前 acquire priority=10 桌面租约"
grep -q "leaseBase/release" "$WF_CS" \
  || fail "$WF_CS 缺 desktop-lease 释放（always-release）"

grep -q "clientId = 'ci/wechat-bubble'; priority = 10" "$WF_NIGHTLY" \
  || fail "$WF_NIGHTLY wechat-bubble 未在 PsExec 前 acquire priority=10 桌面租约"
grep -q "leaseBase/release" "$WF_NIGHTLY" \
  || fail "$WF_NIGHTLY 缺 desktop-lease 释放（always-release）"

echo "[4/6] 顺序必须为 acquire → quiescence acknowledged → PsExec"
for wf in "$WF_CS" "$WF_NIGHTLY"; do
  ACQ_LINE=$(grep -n "leaseBase/acquire" "$wf" | head -1 | cut -d: -f1)
  ACK_LINE=$(grep -n "desktop-lease quiescence acknowledged" "$wf" | head -1 | cut -d: -f1)
  PSEXEC_LINE=$(grep -n "PsExec64.exe -i 1" "$wf" | head -1 | cut -d: -f1)
  [ -n "$ACQ_LINE" ] && [ -n "$ACK_LINE" ] && [ -n "$PSEXEC_LINE" ] \
    || fail "$wf 找不到 acquire、quiescence acknowledged 或 PsExec 行"
  [ "$ACQ_LINE" -lt "$ACK_LINE" ] && [ "$ACK_LINE" -lt "$PSEXEC_LINE" ] \
    || fail "$wf 必须按 acquire → quiescence acknowledged → PsExec 排序"
done

echo "[5/6] 监听主循环顶部确认静默并让位（早于扫描）"
grep -q "_should_yield_desktop(" "$LISTEN" \
  || fail "$LISTEN 缺 _should_yield_desktop 让位判定"
grep -q "desktop_lease_ack_yield(_desktop_status)" "$LISTEN" \
  || fail "$LISTEN 缺 loop-top 静默确认"
YIELD_LINE=$(grep -n "_should_yield_desktop(" "$LISTEN" | grep -v "def _should_yield_desktop" | head -1 | cut -d: -f1)
SCAN_LINE=$(grep -n "unread = scan_unread(" "$LISTEN" | head -1 | cut -d: -f1)
[ -n "$YIELD_LINE" ] && [ -n "$SCAN_LINE" ] || fail "找不到让位调用或 scan_unread"
[ "$YIELD_LINE" -lt "$SCAN_LINE" ] \
  || fail "让位检查($YIELD_LINE)必须在 scan_unread($SCAN_LINE)之前（loop 顶整轮让位）"

echo "[6/6] Broker 与监听使用同一个 ack-yield 本机端点"
grep -q "desktop-lease-broker/ack-yield" "$LISTEN" \
  || fail "$LISTEN 缺 ack-yield 本机 IPC"
grep -q "desktop-lease-broker/ack-yield" "services/agent/src/handlers/wechat-rpa.ts" \
  || fail "Agent HTTP 路由缺 ack-yield"

echo "PASS: line04 CI×监听两阶段桌面交接完整（acquire + listener quiescence ack + PsExec）"
