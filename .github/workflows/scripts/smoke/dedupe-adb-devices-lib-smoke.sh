#!/usr/bin/env bash
# dedupe-adb-devices-lib-smoke.sh — dedupe_adb_devices 回归测试
#
# 背景：2026-08-04 审计发现 nightly-android-fleet-pc4.yml 的 discover-devices job
# 直接用 `adb devices` 的原始输出建 matrix，不去重——同一台物理设备可能同时存在
# USB serial 和无线调试 IP:port 两条 entry（或无线调试换端口后旧 entry 未清理，
# machines.md 已记录的已知坑），导致 matrix 里出现"同一台真机"被两个不同 serial
# 各起一个 job 并发操作、互相干扰（08-03 夜实际复现：2 红 1 取消）。
# 修复：按硬件序列号（ro.serialno，USB/无线调试拿到的都是同一个值）归一去重。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/dedupe-adb-devices.sh"

# 场景1：同一物理设备两条 entry（USB serial + 无线调试 IP:port，ro.serialno 相同）
# → 只保留先出现的一条；不同设备各自保留
RESULT=$(printf 'R58N1234\tHWSERIAL001\n192.168.3.9:5555\tHWSERIAL001\n192.168.3.242:5555\tHWSERIAL002\n' | dedupe_adb_devices)
EXPECTED=$'R58N1234\n192.168.3.242:5555'
[ "$RESULT" = "$EXPECTED" ] || { printf '❌ FAIL 场景1: 期望去重为两台设备:\n%s\n实得:\n%s\n' "$EXPECTED" "$RESULT"; exit 1; }
echo "✅ 场景1通过：同物理设备两条 entry 去重为一条，不同设备各自保留"

# 场景2：读不到 ro.serialno（空字符串，如设备刚断连查询失败）→ 原样保留，
# 不敢猜就不去重（宁可少去重，不可误杀真设备）
RESULT2=$(printf 'R58N9999\t\n' | dedupe_adb_devices)
[ "$RESULT2" = "R58N9999" ] || { echo "❌ FAIL 场景2: 空 hw_serial 应原样保留，实得: $RESULT2"; exit 1; }
echo "✅ 场景2通过：读不到 ro.serialno 时原样保留，不误判去重"

# 场景3：三台完全不同的设备（各自独立 ro.serialno）→ 全部保留，互不影响
RESULT3=$(printf 'A\tHW-A\nB\tHW-B\nC\tHW-C\n' | dedupe_adb_devices)
EXPECTED3=$'A\nB\nC'
[ "$RESULT3" = "$EXPECTED3" ] || { printf '❌ FAIL 场景3: 三台不同设备应全部保留:\n%s\n实得:\n%s\n' "$EXPECTED3" "$RESULT3"; exit 1; }
echo "✅ 场景3通过：不同物理设备互不影响，全部保留"

echo "🎉 PASS: dedupe_adb_devices 去重逻辑回归通过"
