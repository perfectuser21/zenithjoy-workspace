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

# 设备重装/重新注册后 agent_id(UUID)会变,SMOKE_AGENT 硬编码默认值必然漂移过期
# (2026-07-09/2026-07-16 两次真机复现同一坑:任务/seed 派给一个设备早已不再轮询的旧
# agent_id,采集永远 status=pending 卡死,表面像"采集坏了"实则是派错对象——必须在下面
# seed 之前拿到真实值,否则 seed 把错的 agent_id 绑进 license,collect/start 照样派错)。
# 设备完整跑完一次 initAgent() 后一定会打印"agent started — agentId=<uuid>"
# (AgentService.kt 收尾日志),从这里动态取当前真实身份;只有显式传了 SMOKE_AGENT 才用
# 固定值(供调试锁定某台设备用)。
if [ -z "${SMOKE_AGENT:-}" ]; then
  LIVE_AGENT=$("$ADB" logcat -d 2>/dev/null | grep -oE 'agent started — agentId=[a-f0-9-]{36}' | tail -1 | sed -E 's/.*agentId=//')
  if [ -n "$LIVE_AGENT" ]; then
    AGENT_ID="$LIVE_AGENT"
    ok "动态取到设备当前真实 agent_id=$AGENT_ID（非硬编码默认值）"
  else
    envfail "logcat 里找不到 'agent started — agentId=' 记录，设备可能从没跑完 initAgent（无障碍/截图授权后需强杀重启 App 让 initAgent 冷启动跑一遍，重启AGENT服务按钮在进程存活时不会重跑已初始化的轮询循环）"
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
  LEADS_JSON=$(ssh hk-vps "docker exec zenithjoy-db-postgres psql -U zenithjoy -d zenithjoy_staging -t -c \
    \"SELECT json_agg(json_build_object('nickname', nickname, 'comment_text', comment_text, 'sec_uid', sec_uid, 'profile_url', profile_url)) \
      FROM zenithjoy.acquisition_leads WHERE collect_task_id = '$TASK' AND tenant_id = '$TENANT'\"" | tr -d '\n' | xargs)

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

echo "🎉 PASS: agent-android 挖客链路 Seg1-4 端到端接线全通过(task=$TASK)"
