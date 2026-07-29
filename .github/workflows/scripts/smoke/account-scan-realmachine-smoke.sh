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
#   DB_SSH_HOST    真机 DB 所在 SSH host（默认 hk-vps）
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
  ADB="${ADB:-adb}"
  API_BASE="${API_BASE:-https://staging-autopilot.zenjoymedia.media}"
  TENANT="${SMOKE_TENANT:-455a8ca9-5f63-4286-83ce-c5cca04cfd58}"
  DB_SSH_HOST="${DB_SSH_HOST:-hk-vps}"
  POLL_MAX="${POLL_MAX:-18}"
  POLL_INTERVAL="${POLL_INTERVAL:-10}"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  account-scan 真机验证车道 smoke"
  echo "  API=$API_BASE"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # ── 环境自检（区分"环境未就绪"与"真机验证真的失败"） ────────────────
  command -v jq >/dev/null 2>&1 || envfail "runner 缺 jq"

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

  APK_TMP=$(mktemp /tmp/zj-agent-XXXXXX.apk)
  curl -fsSk -m 60 -o "$APK_TMP" "$APK_URL" || envfail "APK 下载失败: $APK_URL"
  # adb install -r：覆盖装不卸载，保住设备已有的注册态(agent_id/绑定关系不丢)
  "$ADB" install -r "$APK_TMP" >/dev/null 2>&1 || envfail "adb install -r 失败"
  rm -f "$APK_TMP"
  ok "已覆盖安装最新 APK(adb install -r)"

  "$ADB" shell settings put secure enabled_accessibility_services 'com.zenithjoy.agent/com.zenithjoy.agent.AccessibilityService' >/dev/null 2>&1 || true
  ACC=$("$ADB" shell settings get secure enabled_accessibility_services 2>/dev/null)
  case "$ACC" in
    *com.zenithjoy.agent*) ok "无障碍已开启(enabled_accessibility_services=$ACC)" ;;
    *) fail "无障碍服务未开启(enabled_accessibility_services=$ACC)——账号扫描依赖无障碍读取面板" ;;
  esac

  # ── Step 2: 动态定位设备真实 agent_id（hostname型号 + last_heartbeat_at 最新排序），
  #    DB 查询查无匹配时兜底走 logcat（不写死任何 agent_id 默认值） ──────────────
  MODEL=$("$ADB" shell getprop ro.product.model 2>/dev/null | tr -d '\r\n')
  AGENT_ID=""
  if [ -n "$MODEL" ]; then
    ROW=$(ssh "$DB_SSH_HOST" "docker exec zenithjoy-db-postgres psql -U zenithjoy -d zenithjoy_staging -tA -c \
      \"SELECT agent_id FROM zenithjoy.agents WHERE hostname ILIKE '%${MODEL}%' ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1\"" 2>/dev/null)
    AGENT_ID=$(printf '%s' "$ROW" | tr -d '[:space:]')
  fi
  if [ -z "$AGENT_ID" ]; then
    # 兜底：DB 查无匹配（已知 last_heartbeat_at/last_seen 字段不一致独立 issue），
    # 用 logcat "agent started — agentId=" 收尾日志动态取当前真实身份
    LIVE_AGENT=$("$ADB" logcat -d 2>/dev/null | grep -oE 'agent started — agentId=[a-f0-9-]{36}' | tail -1 | sed -E 's/.*agentId=//')
    [ -n "$LIVE_AGENT" ] && AGENT_ID="$LIVE_AGENT" && ok "DB 未命中，logcat 兜底动态取到 agent_id=$AGENT_ID"
  fi
  [ -n "$AGENT_ID" ] || envfail "动态定位设备真实 agent_id 失败(DB查询+logcat兜底均未命中，非硬编码兜底)"
  ok "定位设备真实 agent_id=$AGENT_ID(型号=$MODEL，非写死值)"

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
