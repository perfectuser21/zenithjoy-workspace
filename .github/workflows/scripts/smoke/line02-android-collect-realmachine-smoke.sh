#!/usr/bin/env bash
# line02-android-collect-realmachine-smoke.sh
#
# agent-android(Kotlin)抖音采集的**真机端到端守卫**——对标 cjs 版 e2e-line02-keyword-comment。
# 这是 services/agent-android/DouyinCollectService.kt 这套采集第一个真机 gate。
#
# 背景(2026-07-13 诊断)：抖音采集有两套实现。Windows Node/CDP 版(services/agent/*.cjs)
# 早有真机 E2E；Android 原生 Kotlin 版(agent-android)是"双重真空区"——既在 harness 真机
# target_environment 之外(枚举无 android)、又只有 ubuntu 单测+编 APK,零真机守卫。结果 19 个
# 采集 PR 里 17 个手动打地鼠、几乎不留 gate,抖音一更新/换个词就复发(广告 abort / 多卡卡死 /
# SEARCH_TIMEOUT 各种)。本 gate 让 Kotlin 版采集第一次"每次改代码就自动在真机重验一遍"。
#
# 链路：collect/start 派"装修"任务 → 设备 DouyinCollectService 真机采集 → 断言落库。
#   env 就绪 → 采集失败即红(阻塞)；env 未就绪也红但消息前缀区分,便于运维定位。
#
# 依赖(xian-rog self-hosted runner 上)：
#   - adb(WinGet scrcpy 版)+ 连着的 Android 设备(装 agent / 无障碍已开 / 抖音已登录)
#   - staging API 可达(API_BASE)
# 环境变量(workflow 注入,可本地覆盖)：
#   ADB          adb 可执行路径(默认 adb)
#   API_BASE     staging API base(默认 https://staging-autopilot.zenjoymedia.media)
#   SMOKE_TENANT 测试租户(默认真机测试租户)
#   SMOKE_AGENT  设备 agent_id
#   SMOKE_KW     关键词(默认 装修——商业词,广告密度最高,最能压出采集稳定性)
#   POLL_MAX     轮询次数(默认 30,×10s=5min)

set -uo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/trim-json.sh"

ok()      { echo "✅ $1"; }
fail()    { echo "❌ 采集验证失败: $1"; exit 1; }   # 采集真坏 → 硬红,阻塞 PR
envfail() { echo "🟠 环境未就绪(非采集 bug,查设备/staging/agent): $1"; exit 3; }  # 环境噪音 → 红但可辨

# ── 判据纯函数区（可 source，变异测试锚点）──────────────────────────────
# 放在 --source-only guard 之前，供 __tests__/ 下的变异测试单独加载做 mock 测试。
# 结构照抄 dm-send-realmachine-smoke.sh（:41-71）的既有模式。
# 之所以要抽出来：这些判据此前混在主流程里无法被测，退化了没人知道——
# e2e-line02-android-collect 连红 12+ 晚全部停在环境自检、从未跑到业务逻辑，
# 就是因为判据坏了却没有任何守卫能发现（2026-08-17 诊断）。

# extract_agent_id LOGCAT_TEXT
#   从 logcat 文本提取最后一条 `agent started — agentId=<uuid>` 的 uuid，无匹配输出空。
#   只认 `agentId=<uuid>`、**不匹配那个 em dash**：rog 上经 PowerShell 看日志时
#   codepage 936 会把它破坏成 U+9225 U+003F（08-17 实测），判据不该建立在这种字符上。
extract_agent_id() {
  printf '%s\n' "${1:-}" \
    | grep -oE 'agentId=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
    | tail -1 | sed -E 's/^agentId=//'
}

# resolve_live_agent_id FETCH_CMD COLDSTART_CMD
#   两阶段取 agent_id：
#     ① 先用 FETCH_CMD 读当前 logcat —— 设备刚启动过时零副作用命中；
#     ② 读不到说明启动日志已被环形缓冲冲掉（第四台实测 16MB 缓冲但 98MB readable，
#        load avg 11.6 刷屏极快，几小时前的日志必然没了），此时调 COLDSTART_CMD
#        重启 agent 让日志重新产生，再读一次。
#   两次都读不到 → 输出空并返回非 0，由调用方 envfail。绝不返回假 uuid：任务派给
#   错的 agent_id 会让采集永远 status=pending 卡死，表面像"采集坏了"实则派错对象
#   （2026-07-09 / 07-16 两次真机踩过）。
resolve_live_agent_id() {
  local fetch_cmd="$1" coldstart_cmd="$2" out
  out=$(extract_agent_id "$("$fetch_cmd")")
  if [ -n "$out" ]; then printf '%s' "$out"; return 0; fi
  out=$(extract_agent_id "$("$coldstart_cmd")")
  printf '%s' "$out"
  [ -n "$out" ]
}

# parse_ui_bounds UI_XML TEXT
#   从 uiautomator dump 的 xml 里找**含 TEXT 的那个节点**，输出其 bounds 中心 "x y"。
#   无匹配 / 节点缺 bounds → 输出空（调用方跳过点击，不崩）。
#   必须按 bounds 解析而非截图估坐标：同一页面常有多个同类控件，估坐标必点错
#   （08-17 实测——目标开关上方就有另一个开关）。也必须按文案定位而非取第一个节点。
parse_ui_bounds() {
  local xml="${1:-}" want="${2:-}" line nums x1 y1 x2 y2
  line=$(printf '%s\n' "$xml" | tr '<' '\n' | grep -F "$want" | head -1)
  [ -n "$line" ] || return 0
  nums=$(printf '%s' "$line" \
    | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1 \
    | grep -oE '[0-9]+')
  [ -n "$nums" ] || return 0
  read -r x1 y1 x2 y2 <<< "$(printf '%s' "$nums" | tr '\n' ' ')"
  [ -n "${x2:-}" ] && [ -n "${y2:-}" ] || return 0
  printf '%s %s' "$(( (x1 + x2) / 2 ))" "$(( (y1 + y2) / 2 ))"
}

# `source line02-android-collect-realmachine-smoke.sh --source-only` 时到此为止，不跑真机主流程。
if [ "${1:-}" = "--source-only" ]; then
  return 0 2>/dev/null || exit 0
fi

main() {
ADB="${ADB:-adb}"
API_BASE="${API_BASE:-https://staging-autopilot.zenjoymedia.media}"
TENANT="${SMOKE_TENANT:-455a8ca9-5f63-4286-83ce-c5cca04cfd58}"
AGENT_ID="${SMOKE_AGENT:-a7a7b36c-6d05-4653-8ba1-83c1553ef5c7}"
KW="${SMOKE_KW:-装修}"
POLL_MAX="${POLL_MAX:-30}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Line02 agent-android 采集真机 smoke"
echo "  KW=$KW  API=$API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. 环境自检(区分"环境未就绪"与"采集失败") ────────────────────────
command -v jq >/dev/null 2>&1 || envfail "runner 缺 jq"
# WiFi-adb 掉线自愈(task c0efdb69)：四号机夜里息屏后掉线，先重连再判在线，止住 nightly 连红。
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/ensure-device-online.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/adb-target.sh"
ensure_device_online "$ADB" "${ANDROID_ADB_ENDPOINT:-}" \
  || envfail "无 Android 设备在线(adb devices 无 'device' 行；重连 ${ANDROID_ADB_ENDPOINT:-未配端点} 后仍失败)"
# 绑定唯一目标设备后再动手：adb server 每次重启会通过 mDNS 自动为同一台手机再加
# 一个 transport，此时任何不带 -s 的调用都返回 more than one device/emulator，
# 被 grep 吃成空值 → 误报"包未安装/无障碍未开"（2026-08-17 实测，且清理后会复发）。
DEV=$(select_adb_device "$ADB" "${ANDROID_ADB_ENDPOINT:-}") \
  || envfail "select_adb_device 未选出在线设备(adb devices 无 device 行)"
ok "设备在线: $DEV（后续所有 adb 调用绑定 -s）"

curl -fsSk -m 10 "$API_BASE/api/acquisition/overview" -H "X-Tenant-Id: $TENANT" >/dev/null 2>&1 \
  || envfail "staging API 不可达: $API_BASE"
ok "staging API 可达"

# 设备重装/重新注册后 agent_id(UUID)会变,SMOKE_AGENT 硬编码默认值必然漂移过期
# (2026-07-09/2026-07-16 两次真机复现同一坑:任务/seed 派给一个设备早已不再轮询的旧
# agent_id,采集永远 status=pending 卡死,表面像"采集坏了"实则是派错对象——必须在下面
# seed 之前拿到真实值,否则 seed 把错的 agent_id 绑进 license,collect/start 照样派错)。
# 设备完整跑完一次 initAgent() 后一定会打印"agent started — agentId=<uuid>"
# (AgentService.kt 收尾日志),从这里动态取当前真实身份;只有显式传了 SMOKE_AGENT 才用
# 固定值(供调试锁定某台设备用)。
if [ -z "${SMOKE_AGENT:-}" ]; then
  # 阶段①：直读当前 logcat（设备刚启动过时命中，零副作用）
  _fetch_agent_log() { "$ADB" -s "$DEV" logcat -d 2>/dev/null; }

  # 阶段②：冷启动 agent 让 initAgent 重跑，把 `agent started` 日志重新打出来。
  # 之所以需要这一步：logcat 是环形缓冲，设备跑久了旧启动日志必然被冲掉
  # （第四台实测 uptime 11 天、16MB 缓冲却有 98MB readable），而
  # 「读不到日志」并不等于「agent 没跑」——它 pid 在、心跳 online、无障碍已授权。
  # 三件事必须按序做，缺一即引入新的假红：
  #   a) 先清空并放大 logcat 缓冲：该设备刷屏极快，不清就可能刚打出来又被淹掉
  #      （dm-send-realmachine-smoke.sh :100-101 早有同样处置）
  #   b) 存下无障碍授权：荣耀在 force-stop 后会**撤销**它（08-17 实测变 null，
  #      随后 collect 与 dm 两个 job 都误报"无障碍未开"）
  #   c) 拉起后写回授权，再轮询等日志（initAgent 含中台注册往返，实测 3~20s，
  #      故用 2s 步长轮询而非固定 sleep——固定值要么白等要么不够）
  _coldstart_agent() {
    local acc_backup i
    acc_backup=$("$ADB" -s "$DEV" shell settings get secure enabled_accessibility_services 2>/dev/null | tr -d '\r')
    "$ADB" -s "$DEV" logcat -c >/dev/null 2>&1 || true
    "$ADB" -s "$DEV" logcat -G 16M >/dev/null 2>&1 || true
    "$ADB" -s "$DEV" shell am force-stop com.zenithjoy.agent >/dev/null 2>&1 || true
    "$ADB" -s "$DEV" shell monkey -p com.zenithjoy.agent -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
    if [ -n "$acc_backup" ] && [ "$acc_backup" != "null" ]; then
      "$ADB" -s "$DEV" shell settings put secure enabled_accessibility_services "$acc_backup" >/dev/null 2>&1 || true
      "$ADB" -s "$DEV" shell settings put secure accessibility_enabled 1 >/dev/null 2>&1 || true
    fi
    for i in $(seq 1 15); do   # 15×2s = 30s 上限
      sleep 2
      if "$ADB" -s "$DEV" logcat -d 2>/dev/null | grep -q 'agent started'; then break; fi
    done
    "$ADB" -s "$DEV" logcat -d 2>/dev/null
  }

  LIVE_AGENT=$(resolve_live_agent_id _fetch_agent_log _coldstart_agent)
  if [ -n "$LIVE_AGENT" ]; then
    AGENT_ID="$LIVE_AGENT"
    ok "动态取到设备当前真实 agent_id=$AGENT_ID（非硬编码默认值）"
  else
    envfail "取不到 agent_id：直读 logcat 无 'agent started' 记录，冷启动 agent 后 30s 内仍未打出（查 initAgent 是否卡在中台注册，或无障碍授权是否被撤销未写回）"
  fi
fi

# ── 0. 自愈: 幂等 seed 固定测试租户(抗 staging DB 重置) ─────────────────
# 真机 smoke 硬编码固定租户/agent,环境隔离重置 zenithjoy_test 会冲掉→collect/start 外键 500。
# 派任务前先幂等补齐,DB 重置后自动恢复,不再靠人工 seed。seed 失败=服务端/环境问题,非采集红。
SMOKE_TOKEN="${SMOKE_TOKEN:-smoke-secret-2026}"
SEED=$(curl -sSk -m 15 -X POST "$API_BASE/api/_smoke/acquisition-seed" \
  -H "Content-Type: application/json" -H "X-Smoke-Token: $SMOKE_TOKEN" \
  -d "{\"tenant_id\":\"$TENANT\",\"agent_id\":\"$AGENT_ID\"}" \
  -w $'\n%{http_code}' 2>&1)
SEED_CODE=$(printf '%s' "$SEED" | tail -n1)
[ "$SEED_CODE" = "200" ] \
  || envfail "seed 自愈失败(http=$SEED_CODE): $(printf '%s' "$SEED" | head -c 300)"
ok "seed 自愈 OK (tenant=$TENANT)"

# 覆盖安装 / 息屏后 agent 进程可能是空壳(无采集轮询)——今天真机踩过的坑,主动拉起。
# 无障碍权限覆盖安装后保留,无需重新授权采集(截图授权是判定链的事,不影响采集)。
"$ADB" -s "$DEV" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
"$ADB" -s "$DEV" shell input swipe 540 2000 540 600 200 >/dev/null 2>&1 || true
"$ADB" -s "$DEV" shell monkey -p com.zenithjoy.agent -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
# 采集前把抖音复位到干净态(根治前一轮残留栈导致的 NO_SEARCH_INPUT/SEARCH_TIMEOUT)
"$ADB" -s "$DEV" shell am force-stop com.ss.android.ugc.aweme >/dev/null 2>&1 || true
sleep 6
ACC=$("$ADB" -s "$DEV" shell settings get secure enabled_accessibility_services 2>/dev/null)
case "$ACC" in *com.zenithjoy.agent*) ok "无障碍已开";; *) envfail "无障碍未开(采集依赖):$ACC";; esac

# ── 1.5 MediaProjection 自动授权（Seg2 判定截图的前提，承接未合的 PR #1312）──
# 判定链要逐视频截图，依赖 MediaProjection 授权；该授权在 app 进程重启后必然丢失
# （08-17 实测第四台与小黄的 dumpsys media_projection 都是 null，而小黄从未被
# force-stop 过 → 说明这是普遍长期状态，不是某次操作的后果）。agent MainActivity
# 上有「授权截屏」按钮，这里用 uiautomator 定位并自动点掉它 + 随后的系统弹框，
# 省掉此前"必须有人在手机上点一次"的人工步骤。
#
# 失败只警告、**不 envfail**：采集主链路不依赖截图授权（见上方注释"截图授权是
# 判定链的事,不影响采集"），judged=0 该由下方 Seg2 判定闸去报——授权段抢先把
# 整个 job 判死只会造出一个新的假红源，那正是本次修复要消灭的东西。
# _tap_by_text <设备上的dump路径> <文案...>
#   dump 当前界面 → 按文案找节点 → 点它的 bounds 中心。任一文案命中即返回 0。
#
# 三个真机必需条件（2026-08-17 真机实测踩出，PR #1312 原版都缺，缺了授权段就是死代码）：
#   1) MSYS_NO_PATHCONV=1：workflow 用 git bash，`/sdcard/xxx` 会被 MSYS 路径转换成
#      `C:/Program Files/Git/sdcard/xxx`，dump 压根没落到设备上（实测 ls 报
#      "ls: C:/Program: No such file or directory"）
#   2) 带重试：界面在动时 dump 报 "ERROR: could not get idle state."（实测抖音
#      SplashActivity 动画期间必失败），需等它静下来再试
#   3) 用 exec-out 读而非 shell cat：实测 shell cat 拿到 0 字节，exec-out 拿到 8537 字节
_tap_by_text() {   # _tap_by_text <设备上的dump路径> <文案...>
  local dump="$1"; shift
  local xml word xy i out
  for i in 1 2 3; do
    out=$(MSYS_NO_PATHCONV=1 "$ADB" -s "$DEV" shell uiautomator dump "$dump" 2>&1 | tr -d '\r')
    case "$out" in *"dumped to"*) break ;; esac
    sleep 3   # could not get idle state —— 界面还在动，等一下重试
  done
  xml=$(MSYS_NO_PATHCONV=1 "$ADB" -s "$DEV" exec-out cat "$dump" 2>/dev/null)
  [ -n "$xml" ] || { echo "  [MediaProjection] dump 读不到界面（$out）"; return 1; }
  for word in "$@"; do
    xy=$(parse_ui_bounds "$xml" "$word")
    if [ -n "$xy" ]; then
      echo "  [MediaProjection] 点击「$word」at ($xy)"
      # shellcheck disable=SC2086
      "$ADB" -s "$DEV" shell input tap $xy >/dev/null 2>&1 || true
      return 0
    fi
  done
  return 1
}

# 「授权截屏」按钮在 agent 自己的 MainActivity 上——dump 前必须把它拉到前台，否则
# dump 到的是抖音（真机实测当时前台是 aweme/SplashActivity，界面里根本没这个按钮）。
"$ADB" -s "$DEV" shell monkey -p com.zenithjoy.agent -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
sleep 4

if _tap_by_text /sdcard/zj_ui.xml '授权截屏'; then
  sleep 2
  # 系统截屏授权弹框：中文机型是「立即开始」，部分 ROM/语言是「允许」/英文
  _tap_by_text /sdcard/zj_allow.xml '立即开始' '允许' 'Allow' 'Start now' || true
  sleep 2
  ok "MediaProjection 授权流程已触发（judged>0 即为授权成功）"
else
  echo "  [MediaProjection] 未见「授权截屏」按钮（可能已授权，或当前界面不符）"
fi

# ── 2. 派"装修"任务(collect/start) ───────────────────────────────────
RESP=$(curl -fsSk -m 15 -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT" \
  -d "{\"keywords\":[\"$KW\"],\"agent_id\":\"$AGENT_ID\"}" 2>&1)
TASK=$(echo "$RESP" | jq -r '.data.task_id // .data.id // empty' 2>/dev/null)
[ -n "$TASK" ] || envfail "collect/start 未返回 task_id(API 异常): $RESP"
ok "派任务 task_id=$TASK"

# ── 3. 轮询任务终态 ──────────────────────────────────────────────────
STATUS=""; VC=0
for i in $(seq 1 "$POLL_MAX"); do
  J=$(curl -fsSk -m 10 "$API_BASE/api/acquisition/collect/$TASK" -H "X-Tenant-Id: $TENANT" 2>/dev/null)
  STATUS=$(echo "$J" | jq -r '.data.status // empty')
  VC=$(echo "$J" | jq -r '.data.video_count // 0')
  echo "  [$i/$POLL_MAX] status=$STATUS video_count=$VC"
  case "$STATUS" in
    done|completed) break;;
    failed|error|cancelled)
      EC=$(curl -fsSk -m 10 "$API_BASE/api/acquisition/collect-tasks/$TASK/videos" -H "X-Tenant-Id: $TENANT" 2>/dev/null | jq -r '.data.task.error_code // "?"')
      fail "采集任务终态=$STATUS error_code=$EC —— 采集链断(广告abort/多卡STEP1_no_card/SEARCH_TIMEOUT 复发?查 logcat DouyinCollectService)";;
  esac
  sleep 10
done
case "$STATUS" in done|completed) : ;; *) fail "采集未在 $((POLL_MAX*10))s 内完成(status=$STATUS,疑似卡死)";; esac

# ── 4. 断言:collected≥2 + ≥2 真实 video_id 落库 ──────────────────────
# videos 端点结构:{success, data:{videos:[{video_id,...}], total, task:{status,...}}}——注意 .data 层
VIDEOS=$(curl -fsSk -m 10 "$API_BASE/api/acquisition/collect-tasks/$TASK/videos" -H "X-Tenant-Id: $TENANT" 2>/dev/null)
COUNT=$(echo "$VIDEOS" | jq '.data.videos | length' 2>/dev/null || echo 0)
[ "${COUNT:-0}" -ge 2 ] \
  || fail "collected=$COUNT < 2 —— 多卡采集退化(navback 回列表/abort 复发,只采到第一张)"
REAL=$(echo "$VIDEOS" | jq -r '.data.videos[].video_id // empty' 2>/dev/null | grep -cE '^[0-9]{15,}$')
[ "${REAL:-0}" -ge 2 ] \
  || fail "真实 video_id 数=$REAL < 2 —— share_url 取链/服务端 302 解析退化(造假 id?)"

ok "采集 $COUNT 个、$REAL 个真实 video_id 落库 —— agent-android 采集健康"

# ── 5. Seg2 判定：轮询等判定跑起来(judged≥1)，不等"全部非pending" ──
# 判定 = agent 逐视频截图→POST /judge-video→Gemini 异步触发，依赖 MediaProjection 授权。
# 授权失效→capture_type=skipped_capture_failed→judgment_status 恒 pending(handoff 风险①:判定虚过)。
# 注意:合法留 pending 的分支不止授权失效(force_timeout/no_api_key/Gemini error),故用 judged≥1
# 且 pending 数稳定作退出,不等全部非 pending(否则某视频永久 pending 会白烧满窗口)。
JUDGED=0; MATCHED=0; LAST_PENDING=-1; STABLE=0; CURLFAIL=0
for i in $(seq 1 18); do   # 18×10s = 3min 上限
  VJ=$(curl -fsSk -m 10 "$API_BASE/api/acquisition/collect-tasks/$TASK/videos" -H "X-Tenant-Id: $TENANT" 2>/dev/null)
  # 判定轮询途中 API 连续不可达 = 环境噪音,走 envfail 分级(exit 3),不误报成判定bug硬红
  if [ -z "$VJ" ]; then
    CURLFAIL=$((CURLFAIL+1))
    echo "  [判定 $i/18] videos 端点无响应(连续第 $CURLFAIL 次)"
    [ "$CURLFAIL" -ge 3 ] && envfail "判定轮询期间 staging API 连续 $CURLFAIL 次不可达(环境噪音,非判定bug)"
    sleep 10; continue
  fi
  CURLFAIL=0
  PENDING=$(echo "$VJ" | jq '[.data.videos[]|select(.judgment_status=="pending")]|length' 2>/dev/null || echo "$COUNT")
  NEWMATCHED=$(echo "$VJ" | jq '[.data.videos[]|select(.judgment_status=="matched")]|length' 2>/dev/null || echo 0)
  NEWJUDGED=$(echo "$VJ" | jq '[.data.videos[]|select(.judgment_status!="pending")]|length' 2>/dev/null || echo 0)
  # 判定单调(pending→matched/rejected 不回退),MATCHED/JUDGED 保留峰值,防末轮 jq 瞬断归零→误判全rejected假绿
  [ "${NEWMATCHED:-0}" -gt "${MATCHED:-0}" ] && MATCHED=$NEWMATCHED
  [ "${NEWJUDGED:-0}" -gt "${JUDGED:-0}" ] && JUDGED=$NEWJUDGED
  echo "  [判定 $i/18] judged=$JUDGED matched=$MATCHED pending=$PENDING"
  [ "${PENDING:-1}" -eq 0 ] && break
  if [ "${JUDGED:-0}" -ge 1 ]; then
    if [ "${PENDING:-1}" -eq "${LAST_PENDING:--1}" ]; then STABLE=$((STABLE+1)); else STABLE=0; fi
    [ "$STABLE" -ge 2 ] && break
  fi
  LAST_PENDING=$PENDING
  sleep 10
done
[ "${JUDGED:-0}" -ge 1 ] \
  || fail "判定链未跑:$COUNT 视频全 pending ——疑 MediaProjection 授权失效/agent 未上报 /judge-video(handoff 风险①,判定虚过)"
ok "Seg2 判定完成 judged=$JUDGED matched=$MATCHED"

# ── 6. Seg3 抓评论者→acquisition_leads(仅当有 matched,判定放行才进 Stage2) ──
if [ "${MATCHED:-0}" -ge 1 ]; then
  LEADS=0
  for i in $(seq 1 18); do   # 3min
    LC=$(curl -fsSk -m 10 "$API_BASE/api/acquisition/collect/$TASK" -H "X-Tenant-Id: $TENANT" 2>/dev/null | jq -r '.data.lead_count_raw // 0' 2>/dev/null)
    echo "  [抓评论 $i/18] lead_count_raw=$LC"
    [ "${LC:-0}" -gt 0 ] && { LEADS=$LC; break; }
    sleep 10
  done
  [ "${LEADS:-0}" -gt 0 ] \
    || fail "有 $MATCHED 个 matched 但 lead_count_raw=0 ——Seg2→Seg3 接线断(Stage2 抓评论未触发/未落 acquisition_leads)"
  ok "Seg3 抓评论者 lead_count_raw=$LEADS"

  # ── Seg3 语义质量零容忍闸门 ──
  # ssh hk-vps 环境问题（网络/连接失败/psql报错混入stdout）此前会被悄悄吞成空数组，
  # checkLeadQuality([]) 对空输入返回 passed:true+profile_url_coverage:0，会触发下方
  # profile_url 覆盖率硬闸误报"方案A未落地"——把环境问题误判成产品缺陷硬红。此处先用
  # ssh退出码+JSON合法性做 envfail 分级（2026-08-04 审计发现）。
  LEADS_JSON_RAW=$(ssh hk-vps "docker exec zenithjoy-db-postgres psql -U zenithjoy -d zenithjoy_staging -t -c \
    \"SELECT json_agg(json_build_object('nickname', nickname, 'comment_text', comment_text, 'sec_uid', sec_uid, 'profile_url', profile_url)) \
      FROM zenithjoy.acquisition_leads WHERE collect_task_id = '$TASK' AND tenant_id = '$TENANT'\"")
  SSH_EXIT=$?
  [ "$SSH_EXIT" -eq 0 ] || envfail "ssh hk-vps 取 Seg3 leads 语义质量数据失败(exit=$SSH_EXIT)——环境不可达，非采集/语义质量缺陷"
  LEADS_JSON=$(echo "$LEADS_JSON_RAW" | tr -d '\n' | trim_json_stdin)
  # LEADS 在上面已确认 >0（真有 leads落库），此处若解析不出非空数组，大概率是
  # ssh/psql 输出被污染（连接问题/报错文本混入 stdout），而非真的没有 leads——
  # 不能悄悄放行进 checkLeadQuality([])（对空输入按"合法"处理，会把环境问题
  # 误判成 profile_url 覆盖率不足的产品缺陷）。
  echo "$LEADS_JSON" | node -e "
let d='';process.stdin.on('data',c=>d+=c);
process.stdin.on('end',()=>{
  const arr = JSON.parse(d.trim());
  if (!Array.isArray(arr) || arr.length === 0) process.exit(1);
});
" 2>/dev/null || envfail "ssh hk-vps 返回内容非合法非空 JSON 数组（LEADS=$LEADS 已确认>0，此处应有数据）——疑 ssh/psql 输出被污染: $(echo "$LEADS_JSON" | head -c 200)"

  QUALITY_RESULT=$(echo "$LEADS_JSON" | node -e "
const {checkLeadQuality} = require('./.github/workflows/scripts/smoke/lib/lead-quality-gate.cjs');
let data = ''; process.stdin.on('data', d => data += d);
process.stdin.on('end', () => {
  const leads = JSON.parse(data.trim() || '[]');
  const result = checkLeadQuality(leads || []);
  console.log(JSON.stringify(result));
});
")

  QUALITY_PASSED=$(echo "$QUALITY_RESULT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d.trim()).passed))")
  if [ "$QUALITY_PASSED" != "true" ]; then
    echo "[FAIL] Seg3 语义质量检查失败，命中垃圾特征："
    echo "$QUALITY_RESULT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>JSON.parse(d.trim()).violations.forEach(v=>console.log('  命中: '+v.field+'='+v.value+' 原因: '+v.reason)))"
    fail "Seg3 语义质量零容忍——acquisition_leads 含 UIA 元数据（详见上方命中列表）"
  fi
  # profile_url 覆盖率硬闸：方案A 下无 sec_uid 时 profile_url=昵称，覆盖率须 100%。
  # 若 < 100% = 后端未落 Fix4（无 sec_uid 时 profile_url 仍 null），私信链仍死。
  PROFILE_URL_COV=$(echo "$QUALITY_RESULT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d.trim()).profile_url_coverage))")
  PROFILE_URL_PASS=$(node -e "process.exit(parseFloat('${PROFILE_URL_COV}')>=1.0?0:1)" 2>/dev/null && echo "ok" || echo "fail")
  [ "$PROFILE_URL_PASS" = "ok" ] \
    || fail "Seg3 profile_url 覆盖率 ${PROFILE_URL_COV} < 100%——方案A 未落地（无 sec_uid 时 profile_url 应=昵称，当前仍 null → dispatchDue 跳过 → 私信链死）"
  ok "Seg3 语义质量+profile_url 覆盖率检查通过（profile_url_coverage=${PROFILE_URL_COV}=100%）"

  # ── 7. Seg4 私信派单→dm_assignments ──
  DISP=0
  for i in $(seq 1 12); do   # 2min
    DP=$(curl -fsSk -m 10 "$API_BASE/api/acquisition/dispatch/plan" -H "X-Tenant-Id: $TENANT" 2>/dev/null | jq -r '.data.total // 0' 2>/dev/null)
    echo "  [私信派单 $i/12] dispatch_plan_total=$DP"
    [ "${DP:-0}" -gt 0 ] && { DISP=$DP; break; }
    sleep 10
  done
  [ "${DISP:-0}" -gt 0 ] \
    || fail "有 leads 但 dispatch/plan.total=0 ——Seg3→Seg4 接线断(buildAssignments/dispatchDue 未建私信单)"
  ok "Seg4 私信单已建 dispatch_plan_total=$DISP"
else
  echo "🟡 无 matched 视频(全 rejected 或仍有 pending)——Seg3/4 无匹配可验:判定链正常工作但无命中(非 bug,非红)"
fi

# 收尾信息按实际执行到的分支输出，不用一句话掩盖"本轮只验了一半"的事实
# （2026-08-04 审计发现：此前无论 MATCHED 是否 >=1 都无条件打印"Seg1-4 全通过"）
if [ "${MATCHED:-0}" -ge 1 ]; then
  echo "🎉 PASS: agent-android 挖客链路 Seg1-4 端到端接线全通过(task=$TASK)"
else
  echo "🎉 PASS: agent-android 挖客链路 Seg1-2 验证通过(task=$TASK)——Seg3/4(抓评论/私信派单)因本轮无 matched 视频未触发验证，判定链本身工作正常，只是没命中"
fi
}

[ "${BASH_SOURCE[0]}" = "${0}" ] && main "$@"
