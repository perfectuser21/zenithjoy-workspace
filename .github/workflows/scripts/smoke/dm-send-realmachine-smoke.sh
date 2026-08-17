#!/usr/bin/env bash
# dm-send-realmachine-smoke.sh
#
# 抖音私信「真机送达」守卫 —— line02/keyword_acquisition Step4（私信触达）的真机 gate。
#
# 背景（tech 镜头 P0）：agent 侧的 dm 逻辑单测（DmOutreachRateLimiterTest /
# SnapshotDisciplineTest）只覆盖纯逻辑，覆盖不到"抖音改版让 locateProfileBySearch /
# DM 入口定位失效 → agent 静默走不到发送步"这类真机接缝断裂。本守卫在真机上打完整
# RPA 链（定位主页 → 关注/点赞热身 → 打开私信 → 输入 → 发送），断言
# DouyinDmOutreachService 打出终态 `dm_outreach outcome=SENT`，抓住"报了 sent 但其实
# 没发出去 / 改版后压根走不到发送步"的回归。
#
# 触发方式：DEBUG_E2E 广播（e2e/debug 构建自带，自包含，不走服务端派单、只发给固定
# 测试号，绝不骚扰真实陌生人）。目标默认 133643315（同事测试号，见 Memory
# line02-test-douyin-accounts）。
#
# 三态区分（跟 account-scan-realmachine-smoke.sh / line02-android-collect 既有约定一致）：
#   ok()      — 阶段性成功提示
#   fail()    — 真机送达验证真的失败（FAILED / NO_MATCH / 超时无终态），exit 1，阻塞 PR/nightly 红
#   envfail() — 环境未就绪（无设备 / 包没装 / 无障碍没开 / 频控 LIMITED），exit 3，区分于真验证失败
#
# 判定纯函数 classify_dm_outcome / dm_outcome_verdict 抽出可 source（`--source-only`
# guard），供自测 dm-send-realmachine-smoke.test.sh 单独加载做变异测试，防止退化成
# "广播发出去就判绿"的假绿。
#
# 环境变量（workflow 注入，可本地覆盖）：
#   ADB                  adb 可执行路径（默认 adb）
#   ANDROID_ADB_ENDPOINT WiFi-adb 端点（如 192.168.1.96:5555），设了才在掉线时重连（复用 ensure-device-online.sh）
#   SMOKE_APP_PKG        安装的 app 包名（默认 com.zenithjoy.agent.e2e —— DEBUG_E2E 只在 e2e/debug 构建里）
#   SMOKE_DM_TARGET      私信目标抖音号（默认 133643315，固定测试号）
#   SMOKE_DM_MESSAGE     私信文案（默认 guard-test-ignore，ascii 无空格避免 device shell 拆词）
#   SMOKE_ACCOUNT_LABEL  执行小号 label（默认 burner1）
#   POLL_MAX             轮询次数（默认 20）
#   POLL_INTERVAL        轮询间隔秒（默认 12，20×12s=4分钟预算，够跑完热身+私信 RPA）
set -uo pipefail

ok()      { echo "✅ $1"; }
fail()    { echo "❌ 真机送达验证失败: $1"; exit 1; }
envfail() { echo "🟠 环境未就绪(非真机送达bug,查设备/包/无障碍/频控): $1"; exit 3; }

# ── 判定纯函数（可 source，变异测试锚点）──────────────────────────────────
# classify_dm_outcome LOGCAT_DUMP
#   从 logcat 全量输出里提取 DouyinDmOutreachService 的终态 outcome token。
#   取最后一条 `dm_outreach outcome=<TOKEN>`；一条都没有 → 输出 NONE（超时/没跑到终态）。
classify_dm_outcome() {
  local dump="${1:-}"
  local token
  token=$(printf '%s\n' "$dump" \
    | grep -oE 'dm_outreach outcome=[A-Z_]+' \
    | tail -1 \
    | sed -E 's/.*outcome=//')
  printf '%s' "${token:-NONE}"
}

# dm_outcome_verdict OUTCOME_TOKEN
#   把 outcome token 映射成三态退出码（不直接 exit，返回码给调用方判 ok/fail/envfail）：
#     0 = SENT（真送达，判绿）
#     3 = LIMITED（频控命中/非陌生人窗口，环境态，不算代码 bug）
#     1 = 其它（FAILED / NO_MATCH / NONE(超时无终态) / 未知）→ 真失败判红
dm_outcome_verdict() {
  case "${1:-}" in
    SENT)    return 0 ;;
    LIMITED) return 3 ;;
    *)       return 1 ;;
  esac
}

# `source dm-send-realmachine-smoke.sh --source-only` 时到此为止，不跑真机主流程。
if [ "${1:-}" = "--source-only" ]; then
  return 0 2>/dev/null || exit 0
fi

main() {
  local ADB="${ADB:-adb}"
  local PKG="${SMOKE_APP_PKG:-com.zenithjoy.agent.e2e}"
  local TARGET="${SMOKE_DM_TARGET:-133643315}"
  local MESSAGE="${SMOKE_DM_MESSAGE:-guard-test-ignore}"
  local LABEL="${SMOKE_ACCOUNT_LABEL:-burner1}"
  local POLL_MAX="${POLL_MAX:-20}"
  local POLL_INTERVAL="${POLL_INTERVAL:-12}"

  # 设备在线（掉线自愈，复用 #1646 的 ensure-device-online）
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/ensure-device-online.sh"
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/adb-target.sh"
  ensure_device_online "$ADB" "${ANDROID_ADB_ENDPOINT:-}" \
    || envfail "无 Android 设备在线(adb devices 无 'device' 行；重连 ${ANDROID_ADB_ENDPOINT:-未配端点} 后仍失败)"

  # 绑定唯一目标设备：mDNS 会自动为同一台手机再加一个 transport，不带 -s 的调用
  # 返回 more than one device/emulator，pm list packages 的输出因此变空 →
  # 误报"包 $PKG 未安装"（08-17 实测，包其实装着且进程在跑）。
  local DEV
  DEV=$(select_adb_device "$ADB" "${ANDROID_ADB_ENDPOINT:-}") \
    || envfail "select_adb_device 未选出在线设备(adb devices 无 device 行)"

  # 抖音状态复位：collect job 真跑完会把抖音留在 ChatRoomActivity，私信 RPA 从这个
  # 脏状态起步会在 13 秒内 outcome=FAILED（08-17 实测）。collect smoke 采集前早有
  # 同样处置（"根治前一轮残留栈"），dm 侧一直漏了这一步——这也是为什么 08-16 夜车
  # 里 dm job 显示 success：那晚 collect 死在环境闸、根本没碰抖音。
  "$ADB" -s "$DEV" shell am force-stop com.ss.android.ugc.aweme >/dev/null 2>&1 || true
  sleep 3

  # 前置：e2e 包已装（DEBUG_E2E 只在 e2e/debug 构建里，生产包收不到广播）
  if ! "$ADB" -s "$DEV" shell pm list packages 2>/dev/null | tr -d '\r' | grep -q "package:${PKG}$"; then
    envfail "包 $PKG 未安装（DEBUG_E2E 私信触达只在 e2e/debug 构建可用；夜车需先装 e2e apk）"
  fi

  # 前置：DouyinDmOutreachService 无障碍已启用（没开 RPA 走不了）
  if ! "$ADB" -s "$DEV" shell settings get secure enabled_accessibility_services 2>/dev/null | tr -d '\r' \
       | grep -q "${PKG}/com.zenithjoy.agent.collect.DouyinDmOutreachService"; then
    envfail "无障碍服务 DouyinDmOutreachService 未启用（授权后需强杀重启 App 让服务注册）"
  fi
  ok "前置就绪：设备在线 + $PKG 已装 + DmOutreachService 无障碍已启用"

  # 清 buffer + 放大（默认 256K 会被抖音刷屏冲掉 app 日志，见 Memory logcat -G 坑）
  "$ADB" -s "$DEV" logcat -c >/dev/null 2>&1 || true
  "$ADB" -s "$DEV" logcat -G 16M >/dev/null 2>&1 || true

  # fire DEBUG_E2E dm 广播（自包含，只发固定测试号）
  ok "fire 私信: target=$TARGET label=$LABEL msg=$MESSAGE"
  "$ADB" -s "$DEV" shell am broadcast -a com.zenithjoy.agent.DEBUG_E2E -p "$PKG" \
    --es flow dm \
    --es target_douyin_id "$TARGET" \
    --es message "$MESSAGE" \
    --es task_id "smoke-dm-$(date +%s 2>/dev/null || echo t)" \
    --es dm_assignment_id "smoke-dm-a1" \
    --es account_label "$LABEL" 2>&1 | tr -d '\r' | grep -qi "Broadcast completed: result=0" \
    || envfail "DEBUG_E2E dm 广播未被接收（result≠0，检查包名/receiver 是否 e2e 构建）"

  # 轮询 logcat 等终态 outcome
  local i outcome dump
  for i in $(seq 1 "$POLL_MAX"); do
    sleep "$POLL_INTERVAL"
    dump=$("$ADB" -s "$DEV" logcat -d -v brief 2>/dev/null | tr -cd '[:print:]\n')
    outcome=$(classify_dm_outcome "$dump")
    echo "  [$i/$POLL_MAX] outcome=$outcome"
    [ "$outcome" != "NONE" ] && break
  done

  # 三态判定
  dm_outcome_verdict "$outcome"
  case $? in
    0) ok "真机送达确认：dm_outreach outcome=SENT（关注→点赞→打开私信→输入→发送全链跑通）" ;;
    3) envfail "outcome=LIMITED —— 频控命中或非陌生人窗口（环境态，非代码 bug；换目标/等窗口重跑）" ;;
    *) fail "outcome=$outcome —— RPA 未走到发送终态（抖音改版让 locateProfileBySearch/DM入口失效? 查 logcat DouyinDmOutreachService)" ;;
  esac
}

[ "${BASH_SOURCE[0]}" = "${0}" ] && main "$@"
