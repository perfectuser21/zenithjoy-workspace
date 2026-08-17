#!/usr/bin/env bash
# adb-target.test.sh — select_adb_device 变异测试（无需真机，CI linux runner 可跑）
#
# 防的退化：adb 因 mDNS 自动多出第二个 transport 时，不带 -s 的调用会返回
# "more than one device/emulator"，脚本 grep 拿到空 → 误报"包未安装"（08-17 实测）。
set -uo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../smoke/lib" && pwd)/adb-target.sh"
# shellcheck source=/dev/null
source "$LIB"

PASS=0; FAIL=0
check() { # check DESC EXPECT ACTUAL
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1";
  else FAIL=$((FAIL+1)); echo "  ❌ $1 (期望=$2 实际=$3)"; fi
}

# fake_adb：用 $FAKE_DEVICES 冒充 `adb devices` 输出
fake_adb() {
  case "${1:-}" in
    devices) printf '%s\n' "$FAKE_DEVICES" ;;
    *) return 0 ;;
  esac
}

echo "== select_adb_device：mDNS 双 transport 场景 =="

# ⚠️ 关键：endpoint 必须放在**非第一行**，否则本条断言没有区分能力——
# "取第一个 device 行"的退化实现也会碰巧通过（08-17 proven-to-fire 实测踩到：
# 删掉 endpoint 优先分支后测试仍全绿，因为 mock 里 endpoint 恰好在第一行）。
# 真机上顺序确实不确定：rog 实测 transport_id:3 排在 transport_id:2 前面。
FAKE_DEVICES='List of devices attached
adb-ANGYVB4311010223-yPCLHP._adb-tls-connect._tcp	device
192.168.1.96:5555	device'
check "双 transport 且 endpoint 不在首行时仍选中 endpoint" "192.168.1.96:5555" \
  "$(select_adb_device fake_adb 192.168.1.96:5555)"

# 顺序反过来也要成立（防止把断言写成依赖某个特定顺序）
FAKE_DEVICES='List of devices attached
192.168.1.96:5555	device
adb-ANGYVB4311010223-yPCLHP._adb-tls-connect._tcp	device'
check "双 transport 且 endpoint 在首行时选中 endpoint" "192.168.1.96:5555" \
  "$(select_adb_device fake_adb 192.168.1.96:5555)"

echo "== select_adb_device：endpoint 未在线 → fallback 第一个 device 行 =="

FAKE_DEVICES='List of devices attached
adb-ANGYVB4311010223-yPCLHP._adb-tls-connect._tcp	device'
check "endpoint 不在线时 fallback" "adb-ANGYVB4311010223-yPCLHP._adb-tls-connect._tcp" \
  "$(select_adb_device fake_adb 192.168.1.96:5555)"

echo "== select_adb_device：未设 endpoint（回归保护，行为须与改动前一致）=="

FAKE_DEVICES='List of devices attached
e6c7ef34	device
192.168.3.9:5555	device'
check "未设 endpoint 取第一个" "e6c7ef34" "$(select_adb_device fake_adb '')"

echo "== select_adb_device：offline 行不得被选中 =="

FAKE_DEVICES='List of devices attached
192.168.1.96:5555	offline
e6c7ef34	device'
check "跳过 offline 行" "e6c7ef34" "$(select_adb_device fake_adb 192.168.1.96:5555)"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
