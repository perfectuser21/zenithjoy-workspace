#!/usr/bin/env bash
# golden-path-1-douyin-smoke.sh
# Walking Skeleton #1 — 客户首次成功路径（抖音版）
#
# Notion Journey: https://www.notion.so/358c40c2ba6381b2a6eacd288cf82f29
# Contract:        /tmp/walking-skeleton-1-contract.md（4 teammate 共同对接）
#
# 目标：
#   maturity not_started → skeleton 的最终判据
#   注册 → Agent 握手 → 抖音 session 绑定（CI 用 SQL mock）→ 文件夹绑定
#   → 创建 publish task → Agent 完成 dryrun 回执（CI 用 mock 上报）→ 验证状态
#
# CI vs 人工：
#   - CI：本脚本 6 步全 curl + 2 处 mock（session bind 用 SQL，receipt 用 curl 模拟）
#         **绝不**真启动 Playwright/Chrome，也**绝不**真发到抖音公网
#   - 人工每周：单跑 manual-verify-douyin.sh（MANUAL_VERIFY=1）
#
# 退出码：
#   0  端到端全过
#   1  Step 1 register 失败
#   2  Step 2 heartbeat 失败
#   3  Step 3 session mock bind 失败
#   4  Step 4 folder bind 失败
#   5  Step 5 create publish task 失败
#   6  Step 5.5 mock receipt 失败
#   7  Step 6 verify status 失败
#
# 依赖：API_BASE 默认 http://localhost:5200，PG* 默认 cecelia/cecelia/cecelia/localhost

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
PSQL_USER="${PGUSER:-cecelia}"
PSQL_DB="${PGDATABASE:-cecelia}"
PSQL_HOST="${PGHOST:-localhost}"
PSQL_PASS="${PGPASSWORD:-cecelia}"

TS=$(date +%s)
EMAIL="ws1-smoke-${TS}@zenithjoy.test"
PASSWORD="$(date +%s%N | sha256sum | head -c 12)Aa1"
HOSTNAME_FAKE="ws1-smoke-host-${TS}"
LOCAL_PATH="/tmp/ws1-smoke-videos-${TS}"
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

run_psql() {
  PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=1 -t -A "$@"
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Walking Skeleton #1 — Golden Path 1 抖音 (CI smoke)"
echo "  email=${EMAIL}"
echo "  API_BASE=${API_BASE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ───────────────────────────────────────────────────────────────────
# Step 1：注册 → 拿 license（contract §2 §8 + api-impl 确认）
# better-auth 路径 /api/auth/sign-up/email 不直接返回 license；
# PR #244 的 auth-bridge 会自动建一行 free license（tier='free'，customer_id=user.id）。
# 所以注册后从 zenithjoy.licenses 反查 license_key（ZJ-F-XXXX 格式）。
# ───────────────────────────────────────────────────────────────────
echo "▶ [1/6] POST /api/auth/sign-up/email → 注册"
RESP_1=$(curl -fsS -c "$COOKIE_JAR" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"WS1 Smoke\"}" \
  "${API_BASE}/api/auth/sign-up/email" 2>/tmp/ws1-step1.err) || {
  echo "  FAIL: sign-up HTTP failed"
  cat /tmp/ws1-step1.err
  exit 1
}
USER_ID=$(echo "$RESP_1" | python3 -c "import sys,json;d=json.load(sys.stdin);u=d.get('user') or d;print(u.get('id') or '')" 2>/dev/null || true)
if [ -z "$USER_ID" ]; then
  echo "  FAIL: sign-up 响应无 user.id"
  echo "  body=$RESP_1"
  exit 1
fi
# 给 better-auth hooks.after 一秒完成 free-license 桥接
sleep 1
LICENSE=$(run_psql -c "SELECT license_key FROM zenithjoy.licenses WHERE customer_id='${USER_ID}' AND tier='free' ORDER BY created_at DESC LIMIT 1;")
if [ -z "$LICENSE" ]; then
  echo "  FAIL: zenithjoy.licenses 没找到 free license（auth-bridge 没跑？）"
  echo "  user_id=$USER_ID"
  exit 1
fi
echo "  OK: user_id=${USER_ID:0:8}… license=${LICENSE}"

# ───────────────────────────────────────────────────────────────────
# Step 2：Agent heartbeat → 拿 agent_id（contract §2 §4）
# api-impl 确认：鉴权首选 Authorization: Bearer <license>，body.license 为兜底。
# ───────────────────────────────────────────────────────────────────
echo "▶ [2/6] POST /api/agent/heartbeat → 拿 agent_id"
RESP_2=$(curl -fsS -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${LICENSE}" \
  -d "{\"version\":\"0.1.0\",\"hostname\":\"${HOSTNAME_FAKE}\"}" \
  "${API_BASE}/api/agent/heartbeat" 2>/tmp/ws1-step2.err) || {
  echo "  FAIL: heartbeat HTTP failed"
  cat /tmp/ws1-step2.err
  exit 2
}
AGENT_ID=$(echo "$RESP_2" | python3 -c "import sys,json;print(json.load(sys.stdin).get('agent_id',''))" 2>/dev/null || true)
if [ -z "$AGENT_ID" ]; then
  echo "  FAIL: heartbeat 响应无 agent_id"
  echo "  body=$RESP_2"
  exit 2
fi
echo "  OK: agent_id=${AGENT_ID}"

# ───────────────────────────────────────────────────────────────────
# Step 3：模拟 session 已绑（CI 没真 Chrome；直接打 DB）
# 真链路（人工 manual-verify-douyin.sh）：
#   Agent 收到 qr_bind/douyin task → Playwright 启动 Chrome 19222
#   → 用户扫码 → storageState 存盘 → POST 上报 → API 写表 status=active
# CI mock 路径：
#   直接 INSERT/UPDATE zenithjoy.agent_platform_sessions
#   (api-impl 同事：如你需要改成 test endpoint，回我 SendMessage)
# ───────────────────────────────────────────────────────────────────
echo "▶ [3/6] (mock) INSERT zenithjoy.agent_platform_sessions status=active"
run_psql -c "
  INSERT INTO zenithjoy.agent_platform_sessions
    (agent_id, platform, account_label, status, bound_at)
  VALUES
    ('${AGENT_ID}'::uuid, 'douyin', 'default', 'active', now())
  ON CONFLICT (agent_id, platform, account_label) DO UPDATE
    SET status='active', bound_at=now();
" >/dev/null || {
  echo "  FAIL: 直接 INSERT agent_platform_sessions 失败（api-impl 是否已建该表？）"
  exit 3
}
SESS_OK=$(run_psql -c "
  SELECT count(*) FROM zenithjoy.agent_platform_sessions
   WHERE agent_id='${AGENT_ID}'::uuid AND platform='douyin' AND status='active';
")
[ "$SESS_OK" = "1" ] || { echo "  FAIL: session 未落 active 状态"; exit 3; }
echo "  OK: agent_platform_sessions(douyin/default)=active"

# ───────────────────────────────────────────────────────────────────
# Step 4：bind folder（contract §2）
# ───────────────────────────────────────────────────────────────────
echo "▶ [4/6] POST /api/agent/folder/bind"
mkdir -p "$LOCAL_PATH"
RESP_4=$(curl -fsS -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${LICENSE}" \
  -d "{\"agent_id\":\"${AGENT_ID}\",\"local_path\":\"${LOCAL_PATH}\"}" \
  "${API_BASE}/api/agent/folder/bind" 2>/tmp/ws1-step4.err) || {
  echo "  FAIL: folder/bind HTTP failed"
  cat /tmp/ws1-step4.err
  exit 4
}
echo "$RESP_4" | grep -q '"ok":true' || {
  echo "  FAIL: folder/bind 响应缺 ok:true"
  echo "  body=$RESP_4"
  exit 4
}
echo "  OK: folder bound to ${LOCAL_PATH}"

# ───────────────────────────────────────────────────────────────────
# Step 5：创建 publish task（contract §2）
# ───────────────────────────────────────────────────────────────────
echo "▶ [5/6] POST /api/publish/task → 拿 task_id"
RESP_5=$(curl -fsS -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${LICENSE}" \
  -d "{\"agent_id\":\"${AGENT_ID}\",\"platform\":\"douyin\",\"folder_path\":\"${LOCAL_PATH}\"}" \
  "${API_BASE}/api/publish/task" 2>/tmp/ws1-step5.err) || {
  echo "  FAIL: publish/task HTTP failed"
  cat /tmp/ws1-step5.err
  exit 5
}
TASK_ID=$(echo "$RESP_5" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('task_id') or d.get('id') or '')" 2>/dev/null || true)
if [ -z "$TASK_ID" ]; then
  echo "  FAIL: publish/task 响应无 task_id"
  echo "  body=$RESP_5"
  exit 5
fi
echo "  OK: task_id=${TASK_ID}"

# ───────────────────────────────────────────────────────────────────
# Step 5.5：(mock) Agent 完成 dryrun 回报（CI 没真 Agent + Playwright + Chrome）
# 真链路（人工 manual-verify-douyin.sh）：
#   Agent 收到 publish/douyin task → 调 publishers/douyin-publisher dryrun
#   → 拿到 dryrun_evidence → POST receipt
# CI mock 路径：直接 curl POST 上报 mocked-by-smoke evidence
# ───────────────────────────────────────────────────────────────────
echo "▶ [5.5/6] (mock) POST /api/publish/receipt 模拟 Agent 上报成功"
RESP_55=$(curl -fsS -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${LICENSE}" \
  -d "{
    \"task_id\":\"${TASK_ID}\",
    \"status\":\"success\",
    \"result\":{
      \"dryrun_evidence\":\"mocked-by-smoke\",
      \"url\":\"https://creator.douyin.com/dryrun-mock/${TASK_ID}\"
    }
  }" \
  "${API_BASE}/api/publish/receipt" 2>/tmp/ws1-step55.err) || {
  echo "  FAIL: publish/receipt HTTP failed"
  cat /tmp/ws1-step55.err
  exit 6
}
echo "$RESP_55" | grep -q '"ok":true' || {
  echo "  FAIL: publish/receipt 响应缺 ok:true"
  echo "  body=$RESP_55"
  exit 6
}
echo "  OK: receipt accepted"

# ───────────────────────────────────────────────────────────────────
# Step 6：验证回执（contract §2 §6）
# ───────────────────────────────────────────────────────────────────
echo "▶ [6/6] GET /api/publish/tasks/${TASK_ID} → status=success"
RESP_6=$(curl -fsS \
  -H "Authorization: Bearer ${LICENSE}" \
  "${API_BASE}/api/publish/tasks/${TASK_ID}" 2>/tmp/ws1-step6.err) || {
  echo "  FAIL: GET task HTTP failed"
  cat /tmp/ws1-step6.err
  exit 7
}
STATUS=$(echo "$RESP_6" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
if [ "$STATUS" != "success" ]; then
  echo "  FAIL: 期望 status=success，实际 status='${STATUS}'"
  echo "  body=$RESP_6"
  exit 7
fi
# 二次断言：result 里能读回 dryrun_evidence（证明 receipt 真存盘了）
EVID=$(echo "$RESP_6" | python3 -c "import sys,json;d=json.load(sys.stdin);print((d.get('result') or {}).get('dryrun_evidence',''))" 2>/dev/null || true)
[ "$EVID" = "mocked-by-smoke" ] || {
  echo "  FAIL: result.dryrun_evidence 期望 'mocked-by-smoke'，实际 '${EVID}'"
  echo "  body=$RESP_6"
  exit 7
}
echo "  OK: task=success，dryrun_evidence 已回写"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Walking Skeleton #1 Golden Path PASS"
echo "  Journey 可升 maturity → skeleton"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
