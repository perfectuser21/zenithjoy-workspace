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

echo "== C. uiautomator dump 的三个真机必需条件（08-17 真机实测踩出）=="
# 这三条都是 PR #1312 那段从未真机跑过的代码缺的，不补上授权段等于死代码：
#   1) MSYS_NO_PATHCONV=1 —— workflow 用 git bash，/sdcard/xxx 会被 MSYS 路径转换
#      成 C:/Program Files/Git/sdcard/xxx，dump 根本没落到设备上（实测 ls 报
#      "ls: C:/Program: No such file or directory"）
#   2) 带重试 —— 界面在动时 dump 报 "ERROR: could not get idle state."（实测抖音
#      SplashActivity 动画期间必失败）
#   3) exec-out 而非 shell cat 读取 —— 实测 shell cat 拿到 0 字节，exec-out 才拿到完整 xml
# ⚠️ 必须匹配"紧跟 adb 调用"的形态，不能只 grep 关键词——本文件的注释里也写了
# MSYS_NO_PATHCONV，光 grep 关键词的话删掉真实代码后注释仍让断言通过（08-17
# 变异验证抓到，这是本次第三个同类假守卫）。
check "授权段用 MSYS_NO_PATHCONV 防路径转换" "2" \
  "$(grep -cE 'MSYS_NO_PATHCONV=1 "\$ADB" -s "\$DEV"' "$COLLECT" || true)"
# 注意断言的取窗方向：重试循环包在 dump **之前**（for 在外、dump 在内），
# 所以要往前取（-B）而不是往后取（-A）——第一版写成 -A6 时这条恒红，
# 是断言自己的 bug 而非实现缺失（08-17 踩到，与 adb-target 那次同类）。
check "dump 带重试（应对 could not get idle state）" "yes" \
  "$(grep -B6 -A2 'uiautomator dump' "$COLLECT" | grep -qE 'for [a-z]+ in 1 2 3' && echo yes || echo no)"
check "用 exec-out 读 dump（shell cat 拿不到内容）" "yes" \
  "$(grep -q 'exec-out cat' "$COLLECT" && echo yes || echo no)"
# ⚠️ 这里**故意不加**"授权前把 agent 拉到前台"的静态断言。
# 试过三种写法（grep -B 窗口 / 关键词 / 行号比较），变异验证全部无法报红——因为
# 脚本在授权段之前本来就有一处 `monkey -p com.zenithjoy.agent`（:112 的"主动拉起
# agent"），删掉授权段那处后断言仍会命中它。要守的其实是"dump 那一刻 agent 在
# 前台"，这是**运行时状态，静态断言天然守不住**。
# 按本 PR 自己的原则——守不住就别装守得住，假守卫比没守卫更糟——不留这条，
# 改由代码注释说明意图 + 真机验证兜（真机实测过：不拉前台时 dump 到的是
# aweme/SplashActivity，界面里没有「授权截屏」按钮）。

echo "== D. 判定链前置授权：能 adb 做的必须自动做（08-17 真机实测哪些可行）=="
# 真机实测三条结论：
#   ✅ pm grant RECORD_AUDIO      有效——granted=true 后 agent 界面「录音未授权」警告消失。
#      判定走 20 秒音频转写，缺它视频类判定必然 pending。
#   ✅ appops RECORD_AUDIO allow  有些 ROM 是双闸（permission + appop），一并放开。
#   ❌ appops PROJECT_MEDIA allow 不足以让 app 认为已授权（MediaProjection 是
#      session-based consent、每次要 token，不是 permission）。仍设它是必要条件之一、
#      无害，但**替代不了人点弹窗**——见下方 E 组关于措辞的断言。
check "自动授予 RECORD_AUDIO（判定用 20s 音频转写）" "yes" \
  "$(grep -q 'pm grant .* android.permission.RECORD_AUDIO' "$COLLECT" && echo yes || echo no)"
check "同时放开 RECORD_AUDIO 的 appop（双闸 ROM）" "yes" \
  "$(grep -q 'appops set .* RECORD_AUDIO allow' "$COLLECT" && echo yes || echo no)"

echo "== E. 授权段措辞不得撒谎（假绿治理的一部分）=="
# 第一版写「MediaProjection 授权流程已触发」——真机实测那只是点开了系统弹框，
# 而该弹框是系统安全窗口、对 uiautomator 不可见（dump 拿到的仍是底层 agent 界面），
# 点不掉。措辞必须明说"需要人确认"，否则又是一句让人误以为搞定了的假话。
check "授权段措辞明示需人工确认" "yes" \
  "$(grep -qE '需(要)?人|人工确认|人点' "$COLLECT" && echo yes || echo no)"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
