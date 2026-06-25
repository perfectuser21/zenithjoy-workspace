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
# Case N: ensure_prod_plist_points_to_current 把生产 plist 改指 releases/current（只改路径/不碰密钥/幂等/不碰真 plist）
# Case O: promote 的生产 migration 从主 checkout（有 db/migrations 源）跑，不从 release 产物目录跑（防 Cannot find module 回归）
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
    <key>BETTER_AUTH_URL</key><string>https://autopilot.zenjoymedia.media</string>
    <key>BETTER_AUTH_TRUSTED_ORIGINS</key><string>https://autopilot.zenjoymedia.media</string>
    <key>AGENT_PUBLIC_WS_URL</key><string>wss://autopilot.zenjoymedia.media/agent-ws</string>
    <key>AGENT_PUBLIC_BASE_URL</key><string>https://autopilot.zenjoymedia.media</string>
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
expect_eq "$(_lread Label)" "com.zenithjoy.api.staging" "L Label→staging"
expect_eq "$(_lread env:PORT)" "5201" "L PORT→5201"
expect_eq "$(_lread env:DATABASE_NAME)" "zenithjoy_test" "L DATABASE_NAME→zenithjoy_test"
expect_eq "$(_lread env:ZENITHJOY_API_URL)" "http://localhost:5201" "L ZENITHJOY_API_URL→:5201"
# 回归（2026-06-25 invalid origin 事故）：生产 plist 的 better-auth 是 autopilot 域名，
# staging 必须收口到 staging 域名，否则从 staging-autopilot 登录被判 invalid origin（403）。
expect_eq "$(_lread env:BETTER_AUTH_URL)" "https://staging-autopilot.zenjoymedia.media" "L BETTER_AUTH_URL→staging（不漏生产 autopilot）"
expect_eq "$(_lread env:BETTER_AUTH_TRUSTED_ORIGINS)" "https://staging-autopilot.zenjoymedia.media,http://localhost:5173" "L TRUSTED_ORIGINS→staging（不漏生产 autopilot）"
# 回归（2026-06-25 agent→staging 事故）：生产 plist 的 AGENT_PUBLIC_* 是 autopilot，staging 必须收口到
# staging-autopilot，否则从 staging 下载的 agent 连生产。
expect_eq "$(_lread env:AGENT_PUBLIC_WS_URL)" "wss://staging-autopilot.zenjoymedia.media/agent-ws" "L AGENT_PUBLIC_WS_URL→staging（不漏生产 autopilot）"
expect_eq "$(_lread env:AGENT_PUBLIC_BASE_URL)" "https://staging-autopilot.zenjoymedia.media" "L AGENT_PUBLIC_BASE_URL→staging（不漏生产 autopilot）"
expect_eq "$(_lread env:SOME_SECRET)" "super-secret-value-123" "L 密钥从生产继承"
expect_eq "$(_lread program1)" "/fake/releases/staging/dist/index.js" "L Program→releases/staging/dist/index.js"
expect_eq "$(_lread WorkingDirectory)" "/fake/releases/staging" "L WorkingDir→releases/staging"

# 幂等：再跑一次仍成功且结果一致
ZJ_PROD_PLIST="$LBOX/prod.plist" ZJ_STAGING_PLIST="$L_OUT" ZJ_STAGING_PORT=5201 \
ZJ_STAGING_DB=zenithjoy_test ZJ_STAGING_LABEL=com.zenithjoy.api.staging \
ZJ_RELEASES_DIR=/fake/releases ZJ_NODE=/opt/homebrew/bin/node ZJ_STAGING_LOG_DIR="$LBOX/logs" \
  ensure_staging_plist >/dev/null 2>&1
expect_eq "$(_lread env:PORT)" "5201" "L 幂等：二次运行仍正确"

# 生产 plist 不存在 → 返非0（拒绝凭空造）
set +e
ZJ_PROD_PLIST="$LBOX/nonexistent.plist" ZJ_STAGING_PLIST="$LBOX/x.plist" ZJ_STAGING_PORT=5201 \
ZJ_STAGING_DB=zenithjoy_test ZJ_STAGING_LABEL=com.zenithjoy.api.staging \
ZJ_RELEASES_DIR=/fake/releases ZJ_NODE=/opt/homebrew/bin/node \
  ensure_staging_plist >/dev/null 2>&1
L_NOPROD=$?
set -e 2>/dev/null || true
if [ "$L_NOPROD" -ne 0 ]; then ok "L 生产 plist 缺失→返非0（不凭空造）"; else bad "L 生产 plist 缺失应返非0"; fi

# --- L2: committed 模板优先（模板为基 + 注入生产密钥 + staging 值收口，生产值不漏进）---
# 造一个 committed 模板（无密钥，自带 DB env + Program 指 releases/staging），断言：
#   · 模板的 ProgramArguments / DATABASE_USER 被采用
#   · 生产密钥 SOME_SECRET 被注入进来
#   · PORT/DATABASE_NAME/NODE_ENV 是 staging 值（绝不是生产的 5200/cecelia/production）
cat > "$LBOX/template.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.zenithjoy.api.staging</string>
  <key>ProgramArguments</key>
  <array><string>/opt/homebrew/bin/node</string><string>/tmpl/releases/staging/dist/index.js</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>5201</string>
    <key>DATABASE_NAME</key><string>zenithjoy_test</string>
    <key>DATABASE_USER</key><string>cecelia</string>
    <key>NODE_ENV</key><string>staging</string>
  </dict>
  <key>WorkingDirectory</key><string>/tmpl/releases/staging</string>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLIST
L2_OUT="$LBOX/from-template.plist"
ZJ_PROD_PLIST="$LBOX/prod.plist" ZJ_STAGING_TEMPLATE="$LBOX/template.plist" \
ZJ_STAGING_PLIST="$L2_OUT" ZJ_STAGING_PORT=5201 ZJ_STAGING_DB=zenithjoy_test \
ZJ_STAGING_LABEL=com.zenithjoy.api.staging ZJ_RELEASES_DIR=/fake/releases \
ZJ_NODE=/opt/homebrew/bin/node ZJ_STAGING_LOG_DIR="$LBOX/logs" \
  ensure_staging_plist >/dev/null 2>&1
_l2read() { /usr/bin/python3 - "$L2_OUT" "$1" <<'PY'
import plistlib,sys
d=plistlib.load(open(sys.argv[1],'rb'))
k=sys.argv[2]
if k.startswith("env:"): print(d.get("EnvironmentVariables",{}).get(k[4:],""))
elif k=="program1": print(d.get("ProgramArguments",["",""])[1] if len(d.get("ProgramArguments",[]))>1 else "")
else: print(d.get(k,""))
PY
}
if [ -f "$L2_OUT" ]; then ok "L2 模板优先：生成了 staging plist"; else bad "L2 模板优先没生成"; fi
expect_eq "$(_l2read program1)" "/tmpl/releases/staging/dist/index.js" "L2 用模板的 ProgramArguments"
expect_eq "$(_l2read env:DATABASE_USER)" "cecelia" "L2 用模板的 DATABASE_USER"
expect_eq "$(_l2read env:SOME_SECRET)" "super-secret-value-123" "L2 注入生产密钥"
expect_eq "$(_l2read env:PORT)" "5201" "L2 PORT=staging 值（非生产5200）"
expect_eq "$(_l2read env:DATABASE_NAME)" "zenithjoy_test" "L2 DB=staging 值（非生产cecelia）"
expect_eq "$(_l2read env:NODE_ENV)" "staging" "L2 NODE_ENV=staging（非生产production）"
# 回归：模板派生路径同样必须把 better-auth 收口到 staging（staging_overrides 盖过生产继承）。
expect_eq "$(_l2read env:BETTER_AUTH_URL)" "https://staging-autopilot.zenjoymedia.media" "L2 BETTER_AUTH_URL→staging（不漏生产 autopilot）"
expect_eq "$(_l2read env:BETTER_AUTH_TRUSTED_ORIGINS)" "https://staging-autopilot.zenjoymedia.media,http://localhost:5173" "L2 TRUSTED_ORIGINS→staging（不漏生产 autopilot）"
expect_eq "$(_l2read env:AGENT_PUBLIC_WS_URL)" "wss://staging-autopilot.zenjoymedia.media/agent-ws" "L2 AGENT_PUBLIC_WS_URL→staging（不漏生产 autopilot）"
expect_eq "$(_l2read env:AGENT_PUBLIC_BASE_URL)" "https://staging-autopilot.zenjoymedia.media" "L2 AGENT_PUBLIC_BASE_URL→staging（不漏生产 autopilot）"

rm -rf "$LBOX"

# ════════════════════════════════════════════════════════════════════════════
# Case M: ensure_release_node_modules —— monorepo hoist 兜底（★方案 A 自包含：实体拷贝，非 symlink★）。
# 治根（2026-06-25 真实事故）：依赖 hoist 到 repo 根 node_modules，apps/api/node_modules 是空目录，
# build_release 拷空 node_modules → release 跑 node 报 Cannot find module 'dotenv' → :5201 起不来。
# 决策（lead 2026-06-25）：兜底必须**实体拷贝**根 node_modules 进 release（APFS 用 cp -c CoW），
# **不能 symlink**——symlink 会让 deploy 时 npm ci 改到正在跑的生产共享 node_modules，且跨依赖
# 变更 rollback 不干净。规则：release node_modules 缺 dotenv（哨兵）时，从根**实体拷**填充，
# 且 release/node_modules 必须是**真目录而非软链**。
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
# ★方案 A 关键断言：release/node_modules 必须是真目录、不是软链（自包含，与根解耦）
if [ -L "$MBOX/rel/node_modules" ]; then
  bad "M release node_modules 是软链（方案A 要求实体拷贝，不许 symlink 到根）"
else
  ok "M release node_modules 是真目录（自包含，非 symlink 到根）"
fi
# 自包含验证：删掉根 node_modules 后，release 里的 dotenv 仍在（证明是实体拷贝而非软链依赖根）
rm -rf "$MBOX/root_nm"
if [ -e "$MBOX/rel/node_modules/dotenv/package.json" ]; then
  ok "M 删掉根 node_modules 后 release 仍自带 dotenv（实体拷贝，rollback 干净）"
else
  bad "M 删根后 release dotenv 没了（说明是软链依赖根，方案A 不允许）"
fi
# 重新造根供后续子 case 用
mkdir -p "$MBOX/root_nm/dotenv"; echo '{}' > "$MBOX/root_nm/dotenv/package.json"

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

# ════════════════════════════════════════════════════════════════════════════
# Case N: ensure_prod_plist_points_to_current —— 让生产 plist 从 releases/current 跑（promote 真生效）。
# 治根（2026-06-25 缺口）：生产 plist 写死指主 checkout apps/api/dist/index.js，promote 重指
# releases/current 软链对生产实际跑什么零效果。本函数把 Program/WorkingDir 改指 releases/current，
# 只动两处路径、不碰 env/密钥/Label、幂等。纯文件操作可单测（用临时假 plist，绝不碰真生产 plist）。
# ════════════════════════════════════════════════════════════════════════════
NBOX="$(mktemp -d)"
cat > "$NBOX/prod.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.zenithjoy.api</string>
  <key>ProgramArguments</key>
  <array><string>/opt/homebrew/bin/node</string><string>/Users/x/perfect21/zenithjoy/apps/api/dist/index.js</string></array>
  <key>WorkingDirectory</key><string>/Users/x/perfect21/zenithjoy/apps/api</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>5200</string>
    <key>DATABASE_NAME</key><string>cecelia</string>
    <key>SOME_SECRET</key><string>prod-secret-xyz</string>
  </dict>
  <key>StandardOutPath</key><string>/logs/api.log</string>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLIST
ZJ_PROD_PLIST="$NBOX/prod.plist" ZJ_RELEASES_DIR=/fake/releases ZJ_NODE=/opt/homebrew/bin/node \
  ensure_prod_plist_points_to_current >/dev/null 2>&1
N_RC=$?
_nread() { /usr/bin/python3 - "$NBOX/prod.plist" "$1" <<'PY'
import plistlib,sys
d=plistlib.load(open(sys.argv[1],'rb'))
k=sys.argv[2]
if k.startswith("env:"): print(d.get("EnvironmentVariables",{}).get(k[4:],""))
elif k=="program0": print(d.get("ProgramArguments",["",""])[0] if d.get("ProgramArguments") else "")
elif k=="program1": print(d.get("ProgramArguments",["",""])[1] if len(d.get("ProgramArguments",[]))>1 else "")
else: print(d.get(k,""))
PY
}
if [ "$N_RC" -eq 0 ]; then ok "N ensure_prod_plist_points_to_current 跑通"; else bad "N 返非0（rc=$N_RC）"; fi
expect_eq "$(_nread program1)" "/fake/releases/current/dist/index.js" "N Program→releases/current/dist/index.js"
expect_eq "$(_nread WorkingDirectory)" "/fake/releases/current" "N WorkingDir→releases/current"
expect_eq "$(_nread program0)" "/opt/homebrew/bin/node" "N ProgramArguments[0] node 保留"
expect_eq "$(_nread Label)" "com.zenithjoy.api" "N Label 不动"
expect_eq "$(_nread env:SOME_SECRET)" "prod-secret-xyz" "N 密钥/env 原样保留（不碰）"
expect_eq "$(_nread env:DATABASE_NAME)" "cecelia" "N 生产 DB 不动（不改成 staging）"
# 幂等：再跑一次结果一致
ZJ_PROD_PLIST="$NBOX/prod.plist" ZJ_RELEASES_DIR=/fake/releases ZJ_NODE=/opt/homebrew/bin/node \
  ensure_prod_plist_points_to_current >/dev/null 2>&1
expect_eq "$(_nread program1)" "/fake/releases/current/dist/index.js" "N 幂等：二次运行仍正确"
# 生产 plist 不存在 → 返非0
set +e
ZJ_PROD_PLIST="$NBOX/nope.plist" ZJ_RELEASES_DIR=/fake/releases ensure_prod_plist_points_to_current >/dev/null 2>&1
N_NOPROD=$?
set -e 2>/dev/null || true
if [ "$N_NOPROD" -ne 0 ]; then ok "N 生产 plist 缺失→返非0"; else bad "N 生产 plist 缺失应返非0"; fi
# plutil 校验生成的 plist 合法（macOS 有 plutil 才跑）
if command -v plutil >/dev/null 2>&1; then
  if plutil -lint "$NBOX/prod.plist" >/dev/null 2>&1; then ok "N plutil -lint 生成的 plist 合法"; else bad "N plutil -lint 不通过"; fi
fi
rm -rf "$NBOX"

# ════════════════════════════════════════════════════════════════════════════
# Case O: promote 的生产 migration 必须从【有 db/migrations 源的目录】跑，不能从 release 产物目录跑。
# 治根（promote run 28148797888 实证）：release 是 build 产物（只有 dist，无 db/migrations/*.ts），
# `ts-node db/migrations/run-migration.ts` 在 release 目录解析不到源 → Cannot find module
# './run-migration.ts' → 每次 promote 卡死在迁移步。修法：promote 的迁移从主 checkout（ZJ_API_DIR，
# 有 db/migrations 源）跑。本 case proven-to-fire：迁移入口脚本只在"有源"的目录可解析，release 产物目录不可。
# 纯文件路径解析判断，不连真库、不跑真迁移。
# ════════════════════════════════════════════════════════════════════════════
OBOX="$(mktemp -d)"
MIGRATE_REL="db/migrations/run-migration.ts"
# 主 checkout 模拟：有 db/migrations 源
mkdir -p "$OBOX/checkout/db/migrations"; echo "// src" > "$OBOX/checkout/${MIGRATE_REL}"
# release 产物模拟：只有 dist，没有 db/migrations 源
mkdir -p "$OBOX/release/dist"; echo "x" > "$OBOX/release/dist/index.js"

# proven-to-fire：从 release 产物目录解析迁移入口 → 不存在（这就是旧 bug 的根因）
if [ ! -f "$OBOX/release/${MIGRATE_REL}" ]; then ok "O release 产物目录解析不到 ${MIGRATE_REL}（旧 bug 根因，proven-to-fire）"; else bad "O release 不该有迁移源"; fi
# 修法验证：从主 checkout 解析迁移入口 → 存在
if [ -f "$OBOX/checkout/${MIGRATE_REL}" ]; then ok "O 主 checkout 解析得到 ${MIGRATE_REL}（promote 迁移应从这里跑）"; else bad "O 主 checkout 应有迁移源"; fi

# staging_promote 源码守卫：迁移步必须 cd ZJ_API_DIR（主checkout），不能 cd reldir（release）。
# 防回归——避免有人改回从 release 目录跑。用 grep -F 固定串匹配迁移那行（避开 SC2016）。
PROMOTE_BODY="$(sed -n '/^staging_promote() {/,/^}/p' "$SCRIPT_DIR/deploy-lib.sh")"
MIGRATE_CTX="$(echo "$PROMOTE_BODY" | grep 'npm run migrate' | head -1)"
# 匹配源码里的字面量 cd "<var>"。用 $D 代表字面 $ 拼 needle，规避单引号内 ${} 触发 SC2016。
D='$'
O_API_NEEDLE="cd \"${D}{ZJ_API_DIR}\""
O_REL_NEEDLE="cd \"${D}{reldir}\""
if printf '%s' "$MIGRATE_CTX" | grep -qF -- "$O_API_NEEDLE"; then
  ok "O staging_promote 迁移从主 checkout(ZJ_API_DIR) 跑"
elif printf '%s' "$MIGRATE_CTX" | grep -qF -- "$O_REL_NEEDLE"; then
  bad "O staging_promote 迁移仍从 release 目录跑（旧 bug 没修）"
else
  bad "O staging_promote 迁移行无法识别 cwd：${MIGRATE_CTX}"
fi
rm -rf "$OBOX"

# ════════════════════════════════════════════════════════════════════════════
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

echo ""
echo "deploy-lib.test.sh: PASSED=$PASSED FAILED=$FAILED"
[ "$FAILED" -eq 0 ]
