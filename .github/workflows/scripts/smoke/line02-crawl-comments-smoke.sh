#!/usr/bin/env bash
# line02-crawl-comments-smoke.sh
#
# Line 02 全链路 smoke：keyword-search → crawl-comments → assert commenters ≥ 1
#
# 不写死视频 URL。用关键词搜热门视频（默认"美甲"），断言：
#   1. keyword-search 找到 ≥ 1 条视频 URL
#   2. crawl-comments 在第一条视频里找到 ≥ 1 个评论者
#
# 热门关键词（美甲/麻婆豆腐美食）的搜索结果必然有大量评论，
# 因此无需写死 URL，任何时候都能通过。
#
# 环境要求（xian-rog self-hosted runner，agent 已在 session1 登录抖音账号）：
#   ZJ_MAIN_DATA_DIR   — burner Chrome profile 目录（已绑定账号）
#                        如 C:\Temp\zj-douyin-burner-v1\live101942
#   NODE_EXE           — node.exe 路径（默认 node）
#   PUBLISHERS_DIR     — publishers 目录（默认从脚本位置推算）
#   KEYWORD            — 搜索关键词（默认 美甲）

set -uo pipefail

NODE_EXE="${NODE_EXE:-node}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLISHERS_DIR="${PUBLISHERS_DIR:-$SCRIPT_DIR/../../../services/agent/publishers}"
KEYWORD="${KEYWORD:-美甲}"
MAX_RESULTS="${MAX_RESULTS:-5}"

KW_SCRIPT="$PUBLISHERS_DIR/keyword-search-douyin.cjs"
CRAWL_SCRIPT="$PUBLISHERS_DIR/crawl-comments-douyin.cjs"

ok()   { echo "✅ $*"; }
fail() { echo "❌ $*"; exit 1; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  line02 crawl-comments smoke (全链路)"
echo "  KEYWORD=$KEYWORD"
echo "  ZJ_MAIN_DATA_DIR=${ZJ_MAIN_DATA_DIR:-<未设置>}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 前置检查 ─────────────────────────────────────────────────────────
[ -f "$KW_SCRIPT" ]    || fail "keyword-search-douyin.cjs 不存在: $KW_SCRIPT"
[ -f "$CRAWL_SCRIPT" ] || fail "crawl-comments-douyin.cjs 不存在: $CRAWL_SCRIPT"
[ -n "${ZJ_MAIN_DATA_DIR:-}" ] || fail "ZJ_MAIN_DATA_DIR 未设置（需先绑定抖音账号）"
[ -d "$ZJ_MAIN_DATA_DIR" ]     || fail "ZJ_MAIN_DATA_DIR 目录不存在: $ZJ_MAIN_DATA_DIR"
ok "前置检查通过"

# ── Stage 1: keyword-search ─────────────────────────────────────────
echo ""
echo "[Stage 1] keyword-search 关键词=\"$KEYWORD\""

KW_STDERR=$(mktemp)
# keyword-search-douyin.cjs <keyword> <port> <max_results>
KW_RESULT=$(ZJ_MAIN_DATA_DIR="$ZJ_MAIN_DATA_DIR" \
  timeout 120 "$NODE_EXE" "$KW_SCRIPT" "$KEYWORD" 19222 "$MAX_RESULTS" \
  2>"$KW_STDERR" | tail -1) || KW_RESULT=""

echo "stdout: $KW_RESULT"
[ -s "$KW_STDERR" ] && echo "stderr (last 5):" && tail -5 "$KW_STDERR"

VIDEO_URL=$(python3 -c "
import json, sys
line = sys.stdin.read().strip()
if not line:
    sys.exit(0)
try:
    d = json.loads(line)
except Exception:
    sys.exit(0)
urls = d.get('video_urls') or []
print(urls[0] if urls else '', end='')
" <<< "$KW_RESULT" 2>/dev/null || echo "")

[ -n "$VIDEO_URL" ] || fail "keyword-search 未找到任何视频 URL（关键词=$KEYWORD）"
ok "找到视频: $VIDEO_URL"

# ── Stage 2: crawl-comments ─────────────────────────────────────────
echo ""
echo "[Stage 2] crawl-comments $VIDEO_URL"

CRAWL_STDERR=$(mktemp)
CRAWL_RESULT=$(ZJ_MAIN_DATA_DIR="$ZJ_MAIN_DATA_DIR" \
  timeout 120 "$NODE_EXE" "$CRAWL_SCRIPT" "$VIDEO_URL" smoke-task-id unused unused --stdout-only \
  2>"$CRAWL_STDERR" | tail -1) || CRAWL_RESULT=""

echo "stdout: $CRAWL_RESULT"
[ -s "$CRAWL_STDERR" ] && echo "stderr (last 10):" && tail -10 "$CRAWL_STDERR"

python3 -c "
import json, sys
line = sys.stdin.read().strip()
if not line:
    print('❌ crawl-comments 无 stdout 输出'); sys.exit(1)
try:
    d = json.loads(line)
except Exception as e:
    print(f'❌ JSON 解析失败: {e}'); sys.exit(1)
if not d.get('ok'):
    print(f'❌ ok=false error={d.get(\"error\", \"unknown\")}'); sys.exit(1)
commenters = d.get('commenters') or []
if len(commenters) == 0:
    print(f'❌ commenters=0（视频 {d.get(\"video_url\", \"\")} 无可见评论）'); sys.exit(1)
first = commenters[0]
print(f'✅ commenters={len(commenters)}  首条: {first.get(\"nickname\", \"?\")} — {first.get(\"comment_text\", \"\")[:30]}')
" <<< "$CRAWL_RESULT" || fail "crawl-comments 失败或评论数=0"

echo ""
ok "line02 crawl-comments smoke PASS（keyword → 视频 → 评论者）"
