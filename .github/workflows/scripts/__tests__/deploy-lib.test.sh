#!/usr/bin/env bash
# deploy-lib.test.sh — 验证发版自洽函数库核心逻辑。
#
# Case A: sha 完全相等 → 命中
# Case B: 短 sha 是全 sha 前缀 → 命中
# Case C: sha 不符 → 不命中（proven-to-fire：版本自检会报红）
# Case D: reported=unknown → 不命中（旧进程无 build-info）
# Case E: 空 → 不命中
# Case F: assert_version 对 sha 不符的 /version 真返 1（端到端 proven-to-fire）
# Case G: kill_port 对空闲端口幂等返 0
# Case H: release_dir_for 拼出 <root>/<sha>
# Case I: atomic_repoint_current 原子重指 current 软链 + current_release_sha 读回
# Case J: atomic_repoint_current 切换不留悬空——切换后 current 立即指向新 release
# Case K: prune_old_releases 保留最新 N 个、删旧的、绝不删 current 指向的 release
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/deploy-lib.sh"

PASSED=0; FAILED=0

ok() { echo "  PASS [$1]"; PASSED=$((PASSED+1)); }
bad() { echo "  FAIL [$1]"; FAILED=$((FAILED+1)); }

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

echo ""
echo "deploy-lib.test.sh: PASSED=$PASSED FAILED=$FAILED"
[ "$FAILED" -eq 0 ]
