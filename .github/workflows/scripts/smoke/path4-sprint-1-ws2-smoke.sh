#!/usr/bin/env bash
# Path 4 Sprint 1 ws2 — 当前共享绑定：qr_bind dryrun + Dashboard 入口
#
# 静态校验：
#   1) services/agent/wechat-rpa/qr_bind.py 真版 + __init__.py __all__ + requirements.txt
#   2) qr_bind.py --dryrun 跑通 → JSON {ok:true, dryRun:true}
#   4) Dashboard AgentMachines 绑微信入口
# 旧审批路线的8个常量stub已退役；租户/鉴权/本地黑名单由现役API行为测试保护。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "=== ws2 Step 1: qr_bind.py 完整版 ==="
RPA_DIR=services/agent/wechat-rpa
test -f "$RPA_DIR/qr_bind.py" || { echo "FAIL: qr_bind.py 缺"; exit 1; }
test -f "$RPA_DIR/__init__.py" || { echo "FAIL: __init__.py 缺"; exit 1; }
grep -q "__all__" "$RPA_DIR/__init__.py" || { echo "FAIL: __init__.py 缺 __all__"; exit 1; }
test -f "$RPA_DIR/requirements.txt" || { echo "FAIL: requirements.txt 缺"; exit 1; }
echo "  PASS qr_bind.py + __init__.py + requirements.txt"

echo "=== ws2 Step 2: qr_bind.py --dryrun 真跑 ==="
QR_OUT=$(REAL_PUBLISH=0 python3 "$RPA_DIR/qr_bind.py" --dryrun 2>&1)
echo "  qr_bind dryrun: $QR_OUT"
echo "$QR_OUT" | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is True, 'FAIL ok'
assert out.get('dryRun') is True, 'FAIL dryRun'
print('  PASS qr_bind dryrun JSON 格式')
"

echo "=== ws2 Step 4: Dashboard 绑微信入口 ==="
# 整合(2026-06-25)：孤儿页 AgentMachines.tsx 已删，绑微信/客服机入口并进
# 「我的客服机」CsOneClickSetupPage（选机器→绑 wechat→配置）。这里改查它。
AGENT_PAGE=apps/dashboard/src/pages/CsOneClickSetupPage.tsx
[ -f "$AGENT_PAGE" ] \
  || { echo "FAIL: 客服机绑微信页(CsOneClickSetupPage) 缺"; exit 1; }
grep -qE "微信|wechat" "$AGENT_PAGE" \
  || { echo "FAIL: 客服机页缺 微信/wechat 入口"; exit 1; }
echo "  PASS Dashboard 绑微信入口（CsOneClickSetupPage）"

echo "ws2-smoke: ALL PASS — current binding only"
