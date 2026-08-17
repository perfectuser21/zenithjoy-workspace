#!/usr/bin/env bash
# smoke-adb-binding-and-state-isolation.test.sh
#
# 两类退化的静态守卫（无需真机，CI linux runner 可跑）：
#
# A. adb 调用必须绑定 -s ——adb server 每次重启会通过 mDNS 自动为同一台手机再加一个
#    transport（ip:port + adb-<序列号>-xxxx._adb-tls-connect._tcp），不带 -s 的调用
#    返回 "more than one device/emulator"，被 grep 吃成空值 → 误报"包未安装/无障碍未开"。
#    08-17 实测这个会持续复发（清理旧 transport 后几分钟又自己加回来），所以只能靠绑定。
#
# B. dm smoke 必须在跑 RPA 前复位抖音 ——collect job 真跑完会把抖音留在 ChatRoomActivity，
#    dm job 相隔约 1 分钟从这个脏状态起步 → 13 秒内 outcome=FAILED。
#    08-17 隔离实验：force-stop 抖音后手跑 dm smoke → NONE×4 → SENT, exit 0，
#    证明私信链路本身健康。08-16 dm job 之所以 success，恰恰因为 collect 死在环境闸
#    根本没碰抖音——这两个 job 从未真正连续成功跑过一次。
#
# 这两条都是"行为正确但极易被后人改回去"的类型，故用静态断言钉住。
set -uo pipefail

SMOKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../smoke" && pwd)"
COLLECT="$SMOKE_DIR/line02-android-collect-realmachine-smoke.sh"
DM="$SMOKE_DIR/dm-send-realmachine-smoke.sh"

PASS=0; FAIL=0
check() { # check DESC EXPECT ACTUAL
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1";
  else FAIL=$((FAIL+1)); echo "  ❌ $1 (期望=$2 实际=$3)"; fi
}

# 裸调用 = 形如 "$ADB" shell / "$ADB" logcat 而没有紧跟 -s 的。
# 注意 lib/ensure-device-online.sh 内部自带 -s，不在本检查范围（它不匹配此模式）。
count_bare_adb() {
  grep -cE '"\$ADB" (shell|logcat)' "$1" 2>/dev/null || true
}

echo "== A. adb 调用绑定 -s（两个真机 smoke 都不得有裸调用）=="
check "collect smoke 无裸 adb 调用" "0" "$(count_bare_adb "$COLLECT")"
check "dm smoke 无裸 adb 调用"      "0" "$(count_bare_adb "$DM")"
check "collect smoke 确实用了 select_adb_device" "yes" \
  "$(grep -q 'select_adb_device' "$COLLECT" && echo yes || echo no)"
check "dm smoke 确实用了 select_adb_device" "yes" \
  "$(grep -q 'select_adb_device' "$DM" && echo yes || echo no)"

echo "== B. dm smoke 跑 RPA 前必须复位抖音 =="
check "含抖音复位命令" "yes" \
  "$(grep -q 'am force-stop com.ss.android.ugc.aweme' "$DM" && echo yes || echo no)"

# 复位必须发生在 fire 广播之前，否则等于没复位
RESET_LINE=$(grep -n 'am force-stop com.ss.android.ugc.aweme' "$DM" | head -1 | cut -d: -f1)
FIRE_LINE=$(grep -n 'am broadcast' "$DM" | head -1 | cut -d: -f1)
if [ -n "$RESET_LINE" ] && [ -n "$FIRE_LINE" ]; then
  check "复位出现在 fire 广播之前" "yes" \
    "$([ "$RESET_LINE" -lt "$FIRE_LINE" ] && echo yes || echo no)"
else
  check "复位出现在 fire 广播之前" "yes" "no(定位失败 reset=$RESET_LINE fire=$FIRE_LINE)"
fi

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
