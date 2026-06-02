#!/usr/bin/env bash
# wechat-rpa-auto-reply-smoke.sh — Path 4 Step 5 微信4.0 隐形AI客服(pywinauto + auto-reply)冒烟。
#
# 真机微信 E2E 进不了 CI(Linux runner 无微信桌面端 + pywinauto 仅 Windows)，
# 本 smoke 跑「可进 CI 的真实链路」：
#   1) _parse_item_name(scan_unread) 纯函数 5 case
#   2) rate_limiter 频控分钟上限
#   3) listen_chat.py --dryrun 真实进程(退出码 0 + JSON receipt)
#   4) apps/api generateChatDraft mode:'auto' 返回 reply 的 vitest 集成
# 真机全链路(读未读→DeepSeek 带上下文回→自动发出)由 Lead 在 xian-rog 自验留证。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
RPA="$ROOT/services/agent/wechat-rpa"

echo "[1/4] _parse_item_name(scan_unread) 5 case"
python3 -m pytest "$RPA/tests/test_scan_unread.py" -q

echo "[2/4] rate_limiter 分钟上限"
python3 -m pytest "$RPA/tests/test_rate_limiter.py" -q

echo "[3/4] listen_chat --dryrun 真实进程链路"
OUT=$(WECHAT_DRAFT_API_DRYRUN=1 python3 "$RPA/listen_chat.py" --dryrun \
  --inject-message='{"sender":"smoke","wechat_id":"wx_smoke","content":"你好"}')
echo "$OUT" | python3 -c "import sys,json; o=json.loads(sys.stdin.read()); assert o['ok'] and o['dryRun'] and o['draft_generated'], o; print('  dryrun OK')"

echo "[4/4] apps/api generateChatDraft mode:auto vitest"
( cd "$ROOT/apps/api" && npx vitest run src/services/__tests__/wechat-draft-auto-reply.test.ts )

echo "PASS wechat-rpa-auto-reply-smoke"
