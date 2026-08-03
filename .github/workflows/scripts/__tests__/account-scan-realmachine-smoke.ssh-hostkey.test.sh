#!/usr/bin/env bash
# account-scan-realmachine-smoke.ssh-hostkey.test.sh — TDD Red 阶段
#
# 背景（2026-08-03 nightly run 30793335158 实锤，stderr 直出后首次拿到真实报错）：
#   runner 上下文的 ssh 对 vps-hk 报 `Host key verification failed.`——交互 shell 能通
#   （known_hosts 已有条目），runner 的 ssh 客户端/算法协商不同导致校验失败，
#   license 查询 3 次重试全空。内网 Tailscale 100.x 场景下 accept-new 是标准 CI 解法。
#
# 结构性静态检查：
#   1. 必须存在统一封装 sshdb()，含 BatchMode=yes + StrictHostKeyChecking=accept-new + ConnectTimeout
#   2. 脚本内不得再有裸 `ssh "$DB_SSH_HOST"` 调用（全部走 sshdb，防新增调用点漏配）
set -uo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh"
echo "━━ ssh-hostkey 结构性测试 ━━"
[ -f "$SCRIPT" ] || { echo "❌ $SCRIPT 不存在"; exit 1; }
FAIL=0

if ! grep -q 'sshdb()' "$SCRIPT"; then
  echo "❌ FAIL: 无 sshdb() 统一封装"; FAIL=1
else
  SSHDB_LINE=$(grep -n 'sshdb()' "$SCRIPT" | head -1 | cut -d: -f1)
  SSHDB_BLOCK=$(sed -n "${SSHDB_LINE},$((SSHDB_LINE+3))p" "$SCRIPT")
  echo "$SSHDB_BLOCK" | grep -q 'BatchMode=yes' || { echo "❌ FAIL: sshdb 缺 BatchMode=yes(会挂在交互提示)"; FAIL=1; }
  echo "$SSHDB_BLOCK" | grep -q 'StrictHostKeyChecking=accept-new' || { echo "❌ FAIL: sshdb 缺 StrictHostKeyChecking=accept-new"; FAIL=1; }
  echo "$SSHDB_BLOCK" | grep -q 'ConnectTimeout' || { echo "❌ FAIL: sshdb 缺 ConnectTimeout"; FAIL=1; }
fi

# 公网直连路由支持（2026-08-03 run 30794878185 实锤 SYSTEM 无 Tailscale 身份后新增）：
# sshdb 必须支持 DB_SSH_PORT（跨境22被墙走6443）与可选 DB_SSH_KEY（runner 专用受限密钥 -i）
if [ -n "${SSHDB_LINE:-}" ]; then
  SSHDB_BLOCK6=$(sed -n "${SSHDB_LINE},$((SSHDB_LINE+6))p" "$SCRIPT")
  echo "$SSHDB_BLOCK6" | grep -q 'DB_SSH_PORT' || { echo "❌ FAIL: sshdb 缺 DB_SSH_PORT 支持(跨境22被墙需走高位端口)"; FAIL=1; }
  echo "$SSHDB_BLOCK6" | grep -q 'DB_SSH_KEY' || { echo "❌ FAIL: sshdb 缺 DB_SSH_KEY 可选专用密钥支持"; FAIL=1; }
fi

RAW_COUNT=$(grep -c 'ssh "\$DB_SSH_HOST"' "$SCRIPT" || true)
if [ "${RAW_COUNT:-0}" -gt 0 ]; then
  echo "❌ FAIL: 仍有 $RAW_COUNT 处裸 ssh \"\$DB_SSH_HOST\" 调用未走 sshdb"; FAIL=1
else
  echo "✅ 无裸 ssh 调用"
fi

[ "$FAIL" -eq 0 ] && { echo "✅ PASS"; exit 0; } || { echo "❌ RED/FAIL"; exit 1; }
