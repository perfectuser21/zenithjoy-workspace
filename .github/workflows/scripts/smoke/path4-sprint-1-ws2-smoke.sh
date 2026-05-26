#!/usr/bin/env bash
# Path 4 Sprint 1 ws2 — qr_bind 完整版 + 飞书 4 表 + Dashboard 入口 + 8 fixture script
#
# 静态校验：
#   1) services/agent/wechat-rpa/qr_bind.py 真版 + __init__.py __all__ + requirements.txt
#   2) qr_bind.py --dryrun 跑通 → JSON {ok:true, dryRun:true}
#   3) 飞书 4 表名（客户档案 / 营销画像 / 内容排期 / 互动记录）注册
#   4) Dashboard AgentMachines 绑微信入口
#   5) 8 个飞书 fixture script 全在 + 抽检 --help 可执行
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

echo "=== ws2 Step 3: 飞书 4 表名注册 ==="
SEEN=0
for table in "客户档案" "营销画像" "内容排期" "互动记录"; do
  if grep -rq "$table" apps/api/src apps/api/scripts 2>/dev/null; then
    SEEN=$((SEEN + 1))
  fi
done
[ "$SEEN" = "4" ] || { echo "FAIL: 4 表名仅 $SEEN 个 hit"; exit 1; }
echo "  PASS 4 飞书表名全 hit"

echo "=== ws2 Step 4: Dashboard 绑微信入口 ==="
AGENT_PAGE=apps/dashboard/src/pages/AgentMachines.tsx
test -f "$AGENT_PAGE" || AGENT_PAGE=$(find apps/dashboard/src -name "AgentMachines*" 2>/dev/null | head -1)
[ -n "$AGENT_PAGE" ] && [ -f "$AGENT_PAGE" ] \
  || { echo "FAIL: AgentMachines 页面缺"; exit 1; }
grep -qE "微信|wechat" "$AGENT_PAGE" \
  || { echo "FAIL: AgentMachines 缺 微信/wechat 入口"; exit 1; }
echo "  PASS Dashboard 绑微信入口"

echo "=== ws2 Step 5: 8 fixture script ==="
FIXTURES=(
  seed-feishu-customer.js
  seed-feishu-profile.js
  seed-feishu-schedule.js
  get-feishu-schedule.js
  get-feishu-interaction.js
  count-feishu-schedule.js
  count-feishu-interaction.js
  update-feishu-schedule.js
)
for f in "${FIXTURES[@]}"; do
  test -f "apps/api/scripts/$f" || { echo "FAIL: $f 缺"; exit 1; }
done
echo "  PASS 8 fixture 全在"

# 抽检 1 个 --help 可执行
node apps/api/scripts/seed-feishu-customer.js --help 2>&1 | head -1 \
  | grep -q "Usage" \
  || { echo "FAIL: seed-feishu-customer.js --help 输出异常"; exit 1; }
echo "  PASS fixture --help spawn 通"

echo ""
echo "ws2-smoke: ALL PASS"
