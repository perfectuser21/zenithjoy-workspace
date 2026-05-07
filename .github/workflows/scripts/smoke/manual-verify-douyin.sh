#!/usr/bin/env bash
# manual-verify-douyin.sh
# Walking Skeleton #1 — 真 Agent + Playwright + Chrome dryrun 验证
#
# **CI 不跑**：设了 MANUAL_VERIFY=1 才放行。
# 用途：每周人工跑一次，证明真 Agent 链路也通（不只是 mock smoke 通）。
#
# 真链路（vs golden-path-1-douyin-smoke.sh 的 mock）：
#   - Step 3：不 INSERT DB，而是真启动 Agent → 弹 Playwright Chrome 19222
#             → 由人工扫码 → storageState 落盘 ~/.zenithjoy-agent/sessions/douyin/default.json
#             → Agent 上报 → API 写表 status=active
#   - Step 5.5：不 curl mock receipt，而是真让 Agent 跑 publishers/douyin-publisher
#               的 dryrun（连接 CDP 19222，上传，填标题，断言发布按钮可点，**不真点**），
#               再 POST receipt
#
# **绝对不能真发到抖音公网** —— 全程 dryrun。publishers 内部已实现 dryrun 短路。
#
# 前置准备：
#   1. 本地起好 apps/api（5200）+ Postgres（含 ws1 migration）
#   2. 本地起好 services/agent（启动后会自动 heartbeat）
#   3. 桌面 Chrome 干净（脚本会在 19222 端口起新实例）
#   4. 抖音账号备好（要扫码）
#
# 用法：
#   MANUAL_VERIFY=1 bash .github/workflows/scripts/smoke/manual-verify-douyin.sh

set -uo pipefail

if [ "${MANUAL_VERIFY:-0}" != "1" ]; then
  echo "⏭  跳过：manual-verify-douyin.sh 仅在 MANUAL_VERIFY=1 时运行"
  echo "    （CI 默认不跑此脚本；CI 走 golden-path-1-douyin-smoke.sh）"
  exit 0
fi

API_BASE="${API_BASE:-http://localhost:5200}"
PSQL_USER="${PGUSER:-cecelia}"
PSQL_DB="${PGDATABASE:-cecelia}"
PSQL_HOST="${PGHOST:-localhost}"
PSQL_PASS="${PGPASSWORD:-cecelia}"
SESSION_FILE="${SESSION_FILE:-$HOME/.zenithjoy-agent/sessions/douyin/default.json}"
TIMEOUT_QR="${TIMEOUT_QR:-180}"      # 给人 3 分钟扫码
TIMEOUT_PUB="${TIMEOUT_PUB:-180}"    # dryrun 跑 3 分钟

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Walking Skeleton #1 — Manual Verify (REAL Agent + Playwright)"
echo "  绝不真发布。全程 dryrun。"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

run_psql() {
  PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=1 -t -A "$@"
}

require() {
  command -v "$1" >/dev/null || { echo "❌ 缺命令：$1"; exit 11; }
}
require curl
require psql
require python3

# ─── 0. 前置自检 ───────────────────────────────────────────────────
echo "▶ [0] 前置自检"
curl -fsS "${API_BASE}/health" >/dev/null || { echo "  ❌ apps/api 没起 (${API_BASE}/health)"; exit 12; }
echo "  OK: apps/api 在 ${API_BASE} 响应"

# Agent 进程必须在跑（heartbeat 已建 agent 行）
HB_COUNT=$(run_psql -c "SELECT count(*) FROM zenithjoy.agents WHERE last_heartbeat_at > now() - interval '60 seconds';")
if [ "${HB_COUNT:-0}" = "0" ]; then
  echo "  ❌ 60s 内无 Agent heartbeat — 请先启动 services/agent"
  exit 13
fi
echo "  OK: 检测到活跃 Agent (${HB_COUNT} 个)"

# ─── 1. 注册 + 拿 license ─────────────────────────────────────────
TS=$(date +%s)
EMAIL="ws1-manual-${TS}@zenithjoy.test"
PASSWORD="$(date +%s%N | sha256sum | head -c 12)Aa1"
echo "▶ [1] 注册 ${EMAIL}"
RESP_1=$(curl -fsS -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" \
  "${API_BASE}/api/auth/register")
LICENSE=$(echo "$RESP_1" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('license') or d.get('license_key') or '')")
[ -n "$LICENSE" ] || { echo "  FAIL: 拿不到 license — body=$RESP_1"; exit 1; }
echo "  OK: license=${LICENSE:0:20}…"

# ─── 2. 拿 Agent 来认领 license（heartbeat） ───────────────────────
echo "▶ [2] heartbeat (license 绑定到当前 Agent)"
echo "      ⚠️  人工：此时如果 Agent 不是用这个 license 跑的，要 export ZENITHJOY_LICENSE=$LICENSE 重启 Agent"
RESP_2=$(curl -fsS -X POST -H "Content-Type: application/json" \
  -d "{\"license\":\"${LICENSE}\",\"version\":\"manual-verify\",\"hostname\":\"$(hostname)\"}" \
  "${API_BASE}/api/agent/heartbeat")
AGENT_ID=$(echo "$RESP_2" | python3 -c "import sys,json;print(json.load(sys.stdin).get('agent_id',''))")
[ -n "$AGENT_ID" ] || { echo "  FAIL: 拿不到 agent_id — body=$RESP_2"; exit 2; }
echo "  OK: agent_id=$AGENT_ID"

# ─── 3. 触发抖音 qr_bind task → 真 Playwright Chrome 19222 ────────
echo "▶ [3] 触发 qr_bind/douyin task —— Agent 应该启动 Chrome 19222"
# 假设 dashboard 行为是 POST /api/agent/qr-bind，contract 没明确
# 这里用通用约定：通过 publish/task 走类型 'qr_bind'。
# 如果实际 endpoint 不同，由人工修改下面这行。
curl -fsS -X POST -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"${AGENT_ID}\",\"platform\":\"douyin\",\"task_type\":\"qr_bind\"}" \
  "${API_BASE}/api/publish/task" >/dev/null || true

echo "  ⏳ 等用户扫码完成（最多 ${TIMEOUT_QR}s）；session 文件落到 ${SESSION_FILE}"
WAITED=0
while [ $WAITED -lt "$TIMEOUT_QR" ]; do
  if [ -f "$SESSION_FILE" ]; then
    SIZE=$(wc -c <"$SESSION_FILE" | tr -d ' ')
    if [ "$SIZE" -gt 100 ]; then
      echo "  OK: session 文件已写入（${SIZE} bytes）"
      break
    fi
  fi
  sleep 3
  WAITED=$((WAITED + 3))
  echo "    ... 已等 ${WAITED}s"
done
if [ ! -f "$SESSION_FILE" ]; then
  echo "  FAIL: ${TIMEOUT_QR}s 内 session 没落盘 — Agent 没起 Chrome？或者用户没扫？"
  exit 3
fi

# 等 Agent 上报 → DB 写 status=active
sleep 5
ACTIVE=$(run_psql -c "
  SELECT count(*) FROM zenithjoy.agent_platform_sessions
   WHERE agent_id='${AGENT_ID}'::uuid AND platform='douyin' AND status='active';
")
[ "${ACTIVE:-0}" = "1" ] || { echo "  FAIL: DB 里 session 没标 active（实际计数 ${ACTIVE}）"; exit 3; }
echo "  OK: agent_platform_sessions(douyin/default)=active"

# ─── 4. 绑文件夹 ─────────────────────────────────────────────────
LOCAL_PATH="${MANUAL_VIDEO_DIR:-$HOME/zenithjoy-manual-videos}"
mkdir -p "$LOCAL_PATH"
echo "▶ [4] 绑文件夹 $LOCAL_PATH"
echo "      ⚠️  人工：此目录下应至少有一个 .mp4（dryrun 也要真读文件）"
ls "$LOCAL_PATH"/*.mp4 >/dev/null 2>&1 || {
  echo "  FAIL: $LOCAL_PATH 下无 .mp4 文件"
  echo "       请放一个测试视频（任意 mp4）后重跑"
  exit 4
}
RESP_4=$(curl -fsS -X POST -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"${AGENT_ID}\",\"local_path\":\"${LOCAL_PATH}\"}" \
  "${API_BASE}/api/agent/folder/bind")
echo "$RESP_4" | grep -q '"ok":true' || { echo "  FAIL: $RESP_4"; exit 4; }
echo "  OK"

# ─── 5. 派 publish task ──────────────────────────────────────────
echo "▶ [5] 派 publish task — Agent 应启动 dryrun（连 CDP 19222，不真点发布）"
RESP_5=$(curl -fsS -X POST -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"${AGENT_ID}\",\"platform\":\"douyin\",\"folder_path\":\"${LOCAL_PATH}\"}" \
  "${API_BASE}/api/publish/task")
TASK_ID=$(echo "$RESP_5" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('task_id') or d.get('id') or '')")
[ -n "$TASK_ID" ] || { echo "  FAIL: $RESP_5"; exit 5; }
echo "  OK: task_id=$TASK_ID"

# ─── 6. 等真 Agent 跑完 dryrun + 上报 receipt ────────────────────
echo "▶ [6] 轮询 task 状态 → 期望 success（最多 ${TIMEOUT_PUB}s）"
WAITED=0
FINAL_STATUS=""
FINAL_RESULT=""
while [ $WAITED -lt "$TIMEOUT_PUB" ]; do
  RESP_6=$(curl -fsS "${API_BASE}/api/publish/tasks/${TASK_ID}" || echo "{}")
  S=$(echo "$RESP_6" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
  if [ "$S" = "success" ] || [ "$S" = "failed" ]; then
    FINAL_STATUS="$S"
    FINAL_RESULT="$RESP_6"
    break
  fi
  sleep 5
  WAITED=$((WAITED + 5))
  echo "    ... ${WAITED}s, status=${S:-pending}"
done
[ "$FINAL_STATUS" = "success" ] || {
  echo "  FAIL: 终态 status=${FINAL_STATUS:-timeout}"
  echo "  body=$FINAL_RESULT"
  exit 7
}
EVID=$(echo "$FINAL_RESULT" | python3 -c "import sys,json;d=json.load(sys.stdin);print((d.get('result') or {}).get('dryrun_evidence',''))" 2>/dev/null || true)
case "$EVID" in
  "")
    echo "  FAIL: result.dryrun_evidence 为空 — Agent 真的跑 dryrun 了吗？"
    echo "  body=$FINAL_RESULT"; exit 7 ;;
  "mocked-by-smoke")
    echo "  FAIL: dryrun_evidence='mocked-by-smoke' — 这是 mock smoke 数据，不是真 Agent！"
    exit 7 ;;
  *)
    echo "  OK: 真 dryrun_evidence='${EVID}'" ;;
esac

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Walking Skeleton #1 Manual Verify PASS"
echo "  真 Agent + Playwright + Chrome 链路全通（dryrun 模式）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
