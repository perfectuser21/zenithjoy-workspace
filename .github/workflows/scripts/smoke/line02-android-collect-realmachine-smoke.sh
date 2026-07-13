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

ok()      { echo "✅ $1"; }
fail()    { echo "❌ 采集验证失败: $1"; exit 1; }   # 采集真坏 → 硬红,阻塞 PR
envfail() { echo "🟠 环境未就绪(非采集 bug,查设备/staging/agent): $1"; exit 3; }  # 环境噪音 → 红但可辨

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
"$ADB" devices 2>/dev/null | grep -qE '[[:space:]]device$' \
  || envfail "无 Android 设备在线(adb devices 无 'device' 行)"
DEV=$("$ADB" devices 2>/dev/null | awk '/[[:space:]]device$/{print $1; exit}')
ok "设备在线: $DEV"

curl -fsSk -m 10 "$API_BASE/api/acquisition/overview" -H "X-Tenant-Id: $TENANT" >/dev/null 2>&1 \
  || envfail "staging API 不可达: $API_BASE"
ok "staging API 可达"

# 覆盖安装 / 息屏后 agent 进程可能是空壳(无采集轮询)——今天真机踩过的坑,主动拉起。
# 无障碍权限覆盖安装后保留,无需重新授权采集(截图授权是判定链的事,不影响采集)。
"$ADB" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
"$ADB" shell input swipe 540 2000 540 600 200 >/dev/null 2>&1 || true
"$ADB" shell monkey -p com.zenithjoy.agent -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
# 采集前把抖音复位到干净态(根治前一轮残留栈导致的 NO_SEARCH_INPUT/SEARCH_TIMEOUT)
"$ADB" shell am force-stop com.ss.android.ugc.aweme >/dev/null 2>&1 || true
sleep 6
ACC=$("$ADB" shell settings get secure enabled_accessibility_services 2>/dev/null)
case "$ACC" in *com.zenithjoy.agent*) ok "无障碍已开";; *) envfail "无障碍未开(采集依赖):$ACC";; esac

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
      EC=$(curl -fsSk -m 10 "$API_BASE/api/acquisition/collect-tasks/$TASK/videos" -H "X-Tenant-Id: $TENANT" 2>/dev/null | jq -r '.task.error_code // "?"')
      fail "采集任务终态=$STATUS error_code=$EC —— 采集链断(广告abort/多卡STEP1_no_card/SEARCH_TIMEOUT 复发?查 logcat DouyinCollectService)";;
  esac
  sleep 10
done
case "$STATUS" in done|completed) : ;; *) fail "采集未在 $((POLL_MAX*10))s 内完成(status=$STATUS,疑似卡死)";; esac

# ── 4. 断言:collected≥2 + ≥2 真实 video_id 落库 ──────────────────────
VIDEOS=$(curl -fsSk -m 10 "$API_BASE/api/acquisition/collect-tasks/$TASK/videos" -H "X-Tenant-Id: $TENANT" 2>/dev/null)
COUNT=$(echo "$VIDEOS" | jq '[.videos[]? // .data[]?] | length' 2>/dev/null || echo 0)
[ "${COUNT:-0}" -ge 2 ] \
  || fail "collected=$COUNT < 2 —— 多卡采集退化(navback 回列表/abort 复发,只采到第一张)"
REAL=$(echo "$VIDEOS" | jq -r '[.videos[]?,.data[]?] | .[].video_id // empty' 2>/dev/null | grep -cE '^[0-9]{15,}$')
[ "${REAL:-0}" -ge 2 ] \
  || fail "真实 video_id 数=$REAL < 2 —— share_url 取链/服务端 302 解析退化(造假 id?)"

ok "采集 $COUNT 个、$REAL 个真实 video_id 落库 —— agent-android 采集健康"
echo "🎉 PASS: agent-android 抖音采集真机端到端通过(task=$TASK)"
