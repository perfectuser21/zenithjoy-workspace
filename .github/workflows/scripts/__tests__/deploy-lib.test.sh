#!/usr/bin/env bash
# Current frontend atomic releases and historical manual rollback, in isolated fixtures.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/deploy-lib.sh"

PASSED=0; FAILED=0

ok() { echo "  PASS [$1]"; PASSED=$((PASSED+1)); }
bad() { echo "  FAIL [$1]"; FAILED=$((FAILED+1)); }
# expect_eq <actual> <expected> <label>：相等→ok，否则→bad（用 if 而非 A&&B||C，规避 SC2015）。
expect_eq() { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3（实际=$1）"; fi; }

# --- sha_matches ---
if sha_matches "abc1234def" "abc1234def"; then ok "A 完全相等命中"; else bad "A 完全相等命中"; fi

if sha_matches "abc1234" "abc1234def567890"; then ok "B 短 sha 前缀命中"; else bad "B 短 sha 前缀命中"; fi

if sha_matches "deadbeef0000" "cafebabe1111"; then bad "C sha 不符应不命中"; else ok "C sha 不符应不命中"; fi

if sha_matches "unknown" "abc1234def"; then bad "D unknown 应不命中"; else ok "D unknown 应不命中"; fi

if sha_matches "" "abc1234def"; then bad "E 空应不命中"; else ok "E 空应不命中"; fi

# --- assert_version 端到端 proven-to-fire ---
# 起一个假 /version 服务（node http），报告 oldsha；断言期望 newsha → 必须 return 1。
FAKE_PORT=53997
node -e '
const http=require("http");
const sha=process.argv[1];
const s=http.createServer((req,res)=>{
  if(req.url==="/version"){res.setHeader("content-type","application/json");res.end(JSON.stringify({sha,version:"x",buildTime:"t"}));}
  else{res.statusCode=404;res.end("no");}
});
s.listen('"$FAKE_PORT"',()=>{});
' "old0000sha111" &
FAKE_PID=$!
# 等 mock /version 真就绪再断言（治 sleep 1 在 CI 高负载下端口未绑好的竞态 flaky：
# server 没起来时 F 不符凑巧返非0像通过、F2 相符拿不到 sha 误判失败）。轮询最多 ~10s。
for _i in $(seq 1 50); do
  if curl -sf "http://localhost:${FAKE_PORT}/version" >/dev/null 2>&1; then break; fi
  sleep 0.2
done

set +e
assert_version "http://localhost:${FAKE_PORT}" "new9999sha222" >/tmp/dlib-assert-mismatch.txt 2>&1
RC_MISMATCH=$?
assert_version "http://localhost:${FAKE_PORT}" "old0000sha111" >/tmp/dlib-assert-match.txt 2>&1
RC_MATCH=$?
set -e 2>/dev/null || true

kill "$FAKE_PID" 2>/dev/null || true

if [ "$RC_MISMATCH" -ne 0 ]; then ok "F sha 不符 assert_version 真返非0（proven-to-fire）"; else bad "F sha 不符 assert_version 应返非0"; fi
if [ "$RC_MATCH" -eq 0 ]; then ok "F2 sha 相符 assert_version 返0"; else bad "F2 sha 相符 assert_version 应返0"; fi

# --- kill_port 幂等 ---
set +e
kill_port 53998 >/tmp/dlib-killport.txt 2>&1
RC_KILL=$?
set -e 2>/dev/null || true
if [ "$RC_KILL" -eq 0 ]; then ok "G kill_port 空闲端口幂等返0"; else bad "G kill_port 应返0"; fi

# ════════════════════════════════════════════════════════════════════════════
# release 隔离原语（releases/<sha>/ + current 软链）—— 生产 launchd 从 current 跑，
# promote=原子重指 current、rollback=软链回上一 release（不再 git reset 工作树）。
# ════════════════════════════════════════════════════════════════════════════
SANDBOX="$(mktemp -d)"
RELROOT="$SANDBOX/releases"
mkdir -p "$RELROOT"

# --- H: release_dir_for 拼出 <root>/<sha> ---
H_OUT="$(release_dir_for "$RELROOT" "deadbeef123")"
if [ "$H_OUT" = "$RELROOT/deadbeef123" ]; then ok "H release_dir_for 拼出 <root>/<sha>"; else bad "H release_dir_for（实际=$H_OUT）"; fi

# --- I: atomic_repoint_current 原子重指 + current_release_sha 读回 ---
mkdir -p "$RELROOT/aaaaaaa1111" "$RELROOT/bbbbbbb2222"
atomic_repoint_current "$RELROOT" "$RELROOT/aaaaaaa1111" >/dev/null 2>&1
I_SHA1="$(current_release_sha "$RELROOT")"
if [ "$I_SHA1" = "aaaaaaa1111" ]; then ok "I current 指向 aaaaaaa1111"; else bad "I current 应指向 aaaaaaa1111（实际=$I_SHA1）"; fi
# 软链是真软链且指向目标目录
if [ -L "$RELROOT/current" ] && [ "$(readlink "$RELROOT/current")" = "$RELROOT/aaaaaaa1111" ]; then
  ok "I current 是软链且指向 aaaaaaa1111"
else
  bad "I current 软链不对（readlink=$(readlink "$RELROOT/current" 2>/dev/null))"
fi

# --- J: 重指到新 release 后 current 立即指向新的、不悬空 ---
atomic_repoint_current "$RELROOT" "$RELROOT/bbbbbbb2222" >/dev/null 2>&1
J_SHA="$(current_release_sha "$RELROOT")"
# current 必须解析到一个真实存在的目录（不悬空）
if [ "$J_SHA" = "bbbbbbb2222" ] && [ -d "$RELROOT/current/" ]; then
  ok "J 切换后 current 立即指向 bbbbbbb2222 且解析到真实目录（不悬空）"
else
  bad "J 切换后 current 不对（sha=$J_SHA dir存在=$([ -d "$RELROOT/current/" ] && echo y || echo n)）"
fi

# --- K: prune_old_releases 保留最新 N、删旧、绝不删 current 指向的 release ---
# 造 4 个 release 目录，mtime 递增（c 最老 → f 最新），current 指向最老的 c。
PR_ROOT="$SANDBOX/prune"; mkdir -p "$PR_ROOT"
for d in ccccccc1 ddddddd2 eeeeeee3 fffffff4; do mkdir -p "$PR_ROOT/$d"; done
touch -t 202601010001 "$PR_ROOT/ccccccc1"
touch -t 202601020001 "$PR_ROOT/ddddddd2"
touch -t 202601030001 "$PR_ROOT/eeeeeee3"
touch -t 202601040001 "$PR_ROOT/fffffff4"
atomic_repoint_current "$PR_ROOT" "$PR_ROOT/ccccccc1" >/dev/null 2>&1   # current=最老的 c
prune_old_releases "$PR_ROOT" 2 >/dev/null 2>&1
# 期望：保留最新 2 个（e,f）+ current 指向的 c（绝不删）；删掉 d。
if [ -d "$PR_ROOT/fffffff4" ] && [ -d "$PR_ROOT/eeeeeee3" ]; then ok "K 保留最新 2 个 release"; else bad "K 最新 2 个被误删"; fi
if [ -d "$PR_ROOT/ccccccc1" ]; then ok "K current 指向的 release 绝不被删（即便它最老）"; else bad "K current 指向的 release 被误删了！"; fi
if [ ! -d "$PR_ROOT/ddddddd2" ]; then ok "K 旧 release（非 current、超出 keep）被删"; else bad "K 旧 release 没被删"; fi

rm -rf "$SANDBOX"

# Case P: list_releases / previous_release —— 人工回滚的"留存清单 + 上一版"判定（纯函数）。
# previous_release = mtime 新→旧里紧跟 current 之后的那个；current 是最老时返空（无可回退）。
# ════════════════════════════════════════════════════════════════════════════
PBOX="$(mktemp -d)"; PREL="$PBOX/releases"; mkdir -p "$PREL"
# 造 4 个 release，mtime 递增（r1 最老 → r4 最新）
for d in r1aaaaa r2bbbbb r3ccccc r4ddddd; do mkdir -p "$PREL/$d"; done
touch -t 202601010001 "$PREL/r1aaaaa"
touch -t 202601020001 "$PREL/r2bbbbb"
touch -t 202601030001 "$PREL/r3ccccc"
touch -t 202601040001 "$PREL/r4ddddd"

# list_releases 新→旧
P_LIST="$(list_releases "$PREL" | tr '\n' ',')"
expect_eq "$P_LIST" "r4ddddd,r3ccccc,r2bbbbb,r1aaaaa," "P list_releases 新→旧排序"

# current=r3ccccc → previous=r2bbbbb（紧跟其后的更旧一个）
atomic_repoint_current "$PREL" "$PREL/r3ccccc" >/dev/null 2>&1
expect_eq "$(previous_release "$PREL")" "r2bbbbb" "P previous_release(current=r3)→r2"

# current=最新 r4 → previous=r3
atomic_repoint_current "$PREL" "$PREL/r4ddddd" >/dev/null 2>&1
expect_eq "$(previous_release "$PREL")" "r3ccccc" "P previous_release(current=最新r4)→r3"

# current=最老 r1 → 无更旧可回退 → 空
atomic_repoint_current "$PREL" "$PREL/r1aaaaa" >/dev/null 2>&1
expect_eq "$(previous_release "$PREL")" "" "P previous_release(current=最老r1)→空（无可回退）"

# list_releases 排除 current/staging 软链（只列真 release sha 目录）
ln -sfn "$PREL/r2bbbbb" "$PREL/staging" 2>/dev/null || true
P_LIST2="$(list_releases "$PREL" | grep -cE '^(current|staging)$' || true)"
expect_eq "$P_LIST2" "0" "P list_releases 不含 current/staging 软链"
rm -rf "$PBOX"

# ════════════════════════════════════════════════════════════════════════════
# Case Q: rollback.sh 入口的【挑哪个 + 安全校验】逻辑（注入 mock staging_rollback，不碰真生产）。
# 钩子：ZJ_DEPLOY_LIB 指向一个 stub lib（复用真 deploy-lib 的纯函数，但把 staging_rollback 换成
# 只把目标 sha 写进文件的 mock）→ 跑 rollback.sh → 断言它选对了目标 / 该报错时报错退出。
# 这样 promote v1→v2→rollback→断言"回退目标=v1"在本地临时目录里完整走通，绝不重启真 :5200。
# ════════════════════════════════════════════════════════════════════════════
ROLLBACK_SH="$SCRIPT_DIR/../../../rollback.sh"   # repo 根的 rollback.sh
if [ ! -f "$ROLLBACK_SH" ]; then
  bad "Q 找不到 rollback.sh（$ROLLBACK_SH）"
else
  QBOX="$(mktemp -d)"; QREL="$QBOX/releases"; mkdir -p "$QREL"
  # stub lib：source 真 deploy-lib 拿纯函数，再覆盖 staging_rollback 为 mock（写目标到 $Q_HIT）
  cat > "$QBOX/stub-lib.sh" <<STUB
# shellcheck source=/dev/null
source "$SCRIPT_DIR/deploy-lib.sh"
staging_rollback() { echo "\$1" > "$QBOX/hit.txt"; return 0; }
STUB

  # 模拟 promote v1→v2：建两个 release，current 指向 v2（最新），v1 是上一版
  mkdir -p "$QREL/v1aaaaaa" "$QREL/v2bbbbbb"
  touch -t 202601010001 "$QREL/v1aaaaaa"
  touch -t 202601020001 "$QREL/v2bbbbbb"
  atomic_repoint_current "$QREL" "$QREL/v2bbbbbb" >/dev/null 2>&1

  run_rollback() {
    ZJ_DEPLOY_LIB="$QBOX/stub-lib.sh" ZJ_RELEASES_DIR="$QREL" \
      bash "$ROLLBACK_SH" "$@" >/tmp/dlib-rollback-out.txt 2>&1
  }

  # 注意：上面已有 case 把 errexit 打开（行 68/79 等 `set -e 2>/dev/null||true`），到这里仍生效。
  # rollback.sh 该报错的分支会 exit 1，errexit 下会连累本测试脚本一起退出 → 关掉 errexit 跑 Q 块
  # （与本文件 sha/kill_port 段的 `set +e` 同款做法），块末再恢复。
  set +e

  # Q1 无参 → 应回退到上一版 v1（promote v1→v2→rollback→断言软链/目标回 v1）
  rm -f "$QBOX/hit.txt"
  run_rollback; Q1_RC=$?
  Q1_HIT="$(cat "$QBOX/hit.txt" 2>/dev/null || echo "")"
  if [ "$Q1_RC" -eq 0 ] && [ "$Q1_HIT" = "v1aaaaaa" ]; then
    ok "Q 无参 rollback 选中上一版 v1（promote v1→v2→rollback→回 v1）"
  else
    bad "Q 无参 rollback 应回 v1aaaaaa（rc=$Q1_RC hit=$Q1_HIT）"
  fi

  # Q2 带不存在的 sha → 报错退出（绝不臆造），不调 staging_rollback
  rm -f "$QBOX/hit.txt"
  run_rollback "nosuchsha999"; Q2_RC=$?
  if [ "$Q2_RC" -ne 0 ] && [ ! -f "$QBOX/hit.txt" ]; then
    ok "Q 带不在留存的 sha → 报错退出且不回滚（proven-to-fire）"
  else
    bad "Q 不存在 sha 应报错退出不回滚（rc=$Q2_RC hit=$(cat "$QBOX/hit.txt" 2>/dev/null))"
  fi

  # Q3 带留存内的 sha v1 → 选中 v1
  rm -f "$QBOX/hit.txt"
  run_rollback "v1aaaaaa"; Q3_RC=$?
  Q3_HIT="$(cat "$QBOX/hit.txt" 2>/dev/null || echo "")"
  if [ "$Q3_RC" -eq 0 ] && [ "$Q3_HIT" = "v1aaaaaa" ]; then
    ok "Q 带留存内 sha v1 → 选中 v1 回滚"
  else
    bad "Q 带留存 sha 应回 v1（rc=$Q3_RC hit=$Q3_HIT）"
  fi

  # Q4 带 = current 的 sha → 拒绝（无需回滚），不调 staging_rollback
  rm -f "$QBOX/hit.txt"
  run_rollback "v2bbbbbb"; Q4_RC=$?
  if [ "$Q4_RC" -ne 0 ] && [ ! -f "$QBOX/hit.txt" ]; then
    ok "Q 带 = current 的 sha → 拒绝（无需回滚）"
  else
    bad "Q current sha 应被拒（rc=$Q4_RC hit=$(cat "$QBOX/hit.txt" 2>/dev/null))"
  fi

  # Q5 --list → 列出留存且不调 staging_rollback（只读）
  rm -f "$QBOX/hit.txt"
  run_rollback --list; Q5_RC=$?
  if [ "$Q5_RC" -eq 0 ] && [ ! -f "$QBOX/hit.txt" ] && grep -q "v2bbbbbb" /tmp/dlib-rollback-out.txt; then
    ok "Q --list 只读列出留存（不回滚）"
  else
    bad "Q --list 应只读列出（rc=$Q5_RC hit=$(cat "$QBOX/hit.txt" 2>/dev/null))"
  fi
  set -e 2>/dev/null || true
  rm -rf "$QBOX"
fi

# ════════════════════════════════════════════════════════════════════════════
# Case R: dashboard_release_promote / dashboard_release_rollback —— HK Dashboard
# release 隔离编排（复用 sha-keyed 原语 + dist 软链）。纯目录/软链操作，本地临时目录单测。
# 模拟 HK 上 /opt/zenithjoy/autopilot-dashboard/，绝不碰真 HK、绝不 docker。
# ════════════════════════════════════════════════════════════════════════════
RBOX="$(mktemp -d)"; DASH="$RBOX/autopilot-dashboard"
mkdir -p "$DASH" "$RBOX/built_v1" "$RBOX/built_v2"
echo "v1-content" > "$RBOX/built_v1/index.html"
echo "v2-content" > "$RBOX/built_v2/index.html"

set +e   # 部分 case 探测返非0，关 errexit（同 Q/F 段做法），块末恢复

dashboard_release_promote "$DASH" "dv1aaaaa" "$RBOX/built_v1" 5 >/dev/null 2>&1; R_RC1=$?
sleep 1
dashboard_release_promote "$DASH" "dv2bbbbb" "$RBOX/built_v2" 5 >/dev/null 2>&1; R_RC2=$?
if [ "$R_RC1" -eq 0 ] && [ "$R_RC2" -eq 0 ]; then ok "R dashboard promote v1/v2 返0"; else bad "R dashboard promote 返非0（$R_RC1/$R_RC2）"; fi

expect_eq "$(readlink "$DASH/dist")" "$DASH/releases/current" "R dist 软链 → releases/current"
expect_eq "$(current_release_sha "$DASH/releases")" "dv2bbbbb" "R releases/current → v2"
expect_eq "$(cat "$DASH/dist/index.html")" "v2-content" "R dist 内容解析到 v2（穿透两层软链）"

dashboard_release_promote "$DASH" "dv3ccccc" "$RBOX/nonexist" 5 >/dev/null 2>&1; R_EMPTY=$?
if [ "$R_EMPTY" -ne 0 ]; then ok "R build 产物不存在→promote 返非0（不造空 release）"; else bad "R 空 build 应返非0"; fi

dashboard_release_rollback "$DASH" "dv1aaaaa" >/dev/null 2>&1; R_RB=$?
expect_eq "$(current_release_sha "$DASH/releases")" "dv1aaaaa" "R rollback → releases/current=v1"
expect_eq "$(cat "$DASH/dist/index.html")" "v1-content" "R rollback 后 dist 内容=v1（promote v1→v2→rollback→回 v1）"
if [ "$R_RB" -eq 0 ]; then ok "R dashboard_release_rollback 返0"; else bad "R rollback 返非0"; fi

dashboard_release_rollback "$DASH" "nosuch999" >/dev/null 2>&1; R_BAD=$?
if [ "$R_BAD" -ne 0 ]; then ok "R rollback 到不存在 release→返非0"; else bad "R 不存在 release 应返非0"; fi

# prune：再 promote 到第 7 个，keep=5 → 只剩最新 5 个，最老 v1 被删
i=3
for s in dv3ccccc dv4ddddd dv5eeeee dv6fffff dv7ggggg; do
  mkdir -p "$RBOX/b$i"; echo "c$i" > "$RBOX/b$i/index.html"
  dashboard_release_promote "$DASH" "$s" "$RBOX/b$i" 5 >/dev/null 2>&1
  sleep 1; i=$((i+1))
done
R_COUNT="$(list_releases "$DASH/releases" | wc -l | tr -d ' ')"
expect_eq "$R_COUNT" "5" "R prune 后留存 5 个 release"
if [ ! -d "$DASH/releases/dv1aaaaa" ]; then ok "R 最老 v1 被 prune 删"; else bad "R v1 应被删"; fi

set -e 2>/dev/null || true
rm -rf "$RBOX"

# ════════════════════════════════════════════════════════════════════════════
# Case S: rollback.sh dashboard 路径（挑哪个 + 校验，本地临时目录，不碰真 HK/docker）。
# dashboard 编排是纯软链操作无需 mock，直接真跑；API 路径用 mock staging_rollback 防误跑 launchctl。
# 断言 promote v1→v2→dashboard rollback→releases/current 回 v1；并验 API 路径向后兼容。
# ════════════════════════════════════════════════════════════════════════════
ROLLBACK_SH="$SCRIPT_DIR/../../../rollback.sh"
if [ ! -f "$ROLLBACK_SH" ]; then
  bad "S 找不到 rollback.sh（$ROLLBACK_SH）"
else
  SBOX="$(mktemp -d)"; SDASH="$SBOX/autopilot-dashboard"
  mkdir -p "$SDASH" "$SBOX/bv1" "$SBOX/bv2"
  echo "sv1" > "$SBOX/bv1/index.html"; echo "sv2" > "$SBOX/bv2/index.html"
  dashboard_release_promote "$SDASH" "sv1aaaaa" "$SBOX/bv1" 5 >/dev/null 2>&1
  sleep 1
  dashboard_release_promote "$SDASH" "sv2bbbbb" "$SBOX/bv2" 5 >/dev/null 2>&1

  cat > "$SBOX/stub-lib.sh" <<STUB
# shellcheck source=/dev/null
source "$SCRIPT_DIR/deploy-lib.sh"
staging_rollback() { echo "\$1" > "$SBOX/api_hit.txt"; return 0; }
STUB

  set +e   # rollback.sh 报错分支 exit 1，errexit 下会连累测试脚本（同 Case Q）

  run_dash() { ZJ_DEPLOY_LIB="$SBOX/stub-lib.sh" ZJ_DASHBOARD_DIR="$SDASH" \
    bash "$ROLLBACK_SH" dashboard "$@" >/tmp/dlib-dash-out.txt 2>&1; }

  run_dash --list; S1_RC=$?
  if [ "$S1_RC" -eq 0 ] && grep -q "sv2bbbbb" /tmp/dlib-dash-out.txt \
     && [ "$(current_release_sha "$SDASH/releases")" = "sv2bbbbb" ]; then
    ok "S dashboard --list 只读列出（current 不动）"
  else
    bad "S dashboard --list 应只读（rc=$S1_RC current=$(current_release_sha "$SDASH/releases"))"
  fi

  run_dash; S2_RC=$?
  if [ "$S2_RC" -eq 0 ] && [ "$(current_release_sha "$SDASH/releases")" = "sv1aaaaa" ] \
     && [ "$(cat "$SDASH/dist/index.html")" = "sv1" ]; then
    ok "S dashboard 无参 rollback→v1（promote v1→v2→rollback→回 v1，dist 内容=v1）"
  else
    bad "S dashboard 无参应回 v1（rc=$S2_RC current=$(current_release_sha "$SDASH/releases"))"
  fi

  run_dash "nosuchdash"; S3_RC=$?
  if [ "$S3_RC" -ne 0 ] && [ "$(current_release_sha "$SDASH/releases")" = "sv1aaaaa" ]; then
    ok "S dashboard 不存在 sha→报错退出且 current 不变"
  else
    bad "S dashboard 不存在 sha 应报错不切（rc=$S3_RC current=$(current_release_sha "$SDASH/releases"))"
  fi

  # API 向后兼容：不带 api/dashboard 关键字 + 留存 API release → 走 API 调 mock staging_rollback
  mkdir -p "$SBOX/apirel/a111111" "$SBOX/apirel/b222222"
  touch -t 202601010001 "$SBOX/apirel/a111111"; touch -t 202601020001 "$SBOX/apirel/b222222"
  ln -sfn "$SBOX/apirel/b222222" "$SBOX/apirel/current"
  rm -f "$SBOX/api_hit.txt"
  ZJ_DEPLOY_LIB="$SBOX/stub-lib.sh" ZJ_RELEASES_DIR="$SBOX/apirel" \
    bash "$ROLLBACK_SH" >/tmp/dlib-api-bc.txt 2>&1
  S4_RC=$?
  S4_HIT="$(cat "$SBOX/api_hit.txt" 2>/dev/null || echo "")"
  if [ "$S4_RC" -eq 0 ] && [ "$S4_HIT" = "a111111" ]; then
    ok "S API 向后兼容：无关键字仍走 API，回上一版 a111111"
  else
    bad "S API 向后兼容应回 a111111（rc=$S4_RC hit=$S4_HIT）"
  fi

  set -e 2>/dev/null || true
  rm -rf "$SBOX"
fi


echo "deploy-lib.test.sh: PASSED=$PASSED FAILED=$FAILED"
[ "$FAILED" -eq 0 ]
