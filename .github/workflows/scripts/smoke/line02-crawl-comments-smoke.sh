#!/usr/bin/env bash
# line02-crawl-comments-smoke.sh
#
# 回归守卫：crawl-comments-douyin.cjs 能用 ZJ_MAIN_DATA_DIR 指定的 burner profile
# 打开 Douyin 视频页，不报 BURNER_SESSION_EXPIRED，并返回 ok=true。
#
# 环境要求（必须在真实 Windows 机器上跑，走 xian-rog self-hosted runner）：
#   ZJ_MAIN_DATA_DIR   — burner Chrome profile 目录（已绑定账号），如 C:\Temp\zj-douyin-burner-v1\live101942
#   NODE_EXE           — node.exe 路径，默认 node
#   PUBLISHERS_DIR     — publishers 目录，默认脚本同级 ../../publishers
#   VIDEO_URL          — 测试用抖音视频 URL（需公开且有评论），默认用内置测试 URL
#
# 下午跑通的原始命令：
#   node scripts/douyin-comment-crawl.cjs \
#     --user-data-dir=C:\Temp\zj-douyin-burner-v1\live101942 \
#     --video-url=<VIDEO_URL> --max-comments=5
# 本 smoke 验证新版（publishers/crawl-comments-douyin.cjs）走 ZJ_MAIN_DATA_DIR 达到同等效果。
set -uo pipefail

NODE_EXE="${NODE_EXE:-node}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLISHERS_DIR="${PUBLISHERS_DIR:-$SCRIPT_DIR/../../../services/agent/publishers}"
SCRIPT="$PUBLISHERS_DIR/crawl-comments-douyin.cjs"

# 使用内置公开测试视频（有足够评论）；可通过 env var 覆盖
VIDEO_URL="${VIDEO_URL:-https://www.douyin.com/video/7305032099215419682}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  line02 crawl-comments smoke"
echo "  ZJ_MAIN_DATA_DIR=${ZJ_MAIN_DATA_DIR:-<未设置>}"
echo "  VIDEO_URL=$VIDEO_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 前置检查
[ -f "$SCRIPT" ] || fail "crawl-comments-douyin.cjs 不存在: $SCRIPT"
[ -n "${ZJ_MAIN_DATA_DIR:-}" ] || fail "ZJ_MAIN_DATA_DIR 未设置，无法确定 burner profile 目录"
[ -d "$ZJ_MAIN_DATA_DIR" ] || fail "ZJ_MAIN_DATA_DIR 目录不存在: $ZJ_MAIN_DATA_DIR"
ok "前置检查通过（script 存在 + profile 目录存在）"

# 执行 crawl-comments，最多 90 秒
TMP=$(mktemp)
RESULT=$(ZJ_MAIN_DATA_DIR="$ZJ_MAIN_DATA_DIR" \
  timeout 90 "$NODE_EXE" "$SCRIPT" "$VIDEO_URL" smoke-task-id unused unused --stdout-only 2>/tmp/crawl-stderr.log \
  | tail -1) || true

echo "stdout last line: $RESULT"
[ -s /tmp/crawl-stderr.log ] && echo "stderr (last 10):" && tail -10 /tmp/crawl-stderr.log

# 断言 ok=true
echo "$RESULT" | python3 -c "
import json, sys
line = sys.stdin.read().strip()
if not line:
    print('❌ 无 stdout 输出'); sys.exit(1)
try:
    d = json.loads(line)
except Exception as e:
    print(f'❌ JSON 解析失败: {e}'); sys.exit(1)
if not d.get('ok'):
    err = d.get('error','unknown')
    print(f'❌ ok=false error={err}'); sys.exit(1)
count = len(d.get('commenters') or [])
print(f'✅ ok=true commenters={count}')
" || fail "crawl-comments 返回失败"

ok "crawl-comments smoke PASS"
