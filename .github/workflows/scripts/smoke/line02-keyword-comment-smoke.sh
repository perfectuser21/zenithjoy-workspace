#!/usr/bin/env bash
# line02-keyword-comment-smoke.sh
# Line02 智能获客 — 关键词搜索 + 评论抓取 端到端 smoke
#
# 依赖：
#   - 真机 Windows（xian-rog, [self-hosted, wechat-capable]）
#   - 当前候选 checkout 中的 services/agent/publishers，已按 lockfile 安装依赖
#   - .env 中 ZJ_MAIN_DATA_DIR 指向含有效抖音 session 的 Chrome profile
#
# 运行：
#   bash .github/workflows/scripts/smoke/line02-keyword-comment-smoke.sh
#
# 环境变量（可选覆盖）：
#   AGENT_DIR   — 必须是当前候选 checkout/services/agent，不接受安装目录
#   SMOKE_KW    — 测试关键词（默认"美甲"）

set -euo pipefail

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

# ── 诊断分级纯函数：环境失效同样拒绝验收 ─────────────────────────────
classify_node_failure() {
  local out="${1:-}" json err
  json=$(printf '%s\n' "$out" | grep '^{' | tail -1)
  [ -n "$json" ] || { printf 'fail:NO_JSON'; return 0; }
  err=$(printf '%s' "$json" \
    | grep -oE '"error"[[:space:]]*:[[:space:]]*"[^":]+' | head -1 | sed -E 's/.*"//')
  case "$err" in
    DOUYIN_SESSION_EXPIRED) printf 'fail:%s' "$err" ;;
    '')                     printf 'fail:UNKNOWN' ;;
    *)                      printf 'fail:%s' "$err" ;;
  esac
}

# `source line02-keyword-comment-smoke.sh --source-only` 时到此为止，不跑真机主流程。
if [ "${1:-}" = "--source-only" ]; then
  return 0 2>/dev/null || exit 0
fi

SMOKE_KW="${SMOKE_KW:-美甲}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Line02 Keyword→Comment Smoke"
echo "  KW=$SMOKE_KW"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. 固定当前候选源码，禁止验证另一份已安装版本 ──────────────────
ROOT="${GITHUB_WORKSPACE:-$(git rev-parse --show-toplevel)}"
if command -v cygpath >/dev/null; then ROOT=$(cygpath -u "$ROOT"); fi
ROOT=$(cd "$ROOT" && pwd -P)
EXPECTED_AGENT="$ROOT/services/agent"
AGENT_DIR="${AGENT_DIR:-$EXPECTED_AGENT}"
if command -v cygpath >/dev/null; then AGENT_DIR=$(cygpath -u "$AGENT_DIR"); fi
[ -d "$AGENT_DIR" ] || fail "CANDIDATE_SOURCE_MISMATCH: 缺少候选 services/agent"
AGENT_DIR=$(cd "$AGENT_DIR" && pwd -P)
[ "$AGENT_DIR" = "$EXPECTED_AGENT" ] || fail "CANDIDATE_SOURCE_MISMATCH: 不允许安装目录"
ACTUAL_SHA=$(git -c safe.directory="$ROOT" -C "$ROOT" rev-parse HEAD)
EXPECTED_SHA="${GITHUB_SHA:-$ACTUAL_SHA}"
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || fail "CANDIDATE_SHA_MISMATCH: expected=$EXPECTED_SHA actual=$ACTUAL_SHA"
[ -z "$(git -c safe.directory="$ROOT" -C "$ROOT" status --porcelain -- services/agent/publishers)" ] \
  || fail "CANDIDATE_SOURCE_DIRTY: publishers 与候选提交不一致"
ok "candidate sha=$ACTUAL_SHA"

# ── 2. 明确运行时；业务代码仅来自上述候选 ──────────────────────────
NODE_EXE="${NODE_EXE:-$(command -v node || true)}"
if command -v cygpath >/dev/null; then NODE_EXE=$(cygpath -u "$NODE_EXE"); fi
[ -f "$NODE_EXE" ] || fail "找不到已准备的 node 运行时"
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
KW_CODE=0
KW_OUT=$("$NODE_EXE" "$KW_SCRIPT" "$SMOKE_KW" 2>&1) || KW_CODE=$?
printf '%s\n' "$KW_OUT" | grep -v '^{' | head -20 || true
KW_JSON=$(printf '%s\n' "$KW_OUT" | grep '^{' | tail -1 || true)
[ -n "$KW_JSON" ] || fail "keyword-search 无 JSON 输出（分级=$(classify_node_failure "$KW_OUT")）— 完整输出: $KW_OUT"
[ "$KW_CODE" -eq 0 ] || fail "keyword-search exit=${KW_CODE}（分级=$(classify_node_failure "$KW_OUT")）"

KW_OK=$(node_parse "$KW_JSON" "String(d.ok)")
[ "$KW_OK" = "true" ] || {
  ERR=$(node_parse "$KW_JSON" "d.error||'unknown'")
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
CM_CODE=0
CM_OUT=$("$NODE_EXE" "$CM_SCRIPT" "$FIRST_VIDEO" "smoke-test" "" "" "--stdout-only" 2>&1) || CM_CODE=$?
printf '%s\n' "$CM_OUT" | grep -v '^{' | head -20 || true
CM_JSON=$(printf '%s\n' "$CM_OUT" | grep '^{' | tail -1 || true)
[ -n "$CM_JSON" ] || fail "crawl-comments 无 JSON 输出（分级=$(classify_node_failure "$CM_OUT")）— 完整输出: $CM_OUT"

[ "$CM_CODE" -eq 0 ] || fail "crawl-comments exit=${CM_CODE}（分级=$(classify_node_failure "$CM_OUT")）"
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
