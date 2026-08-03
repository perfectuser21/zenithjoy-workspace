#!/usr/bin/env bash
# account-scan-realmachine-smoke.sh
#
# 真机验证车道（刀D）—— account-scan Golden Path 的第一个真机 gate。
# 链路：adb install -r 最新APK(覆盖装,不卸载,保住注册态) → 开无障碍服务 → 动态定位设备
# 真实 agent_id(hostname型号+last_heartbeat_at最新,查无兜底 logcat) → 触发
# POST /api/acquisition/account-scan/trigger → 轮询 zenithjoy.publish_tasks 终态 →
# 两段式联合断言(status='done' AND account_ids 非空) → 绿/红。
#
# 三态区分（跟进 line02-android-collect-realmachine-smoke.sh 既有约定）：
#   ok()      — 阶段性成功提示
#   fail()    — 真机验证真的失败，exit 1（阻塞 PR/nightly 红）
#   envfail() — 环境未就绪（无设备/API不可达等噪音），exit 3（区分于真验证失败）
#
# 两段式终态断言抽成一个纯函数（见下方定义），可被
# `source account-scan-realmachine-smoke.sh --source-only` 单独加载后调用，不触发真机主
# 流程（guard: `[ "${BASH_SOURCE[0]}" = "${0}" ] && main "$@"`）——防止退化成"只查
# 账号列表就判绿"的假绿模式（PRD 原始 bug：Step30 历史 bug 的翻版）。
#
# 环境变量（workflow 注入，可本地覆盖）：
#   ADB            adb 可执行路径（默认 adb）
#   API_BASE       staging API base（默认 https://staging-autopilot.zenjoymedia.media）
#   SMOKE_TENANT   测试租户（默认真机测试租户）
#   DB_SSH_HOST    真机 DB 所在 SSH host（默认 vps-hk——注意别名顺序！xian-rog
#                  runner 的 ~/.ssh/config 里配的别名是 "vps-hk"，不是更符合直觉的
#                  "hk-vps"；两者拼写只是词序颠倒，旧默认值 "hk-vps" 在 xian-rog 上
#                  会 `ssh: Could not resolve hostname`，且被 `2>/dev/null` 吞掉，
#                  表现为"DB 查无匹配"而非明显的连接错误，2026-07-30 首次真机验证到
#                  这一步才发现）
#   POLL_MAX       轮询次数（默认 18）
#   POLL_INTERVAL  轮询间隔秒（默认 10，18×10s=3分钟预算）
#   ANDROID_APK_COS_URL  安装包公网 COS 直链（默认 http://apk.zenjoymedia.media/install-pack/android/zenithjoy-agent.apk，
#                  与服务端 apps/api/src/routes/agent-install-pack.ts 的同名兜底常量保持一致约定）
set -uo pipefail

ok()      { echo "✅ $1"; }
fail()    { echo "❌ 真机验证失败: $1"; exit 1; }
envfail() { echo "🟠 环境未就绪(非真机验证bug,查设备/staging/DB): $1"; exit 3; }

# assert_task_terminal_success STATUS RESPONSE_JSON
# 两段式联合断言：先判 STATUS=='done'，再判 RESPONSE_JSON.account_ids 非空数组。
# 返回 0 = 真通过；返回 1 = 判红。STATUS 非 done 时直接返回 1，不看 account_ids
# ——防止"status=failed 但 account_ids 恰好非空(脏数据/上次运行残留)"被误判为绿。
assert_task_terminal_success() {
  local status="$1"
  local response="${2:-}"

  # 第一段：STATUS 必须是 done，非 done 一律判红（不进入 account_ids 检查分支）
  [ "$status" = "done" ] || return 1

  # 第二段：account_ids 必须是非空数组（真读到账号）
  local acct_count
  acct_count=$(printf '%s' "$response" | jq -r '(.account_ids // []) | length' 2>/dev/null)
  case "$acct_count" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$acct_count" -ge 1 ] || return 1

  return 0
}

main() {
  # ── ADB 解析（decision 2f11ae25 配套：裸 adb 不在 runner PATH 时静默失败被误报"无设备"）──
  # 未显式传入时探测：glob scrcpy 自带 adb 优先（e2e-line02-android-collect.yml 已验证顺序；
  # sort -V 防 3.10<3.2 字典序取旧版），command -v 兜底；全失败=独立 envfail 文案。
  if [ -z "${ADB:-}" ]; then
    ADB=$(ls /c/Users/*/AppData/Local/Microsoft/WinGet/Packages/Genymobile.scrcpy_*/scrcpy-*/adb.exe 2>/dev/null | sort -V | tail -1 || true)
    [ -n "$ADB" ] || ADB=$(command -v adb 2>/dev/null || true)
    [ -n "$ADB" ] || envfail "runner 上找不到 adb"
  fi
  API_BASE="${API_BASE:-https://staging-autopilot.zenjoymedia.media}"
  TENANT="${SMOKE_TENANT:-455a8ca9-5f63-4286-83ce-c5cca04cfd58}"
  DB_SSH_HOST="${DB_SSH_HOST:-vps-hk}"
  POLL_MAX="${POLL_MAX:-18}"
  POLL_INTERVAL="${POLL_INTERVAL:-10}"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  account-scan 真机验证车道 smoke"
  echo "  API=$API_BASE"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # ── 环境自检（区分"环境未就绪"与"真机验证真的失败"） ────────────────
  command -v jq >/dev/null 2>&1 || envfail "runner 缺 jq"

  # 无论显式传入还是探测所得，先证 adb 本身可用（坏驱动/坏路径不该被误报成"无设备"）
  ADB_VER_ERR=$("$ADB" version 2>&1 >/dev/null) \
    || envfail "adb 不可用: ${ADB_VER_ERR:-unknown}（ADB=${ADB}）"

  "$ADB" devices 2>/dev/null | grep -qE '[[:space:]]device$' \
    || envfail "无 Android 设备在线(adb devices 无 'device' 行)"
  DEV=$("$ADB" devices 2>/dev/null | awk '/[[:space:]]device$/{print $1; exit}')
  ok "设备在线: $DEV"

  curl -fsSk -m 10 "$API_BASE/api/acquisition/overview" -H "X-Tenant-Id: $TENANT" >/dev/null 2>&1 \
    || envfail "staging API 不可达: $API_BASE"
  ok "staging API 可达"

  # ── Step 1: adb install -r 覆盖安装最新 APK（不卸载，保住注册态）+ 开无障碍服务 ──
  # 修复 PR#1558 遗留 bug（task 1d087bfe-cf40-4d28-a5b4-76383565510e）：不再走
  # GET /api/agent/install-pack/android —— 该端点是给浏览器登录客户用的 better-auth
  # session cookie 鉴权端点（apps/api/src/routes/agent-install-pack.ts:360-372，
  # auth.api.getSession() 未登录返回 401；android-onboarding-smoke.sh:7-10 已明确
  # 断言"无 session → 401"本身是设计行为）。CI self-hosted runner（xian-rog）没有
  # 浏览器 session，这个 401 是结构性必然的，导致 Step 1 从未真正走到过 adb 层。
  # 改为直连公网 COS 直链——与服务端 agent-install-pack.ts:390-393 的兜底常量、
  # 及 ANDROID_APK_COS_URL 覆盖约定保持一致（该端点本身也只是把这个常量原样透传
  # 回 apk_url 字段，鉴权对拿到的地址没有任何增值，直连更简单也更可靠）。
  APK_URL="${ANDROID_APK_COS_URL:-http://apk.zenjoymedia.media/install-pack/android/zenithjoy-agent.apk}"

  # mktemp 不带后缀+事后自己拼 .apk：BSD mktemp（macOS）不支持"X序列后跟非X后缀"
  # 模板（会整段当字面量、不做随机替换，导致重复调用时literal文件已存在而报错）；
  # GNU mktemp（Linux CI/Windows Git-Bash）支持但没必要依赖这个差异——不带后缀是两边通吃的写法。
  APK_TMP_BASE=$(mktemp /tmp/zj-agent-XXXXXX)
  rm -f "$APK_TMP_BASE"
  APK_TMP="${APK_TMP_BASE}.apk"
  curl -fsSk -m 60 -o "$APK_TMP" "$APK_URL" || envfail "APK 下载失败: $APK_URL"

  # 下载后基本校验（防"curl exit 0 但内容是 403/html 错误页"被当成合法 APK 传给
  # adb install——退回不带内容校验时这类问题只会在 adb install 报一个无关的失败信息，
  # 排查者要重新手动下载才能发现，浪费一轮真机排查）：
  #   1) 非空文件  2) zip/APK magic bytes 'PK'（.apk 本质是 zip 容器）
  APK_SIZE=$(wc -c < "$APK_TMP" 2>/dev/null | tr -d ' ')
  case "$APK_SIZE" in
    ''|0)
      rm -f "$APK_TMP"
      envfail "下载的 APK 文件为空(0字节或读取失败): $APK_URL"
      ;;
  esac
  APK_MAGIC=$(head -c 2 "$APK_TMP" 2>/dev/null)
  if [ "$APK_MAGIC" != "PK" ]; then
    APK_PREVIEW=$(head -c 200 "$APK_TMP" 2>/dev/null | tr -d '\0')
    rm -f "$APK_TMP"
    envfail "下载的文件不是合法 APK(zip magic bytes 校验失败,可能是 COS 返回了错误页而非二进制包): $APK_URL 内容预览: $APK_PREVIEW"
  fi

  # adb install -r：覆盖装不卸载，保住设备已有的注册态(agent_id/绑定关系不丢)
  # 不再吞掉 adb 的原始 stderr——envfail 留痕必须带上真实报错文本（如
  # INSTALL_FAILED_UPDATE_INCOMPATIBLE 签名不匹配 / INSUFFICIENT_STORAGE 等），
  # 否则每次排查都要重新登真机手跑一遍才能看到根因，白白多耗一轮时间。
  INSTALL_ERR=$("$ADB" install -r "$APK_TMP" 2>&1)
  INSTALL_CODE=$?
  rm -f "$APK_TMP"
  [ "$INSTALL_CODE" -eq 0 ] || envfail "adb install -r 失败: $INSTALL_ERR"
  ok "已覆盖安装最新 APK(adb install -r)"

  # adb install -r 触发 PACKAGE_REPLACED 会杀死正在跑的 AgentService 进程（含心跳循环）——
  # 真机复现确认（xian-rog logcat 09:57:49 实测）：pm replace 不会自动重启前台服务
  # （START_STICKY 只在系统因内存回收杀进程时触发重建，包替换是受控终止，不算）。
  # 脚本此前从未显式拉起 App，导致心跳循环永久停摆——last_heartbeat_at 停在杀死前的
  # 最后一次值，短时间内仍落在 NO_ONLINE_ANDROID_AGENT 判定的 2 分钟新鲜窗口内，
  # account-scan/trigger 会误判"在线"成功派单，但没有活的心跳循环去拉取执行，任务永远
  # 卡 status=queued（2026-07-30 实测：task 从未被任何一次 heartbeat 拉取过，logcat
  # 全程零 "ws1 task:" 记录，同队列里还躺着两条更早的 dm_outreach 旧任务同样永久卡住，
  # 佐证这不是偶发）。
  #
  # 用 zenithjoy://bind deeplink 拉起而不是泛泛的 monkey LAUNCHER（2026-07-30 真机
  # ssh+logcat 现场排查根因）：adb install -r 不清空 App 数据，设备本地 SharedPreferences
  # 缓存的 config.apiUrl 可能仍指向生产(wss://autopilot.zenjoymedia.media/agent-ws)而非
  # staging——真机复现过一次：logcat 显示心跳确实每 30s 成功发送一条("ws1 heartbeat ok")，
  # 但连的是 wss://autopilot.zenjoymedia.media（生产），更新的是生产库 zenithjoy 而非本
  # 脚本查询的 zenithjoy_staging，导致 last_seen 新鲜度检查永远查不到新值——不是等不够久，
  # 是设备压根没在往这个库报数据，等多久都没用。MainActivity.onCreate() 的
  # parseBindDeepLink() 会在 AgentService/WsClient 首次初始化之前，把 zenithjoy://bind
  # deeplink 里的 api/license 参数写进 config，一次性从根上纠正，不依赖设备残留状态。
  # 真机复现(2026-08-03 nightly run 30786965614)：ssh 走 Tailscale DERP 中继会闪断，
  # 单次查询失败且 stderr 被吞时伪装成"查无数据"（数据实际完好）。有界重试自愈瞬断，
  # stderr 进文案区分"真查无数据"与"ssh 链路失败"。
  STAGING_LICENSE_KEY=""
  LICENSE_ERR_TEXT=""
  for LICENSE_RETRY in 1 2 3; do
    LICENSE_QUERY_ERR=$(mktemp)
    STAGING_LICENSE_KEY=$(ssh "$DB_SSH_HOST" "docker exec zenithjoy-db-postgres psql -U zenithjoy -d zenithjoy_staging -tA -c \
      \"SELECT license_key FROM zenithjoy.licenses WHERE tenant_id='${TENANT}' AND status='active' ORDER BY created_at DESC LIMIT 1\"" 2>"$LICENSE_QUERY_ERR" | tr -d '[:space:]')
    LICENSE_ERR_TEXT=$(head -c 200 "$LICENSE_QUERY_ERR" || true)
    rm -f "$LICENSE_QUERY_ERR"
    [ -n "$STAGING_LICENSE_KEY" ] && break
    echo "  [license查询 ${LICENSE_RETRY}/3] 空结果，stderr: ${LICENSE_ERR_TEXT:-无}"
    [ "$LICENSE_RETRY" -lt 3 ] && sleep 8
  done
  [ -n "$STAGING_LICENSE_KEY" ] || envfail "查不到 tenant=${TENANT} 在 zenithjoy_staging 的 active license_key 或 ssh 链路失败(3次重试后)，无法构造 bind deeplink。最后一次 stderr: ${LICENSE_ERR_TEXT:-无}"
  WS_URL="${API_BASE/https/wss}/agent-ws"
  BIND_API_ENC=$(jq -rn --arg v "$WS_URL" '$v|@uri')
  BIND_LICENSE_ENC=$(jq -rn --arg v "$STAGING_LICENSE_KEY" '$v|@uri')
  DEEPLINK="zenithjoy://bind?license=${BIND_LICENSE_ENC}&api=${BIND_API_ENC}"
  "$ADB" shell am start -a android.intent.action.VIEW -d "$DEEPLINK" >/dev/null 2>&1 || true
  sleep 3
  APP_PID=$("$ADB" shell pidof com.zenithjoy.agent 2>/dev/null | tr -d '\r\n')
  if [ -n "$APP_PID" ]; then
    ok "已用 deeplink 纠正环境绑定(api=${WS_URL})，已重新拉起 App(pid=$APP_PID)，心跳循环恢复"
  else
    envfail "adb install -r 后 deeplink 拉起 App 失败(pidof 查无进程)——心跳循环无法恢复，account-scan 必然拿不到 done"
  fi

  # 修复真实脚本 bug（本次 xian-rog 真机首次跑通 adb install 后才暴露，之前一直被
  # 401/签名冲突挡在更早的步骤，从未真正执行到这一行过）：旧代码写的
  # 'com.zenithjoy.agent/com.zenithjoy.agent.AccessibilityService' 是一个 APK 里
  # 从不存在的虚构类名（`adb shell dumpsys package com.zenithjoy.agent` 的
  # Service Resolver Table 实测过，三个真实组件都不叫这个），写入会静默不生效
  # （enabled_accessibility_services 读回是 null）。真实所需的三个组件名和恢复命令
  # 是 App 自己在 AgentService.kt 的 REQUIRED_ACCESSIBILITY_SERVICES + 日志里登记的
  # 权威约定（同一份清单，同一套写法），已在真机 SSH 实测确认生效。
  REQUIRED_ACCESSIBILITY_SERVICES="com.zenithjoy.agent/.collect.DouyinCollectService:com.zenithjoy.agent/.collect.DouyinDmOutreachService:com.zenithjoy.agent/.account.DeviceAccountScanService"
  "$ADB" shell settings put secure enabled_accessibility_services "$REQUIRED_ACCESSIBILITY_SERVICES" >/dev/null 2>&1 || true
  "$ADB" shell settings put secure accessibility_enabled 1 >/dev/null 2>&1 || true
  ACC=$("$ADB" shell settings get secure enabled_accessibility_services 2>/dev/null)
  case "$ACC" in
    *DeviceAccountScanService*) ok "无障碍已开启(enabled_accessibility_services=$ACC)" ;;
    *) fail "无障碍服务未开启(enabled_accessibility_services=$ACC)——账号扫描依赖无障碍读取面板" ;;
  esac

  # ── Step 2: 动态定位设备真实 agent_id（hostname型号 + last_seen 最新排序），
  #    DB 查询查无匹配时兜底走 logcat（不写死任何 agent_id 默认值） ──────────────
  # 排序用 last_seen 而非 last_heartbeat_at：ws 长连接心跳只更新 last_seen（真反映"当前
  # 在线"），last_heartbeat_at 字段有已知不一致 bug（issue 009c1544），用它排序会命中一条
  # 历史有值但可能早已离线的记录，而不是当前真在线那台。
  MODEL=$("$ADB" shell getprop ro.product.model 2>/dev/null | tr -d '\r\n')
  AGENT_ID=""
  if [ -n "$MODEL" ]; then
    ROW=$(ssh "$DB_SSH_HOST" "docker exec zenithjoy-db-postgres psql -U zenithjoy -d zenithjoy_staging -tA -c \
      \"SELECT agent_id FROM zenithjoy.agents WHERE hostname ILIKE '%${MODEL}%' ORDER BY last_seen DESC NULLS LAST LIMIT 1\"" 2>/dev/null)
    AGENT_ID=$(printf '%s' "$ROW" | tr -d '[:space:]')
  fi
  if [ -z "$AGENT_ID" ]; then
    # 兜底：DB 查无匹配，用 logcat "agent started — agentId=" 收尾日志动态取当前真实身份
    LIVE_AGENT=$("$ADB" logcat -d 2>/dev/null | grep -oE 'agent started — agentId=[a-f0-9-]{36}' | tail -1 | sed -E 's/.*agentId=//')
    [ -n "$LIVE_AGENT" ] && AGENT_ID="$LIVE_AGENT" && ok "DB 未命中，logcat 兜底动态取到 agent_id=$AGENT_ID"
  fi
  [ -n "$AGENT_ID" ] || envfail "动态定位设备真实 agent_id 失败(DB查询+logcat兜底均未命中，非硬编码兜底)"
  ok "定位设备真实 agent_id=${AGENT_ID}(型号=${MODEL}，非写死值)"

  # ── Step 2.5: 触发前取真实 tenant + 确认真在线 + 对齐 last_heartbeat_at ──────────
  # 真机 run 30507775016 卡这一步（trigger 返回 400 envfail）。两根因：
  #   ① 心跳双字段不一致（issue 009c1544）：ws 心跳只更新 last_seen 不更新 last_heartbeat_at，
  #      而 account-scan/trigger 按 last_heartbeat_at > now()-2min 判在线 → 设备真在线却被判离线。
  #   ② 触发用硬编码 SMOKE_TENANT，真机注册的 tenant 可能不同（本次 MAA-AN00 = 956f306e）。
  # 修法：从 agents 表按定位到的 agent_id 取真实 tenant_id + last_seen 新鲜度，先用 last_seen
  # （ws 真更新的字段）确认设备真在线（不伪造离线设备），再把 last_heartbeat_at 对齐 now()，
  # 用真实 tenant 触发。这是对已知字段不一致 bug 的诚实临时补偿，根治见 issue 009c1544。
  #
  # 有界轮询（2026-07-30 加固，防御真实启动时序）：上面刚用 deeplink 重新拉起 App，
  # 从进程冷启动 → register/WS 握手 → 首次心跳落库，即便绑定的环境完全正确，也需要
  # 几秒钟才能完成；此前是查一次没新鲜就立刻 envfail，真机首跑就在这被误判过一次
  # （设备其实几秒后就新鲜了）。改成有界重试，FRESH_POLL_MAX×FRESH_POLL_INTERVAL 秒
  # 预算内反复查，超出预算仍不新鲜才真正判 envfail（不是无限等）。
  FRESH_POLL_MAX="${FRESH_POLL_MAX:-12}"
  FRESH_POLL_INTERVAL="${FRESH_POLL_INTERVAL:-5}"
  DEV_TENANT=""
  SEEN_FRESH=""
  for j in $(seq 1 "$FRESH_POLL_MAX"); do
    META=$(ssh "$DB_SSH_HOST" "docker exec zenithjoy-db-postgres psql -U zenithjoy -d zenithjoy_staging -tA -F'|' -c \
      \"SELECT tenant_id, (last_seen > now() - interval '2 minutes') FROM zenithjoy.agents WHERE agent_id='$AGENT_ID'\"" 2>/dev/null)
    DEV_TENANT="${META%%|*}"
    SEEN_FRESH="${META##*|}"
    echo "  [$j/$FRESH_POLL_MAX] last_seen fresh=$SEEN_FRESH"
    [ "$SEEN_FRESH" = "t" ] && break
    sleep "$FRESH_POLL_INTERVAL"
  done
  [ "$SEEN_FRESH" = "t" ] || envfail "设备 last_seen 不新鲜(${FRESH_POLL_MAX}×${FRESH_POLL_INTERVAL}s 有界重试后设备仍真离线，非字段不一致)：agent_id=$AGENT_ID"
  [ -n "$DEV_TENANT" ] || envfail "查不到 agent_id=$AGENT_ID 的真实 tenant_id"
  ssh "$DB_SSH_HOST" "docker exec zenithjoy-db-postgres psql -U zenithjoy -d zenithjoy_staging -c \
    \"UPDATE zenithjoy.agents SET last_heartbeat_at = now() WHERE agent_id='$AGENT_ID'\"" >/dev/null 2>&1
  TENANT="$DEV_TENANT"
  ok "设备 last_seen 新鲜(真在线)，已对齐 last_heartbeat_at + 取真实 tenant=${TENANT}（补偿 issue 009c1544）"

  RESP=$(curl -fsSk -m 15 -X POST "$API_BASE/api/acquisition/account-scan/trigger" \
    -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT" \
    -d "{\"agent_id\":\"$AGENT_ID\"}" 2>&1)
  TASK_ID=$(printf '%s' "$RESP" | jq -r '.data.task_id // empty' 2>/dev/null)
  [ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ] || envfail "account-scan/trigger 未返回合法 task_id: $RESP"
  ok "已派任务 task_id=$TASK_ID"

  # ── Step 3: 轮询 publish_tasks 终态 —— 只在 status='done' 时才提前跳出轮询，
  #    其余终态(failed/超时视为等价failed)直接留给 Step 4 判红，不进入 account_ids 检查 ──
  STATUS=""
  RESPONSE_JSON="{}"
  for i in $(seq 1 "$POLL_MAX"); do
    ROW=$(ssh "$DB_SSH_HOST" "docker exec zenithjoy-db-postgres psql -U zenithjoy -d zenithjoy_staging -tA -F'|' -c \
      \"SELECT status, response FROM zenithjoy.publish_tasks WHERE id='$TASK_ID'\"" 2>/dev/null)
    STATUS="${ROW%%|*}"
    RESPONSE_JSON="${ROW#*|}"
    echo "  [$i/$POLL_MAX] status=$STATUS"
    [ "$STATUS" = "done" ] && break
    sleep "$POLL_INTERVAL"
  done

  # ── Step 4: 两段式联合断言 + 失败留证据（不整段输出 screenshot_b64，只报长度/存在性）──
  if assert_task_terminal_success "$STATUS" "$RESPONSE_JSON"; then
    ACCT_COUNT=$(printf '%s' "$RESPONSE_JSON" | jq -r '(.account_ids // []) | length' 2>/dev/null)
    ok "真机账号扫描成功: status=done account_ids数=$ACCT_COUNT task_id=$TASK_ID"
  else
    ERR_CODE=$(printf '%s' "$RESPONSE_JSON" | jq -r '.error_code // "?"' 2>/dev/null)
    HAS_SCREENSHOT=$(printf '%s' "$RESPONSE_JSON" | jq -r 'if .screenshot_b64 and (.screenshot_b64|length>0) then "yes(len="+(.screenshot_b64|length|tostring)+")" else "no" end' 2>/dev/null)
    fail "真机账号扫描终态非成功: status=$STATUS error_code=$ERR_CODE screenshot_b64=$HAS_SCREENSHOT task_id=$TASK_ID(3分钟内未拿到done等价超时)"
  fi
}

# source-guard：`source account-scan-realmachine-smoke.sh --source-only` 只加载函数定义
# （assert_task_terminal_success 可被回归测试直接 source 后单独调用），不触发上面的真机主流程。
[ "${BASH_SOURCE[0]}" = "${0}" ] && main "$@"
