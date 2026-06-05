#!/usr/bin/env bash
# wechat-auto-launch-smoke.sh — 微信未运行时 listen_chat 自动拉起 Weixin.exe 回归 smoke
#
# Path 4 Step 1: Agent 自动弹码 — 员工只需扫码登录，无需手动启动微信。
# 真机（xian-rog）验证：agent 启动 → listen_chat 检测微信未运行 → Popen Weixin.exe →
# 微信弹出 QR 码 → 员工扫码 → 监听接管。CI 跑纯函数覆盖 + dryrun 链路。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
RPA="$ROOT/services/agent/wechat-rpa"

echo "[1/3] launch_weixin / is_weixin_running 纯函数单测（7 case）"
python3 -m pytest "$RPA/tests/test_launch_weixin.py" -v -q

echo "[2/3] listen_chat.py --dryrun 含自动启动代码路径（源码 grep 断言）"
grep -q "launch_weixin" "$RPA/listen_chat.py"
grep -q "wechat_launch_cooldown" "$RPA/listen_chat.py"
echo "  auto-launch guard present OK"

echo "[3/3] listen_chat --dryrun 真实进程链路（WECHAT_DRAFT_API_DRYRUN=1）"
OUT=$(WECHAT_DRAFT_API_DRYRUN=1 python3 "$RPA/listen_chat.py" --dryrun \
  --inject-message='{"sender":"smoke","wechat_id":"wx_smoke","content":"自动回测试"}')
echo "$OUT" | python3 -c "
import sys,json
o=json.loads(sys.stdin.read())
assert o.get('ok') and o.get('dryRun'), f'unexpected: {o}'
print('  dryrun OK')
"

echo "PASS wechat-auto-launch-smoke"
