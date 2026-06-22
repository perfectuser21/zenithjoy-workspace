#!/usr/bin/env bash
# deploy-version-selfcheck-smoke.sh
# 发版自洽 E2E smoke —— 端到端验证"真上新代码"探针链路：
#   build 写 dist/build-info.json(sha) → 进程启动 → /version 报告该 sha
#   → deploy-lib.sh assert_version 断言运行进程 sha == 部署 commit。
#
# 治 2026-06-22 真坑：发版报成功但旧进程仍占 :5200、跑旧代码无人察觉。
# 本 smoke 证明：只要 /version 报告的 sha 与期望不符，版本自检必然返非 0(发版红)。
#
# 验证链路：
#   1. BUILD_SHA=<known> npm run build           → 生成 dist/build-info.json
#   2. 启动 dist/index.js（真进程，绑随机端口）
#   3. GET /health                               → status ok + build.sha == known
#   4. GET /version                              → sha == known
#   5. assert_version <url> <known>              → 返 0（命中）
#   6. assert_version <url> <wrong-sha>          → 返非 0（proven-to-fire：旧进程会被抓出来）
#
# 退出码：0 全过；1 build 失败；2 进程没起；3 /health sha 不符；
#         4 /version sha 不符；5 assert_version 命中应返0却没；6 不符应返非0却返0
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
API_DIR="${REPO_ROOT}/apps/api"
PORT="${SMOKE_PORT:-5293}"
BASE="http://localhost:${PORT}"
KNOWN_SHA="smoke$(date +%s)deadbeef"
WRONG_SHA="wrong0000feedface"

# shellcheck source=/dev/null
source "${REPO_ROOT}/.github/workflows/scripts/deploy-lib.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  发版自洽 smoke — 版本自检(/version) proven-to-fire"
echo "  KNOWN_SHA=${KNOWN_SHA}  BASE=${BASE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$API_DIR" || { echo "❌ 进不去 $API_DIR"; exit 1; }

echo "▶ [1/6] build（BUILD_SHA 注入 → dist/build-info.json）"
if ! BUILD_SHA="$KNOWN_SHA" npm run build > /tmp/deploy-smoke-build.log 2>&1; then
  echo "❌ build 失败"; tail -20 /tmp/deploy-smoke-build.log; exit 1
fi
grep -q "$KNOWN_SHA" dist/build-info.json || { echo "❌ build-info.json 未含 KNOWN_SHA"; cat dist/build-info.json; exit 1; }
echo "  ✅ dist/build-info.json = $(cat dist/build-info.json | tr -d '\n ')"

echo "▶ [2/6] 启动真进程（dist/index.js, PORT=${PORT}）"
# 仅验证 /health + /version，不依赖 DB；给最小 env 让进程能起。
PORT="$PORT" \
  DATABASE_URL="${DATABASE_URL:-postgres://cecelia:cecelia@localhost:5432/cecelia}" \
  BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-smoke-secret-not-real-min-32-chars-padding-xxxxx}" \
  TOAPI_API_KEY="${TOAPI_API_KEY:-smoke-key-not-real}" \
  NODE_ENV=production \
  node dist/index.js > /tmp/deploy-smoke-app.log 2>&1 &
APP_PID=$!
trap 'kill "$APP_PID" 2>/dev/null || true; kill_port "$PORT" >/dev/null 2>&1 || true' EXIT

UP=0
for _ in $(seq 1 20); do
  if curl -sf "${BASE}/health" >/dev/null 2>&1; then UP=1; break; fi
  sleep 1
done
if [ "$UP" -ne 1 ]; then
  echo "❌ 进程没在 20s 内起来"; tail -20 /tmp/deploy-smoke-app.log; exit 2
fi
echo "  ✅ 进程已起 (pid=${APP_PID})"

echo "▶ [3/6] GET /health → build.sha == KNOWN_SHA"
HEALTH="$(curl -sf "${BASE}/health")"
echo "  health: $HEALTH"
echo "$HEALTH" | grep -q "$KNOWN_SHA" || { echo "❌ /health 未报告 KNOWN_SHA"; exit 3; }

echo "▶ [4/6] GET /version → sha == KNOWN_SHA"
VSHA="$(curl -sf "${BASE}/version" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(String(JSON.parse(s).sha||""))})')"
echo "  /version sha=${VSHA}"
[ "$VSHA" = "$KNOWN_SHA" ] || { echo "❌ /version sha 不符"; exit 4; }

echo "▶ [5/6] assert_version <BASE> <KNOWN_SHA> → 期望返 0（命中）"
if assert_version "$BASE" "$KNOWN_SHA"; then
  echo "  ✅ 命中，返 0"
else
  echo "❌ sha 相符却返非 0"; exit 5
fi

echo "▶ [6/6] assert_version <BASE> <WRONG_SHA> → 期望返非 0（proven-to-fire）"
if assert_version "$BASE" "$WRONG_SHA"; then
  echo "❌ sha 不符却返 0（版本自检失灵，旧进程会蒙混过关）"; exit 6
else
  echo "  ✅ sha 不符正确返非 0 —— 旧进程会被发版红抓出来"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ 发版自洽 smoke 全过：版本自检真能区分新/旧进程"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
