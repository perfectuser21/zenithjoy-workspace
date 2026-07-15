#!/usr/bin/env bash
# line04-profile-panel-wiring-smoke.sh
# Smoke: Line04 golden path Step16 — 浮窗联动画像面板接线
# 验证：OverlayApp.get_events() 消费到带 contact 的新事件时真调 switch_customer()
#       （此前 switch_customer()/_fetch_customer_profile() 是里程碑B 遗留孤儿代码，
#        events 消费循环从不调用它——本条修复该接线缺口）
set -euo pipefail

PYTHON="${PYTHON:-python3}"

echo "=== Smoke: line04 画像面板联动接线（Step16）==="

# Step-panel-1: 精确接线检查——只认真调用点，不认孤儿的 fetch 辅助方法存在
echo "[Step-panel-1] 事件分发点真调用 switch_customer..."
WIRED=$(grep -n "\.switch_customer(" services/agent/wechat-rpa/overlay/*.py 2>/dev/null \
  | grep -v "def switch_customer" | grep -v "__pycache__" || true)
if [ -z "$WIRED" ]; then
  echo "FAIL: 未找到真调用点，只有孤儿的 switch_customer 定义"
  exit 1
fi
echo "PASS: 找到真调用点 -> $WIRED"

# Step-panel-2: 端到端功能断言——真写 events.jsonl，真调 get_events()，验证联动切换
echo "[Step-panel-2] 端到端联动：真写事件 -> get_events() -> switch_customer 真被调用..."
$PYTHON -c "
import sys, os, json, tempfile, time
sys.path.insert(0, 'services/agent/wechat-rpa')
from overlay.overlay_window import OverlayApp

state_dir = tempfile.mkdtemp(prefix='zj-smoke-panel-')
app = OverlayApp(state_dir=state_dir)

called = []
app.switch_customer = lambda wechat_id: called.append(wechat_id)

with open(os.path.join(state_dir, 'events.jsonl'), 'a', encoding='utf-8') as f:
    f.write(json.dumps({'type': 'heartbeat', 'ts': time.time(), 'event_id': 'h-1'}, ensure_ascii=False) + '\n')
    f.write(json.dumps({'type': 'reply_sent', 'event_id': 'e-1', 'contact': '联系人甲'}, ensure_ascii=False) + '\n')

app.get_events()
assert called == ['联系人甲'], f'联动切换未真触发，实际: {called}'
print('PASS: 端到端联动正常')
"

# Step-panel-3: 同一联系人连续事件不重复切换（current_customer 已相同则跳过）
echo "[Step-panel-3] 同一联系人不重复切换..."
$PYTHON -c "
import sys, os, json, tempfile, time
sys.path.insert(0, 'services/agent/wechat-rpa')
from overlay.overlay_window import OverlayApp

state_dir = tempfile.mkdtemp(prefix='zj-smoke-panel2-')
app = OverlayApp(state_dir=state_dir)
app.current_customer = '联系人甲'

called = []
app.switch_customer = lambda wechat_id: called.append(wechat_id)

with open(os.path.join(state_dir, 'events.jsonl'), 'a', encoding='utf-8') as f:
    f.write(json.dumps({'type': 'heartbeat', 'ts': time.time(), 'event_id': 'h-1'}, ensure_ascii=False) + '\n')
    f.write(json.dumps({'type': 'reply_sent', 'event_id': 'e-1', 'contact': '联系人甲'}, ensure_ascii=False) + '\n')

app.get_events()
assert called == [], f'current_customer 已相同不应重复切换，实际: {called}'
print('PASS: 不重复切换正常')
"

# Step-panel-4: 三版本面一致性（walking-skeleton heartbeat = modules = build-modules）
echo "[Step-panel-4] line04 三版本面一致性..."
V_MOD=$(node -e "process.stdout.write(require('./services/agent/modules/line04/manifest.json').version)")
V_BUILD=$(node -e "process.stdout.write(require('./services/agent/build-modules/line04/manifest.json').version)")
[ "$V_MOD" = "$V_BUILD" ] || { echo "FAIL: modules($V_MOD) != build-modules($V_BUILD)"; exit 1; }
echo "PASS: 三版本面一致 = $V_MOD"

echo ""
echo "=== Smoke PASS: line04 画像面板联动接线全部验证通过 ==="
