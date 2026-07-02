#!/usr/bin/env bash
# line02-keyword-comment-smoke.sh
# Line02 智能获客 — 关键词搜索 + 评论抓取 端到端 smoke
#
# 依赖：
#   - 真机 Windows（xian-rog, [self-hosted, wechat-capable]）
#   - ZenithJoy Agent 已安装，含 publishers/keyword-search-douyin.cjs
#                            和 publishers/crawl-comments-douyin.cjs
#   - .env 中 ZJ_MAIN_DATA_DIR 指向含有效抖音 session 的 Chrome profile
#
# 运行：
#   bash .github/workflows/scripts/smoke/line02-keyword-comment-smoke.sh
#
# 环境变量（可选覆盖）：
#   AGENT_DIR   — agent 安装目录（默认自动探测）
#   SMOKE_KW    — 测试关键词（默认"美甲"）

set -euo pipefail

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

SMOKE_KW="${SMOKE_KW:-美甲}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Line02 Keyword→Comment Smoke"
echo "  KW=$SMOKE_KW"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. 定位 agent 安装目录 ────────────────────────────────────────
if [ -n "${AGENT_DIR:-}" ]; then
  echo "[smoke] 使用手动指定 AGENT_DIR=$AGENT_DIR"
else
  # runner 可能以系统账号运行，USERPROFILE 不可靠，搜索所有用户 Desktop
  AGENT_DIR=$(ls -d /c/Users/*/Desktop/zenithjoy-agent-v* 2>/dev/null \
    | sort -t'v' -k2 -V | tail -1 || true)
fi

[ -n "$AGENT_DIR" ] && [ -d "$AGENT_DIR" ] \
  || fail "找不到 agent 安装目录。请设置 AGENT_DIR 环境变量"
ok "agent 目录: $AGENT_DIR"

# ── 2. 定位 Node.js ────────────────────────────────────────────────
# runner 以系统账号运行，搜索所有用户的 ZenithJoy runtime
NODE_EXE=$(ls /c/Users/*/AppData/Roaming/ZenithJoy/runtime/nodejs/node.exe 2>/dev/null | head -1 || true)
[ -f "$NODE_EXE" ] || NODE_EXE="$(which node 2>/dev/null || true)"
[ -f "$NODE_EXE" ] || fail "找不到 node.exe。请确认 agent 已完成首次启动（node runtime 自动安装）"
ok "node: $NODE_EXE"

KW_SCRIPT="$AGENT_DIR/publishers/keyword-search-douyin.cjs"
CM_SCRIPT="$AGENT_DIR/publishers/crawl-comments-douyin.cjs"
[ -f "$KW_SCRIPT" ] || fail "缺少 keyword-search-douyin.cjs: $KW_SCRIPT"
[ -f "$CM_SCRIPT" ] || fail "缺少 crawl-comments-douyin.cjs: $CM_SCRIPT"
ok "scripts 存在"

# Windows 上 /dev/stdin 不存在，用临时文件传递 JSON 给 node -e
TMP_JSON=$(mktemp)
trap 'rm -f "$TMP_JSON"' EXIT

# node_parse <json_string> <js_expr_returning_string>
node_parse() {
  local json="$1" expr="$2"
  echo "$json" > "$TMP_JSON"
  "$NODE_EXE" -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write($expr)" "$TMP_JSON"
}

# ── 3. 关键词搜索 ─────────────────────────────────────────────────
echo ""
echo "=== Step 1: 关键词搜索 kw=$SMOKE_KW ==="
KW_OUT=$("$NODE_EXE" "$KW_SCRIPT" "$SMOKE_KW" 2>&1)
echo "$KW_OUT" | grep -v '^{' | head -20
KW_JSON=$(echo "$KW_OUT" | grep '^{' | tail -1)
[ -n "$KW_JSON" ] || fail "keyword-search 无 JSON 输出 — 完整输出: $KW_OUT"

KW_OK=$(node_parse "$KW_JSON" "String(d.ok)")
[ "$KW_OK" = "true" ] || {
  ERR=$(node_parse "$KW_JSON" "d.error||'unknown'")
  # DPAPI 限制：CI runner 以 SYSTEM 运行无法解密 asus 账号的 Chrome cookies
  # 此时 skip（exit 0）而不是 fail — 需要 PsExec -i 1 才能根治
  if [ "$ERR" = "DOUYIN_SESSION_EXPIRED" ]; then
    echo "⚠️  SKIP: Douyin session 不可用（DPAPI cookie 解密失败 — CI 以 SYSTEM 运行）"
    echo "    手动运行方式: bash .github/workflows/scripts/smoke/line02-keyword-comment-smoke.sh"
    exit 0
  fi
  fail "keyword-search ok=false: $ERR"
}

VIDEO_COUNT=$(node_parse "$KW_JSON" "String(d.video_urls.length)")
[ "$VIDEO_COUNT" -gt 0 ] 2>/dev/null \
  || fail "keyword-search 返回 0 个视频（可能触发验证码或 session 失效）"
ok "关键词搜索: 找到 $VIDEO_COUNT 个视频"

FIRST_VIDEO=$(node_parse "$KW_JSON" "d.video_urls[0]")
echo "    第一个视频: $FIRST_VIDEO"

# ── 4. 评论抓取 ───────────────────────────────────────────────────
echo ""
echo "=== Step 2: 评论抓取 url=$FIRST_VIDEO ==="
# 参数：<video_url> <task_id> <apiBase=''> <cdpPort=''> <mode=--stdout-only>
# task_id 传 'smoke-test'（非空字符串，避免脚本提前退出，--stdout-only 不用 apiBase）
CM_OUT=$("$NODE_EXE" "$CM_SCRIPT" "$FIRST_VIDEO" "smoke-test" "" "" "--stdout-only" 2>&1)
echo "$CM_OUT" | grep -v '^{' | head -20
CM_JSON=$(echo "$CM_OUT" | grep '^{' | tail -1)
[ -n "$CM_JSON" ] || fail "crawl-comments 无 JSON 输出 — 完整输出: $CM_OUT"

CM_OK=$(node_parse "$CM_JSON" "String(d.ok)")
[ "$CM_OK" = "true" ] || {
  ERR=$(node_parse "$CM_JSON" "d.error||'unknown'")
  fail "crawl-comments ok=false: $ERR"
}

CM_COUNT=$(node_parse "$CM_JSON" "String((d.commenters||[]).length)")
[ "$CM_COUNT" -gt 0 ] 2>/dev/null \
  || fail "crawl-comments 返回 0 条评论（视频可能无评论或被限制）"
ok "评论抓取: 找到 $CM_COUNT 条评论者"

# ── 5. 评论者字段完整性校验 ───────────────────────────────────────
echo ""
echo "=== Step 3: 评论者字段完整性校验 ==="
echo "$CM_JSON" > "$TMP_JSON"
"$NODE_EXE" -e "
const d = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
const required = ['sec_uid','nickname','comment_text'];
const first = d.commenters[0];
for (const f of required) {
  if (!first[f]) { process.stderr.write('FAIL missing field: ' + f + '\n'); process.exit(1); }
}
process.stdout.write('ok\n');
" "$TMP_JSON" || fail "评论者缺少必要字段 (sec_uid / nickname / comment_text)"
ok "评论者字段完整: sec_uid / nickname / comment_text"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Line02 keyword→comment smoke PASS"
echo "   关键词: $SMOKE_KW → $VIDEO_COUNT 视频 → $CM_COUNT 评论者"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
