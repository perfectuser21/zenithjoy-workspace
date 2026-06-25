#!/usr/bin/env bash
# staging-promote-workflow-smoke.sh
# ════════════════════════════════════════════════════════════════════════════
# 完整 workflow 级 proven-to-fire（升级版，补 staging-promote-smoke.sh 的"只到单元"洞）。
#
# staging-promote-smoke.sh 用 mock hook 验 blue_green_deploy 的"闸判定逻辑"——是单元级。
# 本 smoke 验**真实 release 隔离原语 + 真实 :5200 不变性**，更接近真部署：
#   · 用真实 release_dir_for / atomic_repoint_current / current_release_sha / prune_old_releases
#     在 sandbox releases 目录上跑（绝不碰真生产 releases）。
#   · 用一个 mock :5200（本地起的假 /version+/health node server，绝不是真生产）扮演"当前生产"。
#   · 跑「staging 验证红」这条最危险路径：staging_promote/rollback 用 sandbox 版（指向 sandbox
#     releases + mock 端口），blue_green_deploy 走完后断言：
#       ① mock :5200 报告的 sha 没变（生产没被切）
#       ② sandbox current 软链没动（仍指向部署前的 release）
#       ③ 报了 P0
#
# ★ 铁律：本 smoke 绝不碰真生产 :5200，绝不碰真 releases 目录、绝不 launchctl 真生产 label。
#   它只读真 :5200 的 sha 做"不变性"断言（若真 :5200 没起，跳过那条只读断言，不污染结果）。
#
# 退出码：0 全过；非 0 = 有断言失败（生产被碰 / current 被动 / 没报 P0）。
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
# shellcheck source=/dev/null
source "${REPO_ROOT}/.github/workflows/scripts/deploy-lib.sh"

PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
assert() { local got="$1" want="$2" desc="$3"; if [ "$got" = "$want" ]; then ok "$desc"; else bad "$desc（实际=$got 期望=$want）"; fi; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  完整 workflow 级 proven-to-fire — staging 红时真 :5200 + sandbox current 纹丝不动"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── sandbox 世界（绝不碰真 releases / 真 :5200）──
SANDBOX="$(mktemp -d)"
RELROOT="$SANDBOX/releases"
mkdir -p "$RELROOT"
PROD_RELEASE_SHA="prodprod00000"   # 部署前 sandbox current 指向的 release（= 假"当前生产"）
NEW_SHA="candidate11111"           # 本次候选 sha（staging 会验红，绝不该被 promote）
mkdir -p "$RELROOT/$PROD_RELEASE_SHA" "$RELROOT/$NEW_SHA"
atomic_repoint_current "$RELROOT" "$RELROOT/$PROD_RELEASE_SHA" >/dev/null 2>&1
CURRENT_BEFORE="$(readlink "$RELROOT/current")"
SANDBOX_PROD_SHA_BEFORE="$(current_release_sha "$RELROOT")"

# ── mock :5200（绝不是真生产，纯本地假服务，扮演"当前生产进程"）──
MOCK_PROD_PORT=53910
node -e '
const http=require("http");
const sha=process.argv[1];
const s=http.createServer((req,res)=>{
  if(req.url==="/version"){res.setHeader("content-type","application/json");res.end(JSON.stringify({sha}));}
  else if(req.url==="/health"){res.end("ok");}
  else{res.statusCode=404;res.end("no");}
});
s.listen('"$MOCK_PROD_PORT"',()=>{});
' "$PROD_RELEASE_SHA" &
MOCK_PROD_PID=$!
disown "$MOCK_PROD_PID" 2>/dev/null || true   # 抑制 trap kill 时的 "Terminated" 作业通知
for _i in $(seq 1 50); do
  if curl -sf "http://localhost:${MOCK_PROD_PORT}/version" >/dev/null 2>&1; then break; fi
  sleep 0.2
done

# ── 只读快照：真生产 :5200 的 sha（不变性断言用；若没起则跳过那条）──
REAL_PROD_SHA_BEFORE="$(curl -sf "http://localhost:5200/version" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).sha||""))}catch{process.stdout.write("")}})' 2>/dev/null || echo "")"

cleanup() { kill "$MOCK_PROD_PID" 2>/dev/null || true; rm -rf "$SANDBOX"; }
trap cleanup EXIT

# ── sandbox hook：操作 sandbox releases + mock 端口，绝不碰真生产 ──
sb_deploy_staging() { echo "  [sandbox] staging slot 起来了（不连真 :5201）"; return 0; }
sb_verify_staging_red() { echo "  [sandbox] staging 验证红 ❌（migration/health/smoke 任一失败）"; return 1; }
sb_record_anchor() { current_release_sha "$RELROOT"; }   # 锚点=sandbox current 当前 sha
# promote：真用 release 原语切 sandbox current + "重启" mock :5200（理论上 staging 红时绝不该被调用）
sb_promote() {
  local sha="$1"
  atomic_repoint_current "$RELROOT" "$RELROOT/$sha"
  kill "$MOCK_PROD_PID" 2>/dev/null || true
  node -e '
  const http=require("http");const sha=process.argv[1];
  const s=http.createServer((q,r)=>{if(q.url==="/version"){r.end(JSON.stringify({sha}));}else if(q.url==="/health"){r.end("ok");}else{r.statusCode=404;r.end("no");}});
  s.listen('"$MOCK_PROD_PORT"',()=>{});' "$sha" &
  MOCK_PROD_PID=$!
  disown "$MOCK_PROD_PID" 2>/dev/null || true
  return 0
}
sb_verify_prod() { local sha="$1"; assert_version "http://localhost:${MOCK_PROD_PORT}" "$sha"; }
sb_rollback() { local anchor="$1"; atomic_repoint_current "$RELROOT" "$RELROOT/$anchor"; return 0; }
sb_destroy_staging() { echo "  [sandbox] staging slot 销毁"; return 0; }
P0_FILE="$SANDBOX/p0"; echo "NO" > "$P0_FILE"
sb_alert_p0() { echo "YES" > "$P0_FILE"; echo "  [sandbox] 已开 P0"; return 0; }

echo ""
echo "▶ 危险路径：staging 验证红 → blue_green_deploy 绝不该 promote → 真 :5200 + sandbox current 不变"
BG_DEPLOY_STAGING_FN=sb_deploy_staging \
BG_VERIFY_STAGING_FN=sb_verify_staging_red \
BG_RECORD_ANCHOR_FN=sb_record_anchor \
BG_PROMOTE_FN=sb_promote \
BG_VERIFY_PROD_FN=sb_verify_prod \
BG_ROLLBACK_FN=sb_rollback \
BG_DESTROY_STAGING_FN=sb_destroy_staging \
BG_ALERT_P0_FN=sb_alert_p0 \
  blue_green_deploy "$NEW_SHA"
RC=$?

if [ "$RC" -ne 0 ]; then ok "blue_green_deploy 返回非 0（staging 红 → 发版红）"; else bad "staging 红却返 0"; fi

# ① mock :5200（扮演生产进程）报告的 sha 没变
MOCK_PROD_SHA_AFTER="$(curl -sf "http://localhost:${MOCK_PROD_PORT}/version" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).sha||""))}catch{process.stdout.write("")}})' 2>/dev/null || echo "")"
assert "$MOCK_PROD_SHA_AFTER" "$PROD_RELEASE_SHA" "① 生产进程 sha 没变（没被切到候选 ${NEW_SHA}）"

# ② sandbox current 软链没动（仍指向部署前的 release）
CURRENT_AFTER="$(readlink "$RELROOT/current")"
assert "$CURRENT_AFTER" "$CURRENT_BEFORE" "② current 软链未动（仍指向 ${SANDBOX_PROD_SHA_BEFORE}）"
assert "$(current_release_sha "$RELROOT")" "$SANDBOX_PROD_SHA_BEFORE" "② current sha 不变"

# ③ 报了 P0
assert "$(cat "$P0_FILE")" "YES" "③ 已开 P0 告警"

# ④ 真 :5200 不变性（只读断言；若真 :5200 没起则跳过，不污染结果）
if [ -n "$REAL_PROD_SHA_BEFORE" ]; then
  REAL_PROD_SHA_AFTER="$(curl -sf "http://localhost:5200/version" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).sha||""))}catch{process.stdout.write("")}})' 2>/dev/null || echo "")"
  assert "$REAL_PROD_SHA_AFTER" "$REAL_PROD_SHA_BEFORE" "④ 真生产 :5200 运行 sha 全程不变（proven-to-fire 没碰真生产）"
else
  echo "  ⏭️  真 :5200 未运行（CI/无生产环境），跳过真生产 sha 不变性只读断言"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  staging-promote-workflow-smoke: PASS=$PASS FAIL=$FAIL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
[ "$FAIL" -eq 0 ]
