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
# Case L: ensure_staging_plist 从生产 plist 程序化派生 staging plist（PORT/DB/Label/Program 覆写 + 密钥继承）
# Case M: ensure_release_node_modules 在 release node_modules 为空时从 hoisted 根兜底填充
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

# ════════════════════════════════════════════════════════════════════════════
# Case L: ensure_staging_plist —— 从生产 plist 程序化派生 staging plist。
# 治根（2026-06-25 真实事故）：部署机只有生产 com.zenithjoy.api.plist，没有 staging plist，
# launchctl start 不存在的 label 是静默空操作 → :5201 永不 listen → 部署红。
# 派生规则：Label/PORT/DATABASE_NAME/NODE_ENV/ProgramArguments/WorkingDirectory/日志路径 覆写，
# 其余 env（密钥）整段从生产继承。纯文件操作，可单测（不触碰真 launchctl）。
# ════════════════════════════════════════════════════════════════════════════
LBOX="$(mktemp -d)"
# 造一个最小生产 plist（含 1 个"密钥"env 验证继承 + PORT/DB/Label/Program 待覆写）
cat > "$LBOX/prod.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>5200</string>
    <key>DATABASE_NAME</key><string>cecelia</string>
    <key>NODE_ENV</key><string>production</string>
    <key>ZENITHJOY_API_URL</key><string>http://localhost:5200</string>
    <key>SOME_SECRET</key><string>super-secret-value-123</string>
  </dict>
  <key>Label</key><string>com.zenithjoy.api</string>
  <key>ProgramArguments</key>
  <array><string>/opt/homebrew/bin/node</string><string>/repo/apps/api/dist/index.js</string></array>
  <key>WorkingDirectory</key><string>/repo/apps/api</string>
  <key>StandardOutPath</key><string>/logs/api.log</string>
  <key>StandardErrorPath</key><string>/logs/api.error.log</string>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLIST

L_OUT="$LBOX/com.zenithjoy.api.staging.plist"
ZJ_PROD_PLIST="$LBOX/prod.plist" \
ZJ_STAGING_PLIST="$L_OUT" \
ZJ_STAGING_PORT=5201 \
ZJ_STAGING_DB=zenithjoy_test \
ZJ_STAGING_LABEL=com.zenithjoy.api.staging \
ZJ_RELEASES_DIR=/fake/releases \
ZJ_NODE=/opt/homebrew/bin/node \
ZJ_STAGING_LOG_DIR="$LBOX/logs" \
  ensure_staging_plist >/dev/null 2>&1
L_RC=$?

if [ "$L_RC" -eq 0 ] && [ -f "$L_OUT" ]; then ok "L ensure_staging_plist 生成了 staging plist"; else bad "L 没生成 staging plist（rc=$L_RC）"; fi

# 用 python plistlib 读回断言（与生产实现一致的读取方式）
_lread() { /usr/bin/python3 - "$L_OUT" "$1" <<'PY'
import plistlib,sys
d=plistlib.load(open(sys.argv[1],'rb'))
key=sys.argv[2]
if key.startswith("env:"):
    print(d.get("EnvironmentVariables",{}).get(key[4:],""))
elif key=="program1":
    print(d.get("ProgramArguments",["",""])[1] if len(d.get("ProgramArguments",[]))>1 else "")
else:
    print(d.get(key,""))
PY
}
[ "$(_lread Label)" = "com.zenithjoy.api.staging" ] && ok "L Label→staging" || bad "L Label 应=com.zenithjoy.api.staging（实际=$(_lread Label)）"
[ "$(_lread env:PORT)" = "5201" ] && ok "L PORT→5201" || bad "L PORT 应=5201（实际=$(_lread env:PORT)）"
[ "$(_lread env:DATABASE_NAME)" = "zenithjoy_test" ] && ok "L DATABASE_NAME→zenithjoy_test" || bad "L DB 应=zenithjoy_test（实际=$(_lread env:DATABASE_NAME)）"
[ "$(_lread env:ZENITHJOY_API_URL)" = "http://localhost:5201" ] && ok "L ZENITHJOY_API_URL→:5201" || bad "L API_URL 应=:5201（实际=$(_lread env:ZENITHJOY_API_URL)）"
[ "$(_lread env:SOME_SECRET)" = "super-secret-value-123" ] && ok "L 密钥从生产继承" || bad "L 密钥未继承（实际=$(_lread env:SOME_SECRET)）"
[ "$(_lread program1)" = "/fake/releases/staging/dist/index.js" ] && ok "L Program→releases/staging/dist/index.js" || bad "L Program 应指向 releases/staging（实际=$(_lread program1)）"
[ "$(_lread WorkingDirectory)" = "/fake/releases/staging" ] && ok "L WorkingDir→releases/staging" || bad "L WorkingDir 应=releases/staging（实际=$(_lread WorkingDirectory)）"

# 幂等：再跑一次仍成功且结果一致
ZJ_PROD_PLIST="$LBOX/prod.plist" ZJ_STAGING_PLIST="$L_OUT" ZJ_STAGING_PORT=5201 \
ZJ_STAGING_DB=zenithjoy_test ZJ_STAGING_LABEL=com.zenithjoy.api.staging \
ZJ_RELEASES_DIR=/fake/releases ZJ_NODE=/opt/homebrew/bin/node ZJ_STAGING_LOG_DIR="$LBOX/logs" \
  ensure_staging_plist >/dev/null 2>&1
[ "$(_lread env:PORT)" = "5201" ] && ok "L 幂等：二次运行仍正确" || bad "L 幂等失败"

# 生产 plist 不存在 → 返非0（拒绝凭空造）
set +e
ZJ_PROD_PLIST="$LBOX/nonexistent.plist" ZJ_STAGING_PLIST="$LBOX/x.plist" ZJ_STAGING_PORT=5201 \
ZJ_STAGING_DB=zenithjoy_test ZJ_STAGING_LABEL=com.zenithjoy.api.staging \
ZJ_RELEASES_DIR=/fake/releases ZJ_NODE=/opt/homebrew/bin/node \
  ensure_staging_plist >/dev/null 2>&1
L_NOPROD=$?
set -e 2>/dev/null || true
[ "$L_NOPROD" -ne 0 ] && ok "L 生产 plist 缺失→返非0（不凭空造）" || bad "L 生产 plist 缺失应返非0"

rm -rf "$LBOX"

# ════════════════════════════════════════════════════════════════════════════
# Case M: ensure_release_node_modules —— monorepo hoist 兜底。
# 治根（2026-06-25 真实事故）：依赖 hoist 到 repo 根 node_modules，apps/api/node_modules 是空目录，
# build_release 拷空 node_modules → release 跑 node 报 Cannot find module 'dotenv' → :5201 起不来。
# 规则：release node_modules 缺 dotenv（哨兵模块）时，从 hoisted 根 node_modules 兜底填充（symlink）。
# ════════════════════════════════════════════════════════════════════════════
MBOX="$(mktemp -d)"
# 造 hoisted 根 node_modules（含哨兵 dotenv）+ release 目录（node_modules 为空）
mkdir -p "$MBOX/root_nm/dotenv" "$MBOX/root_nm/express"
echo '{}' > "$MBOX/root_nm/dotenv/package.json"
mkdir -p "$MBOX/rel/node_modules"   # 空 node_modules（模拟 hoist 后 release 拷到空的）
mkdir -p "$MBOX/rel/dist"; echo "x" > "$MBOX/rel/dist/index.js"

ensure_release_node_modules "$MBOX/rel" "$MBOX/root_nm" >/dev/null 2>&1
M_RC=$?
if [ "$M_RC" -eq 0 ] && [ -e "$MBOX/rel/node_modules/dotenv/package.json" ]; then
  ok "M release node_modules 空→从 hoisted 根兜底填充（dotenv 可解析）"
else
  bad "M 兜底失败（rc=$M_RC，dotenv 存在=$([ -e "$MBOX/rel/node_modules/dotenv/package.json" ] && echo y || echo n)）"
fi

# 已自带依赖（含 dotenv）时不应覆盖
mkdir -p "$MBOX/rel2/node_modules/dotenv" "$MBOX/rel2/dist"
echo '{"self":true}' > "$MBOX/rel2/node_modules/dotenv/package.json"
echo "y" > "$MBOX/rel2/dist/index.js"
ensure_release_node_modules "$MBOX/rel2" "$MBOX/root_nm" >/dev/null 2>&1
if grep -q '"self":true' "$MBOX/rel2/node_modules/dotenv/package.json" 2>/dev/null; then
  ok "M release 已自带依赖→不覆盖"
else
  bad "M 不该覆盖自带依赖"
fi
rm -rf "$MBOX"

echo ""
echo "deploy-lib.test.sh: PASSED=$PASSED FAILED=$FAILED"
[ "$FAILED" -eq 0 ]
