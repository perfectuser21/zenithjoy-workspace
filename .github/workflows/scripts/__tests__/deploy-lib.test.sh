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
sleep 1

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

echo ""
echo "deploy-lib.test.sh: PASSED=$PASSED FAILED=$FAILED"
[ "$FAILED" -eq 0 ]
