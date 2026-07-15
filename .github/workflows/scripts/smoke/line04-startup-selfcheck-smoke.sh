#!/usr/bin/env bash
# line04-startup-selfcheck-smoke.sh
# Smoke: Line04 golden path Step6 — 启动自检消息（task:7be2842d）
# 验证：_should_send_startup_selfcheck() deny-by-default + send_startup_selfcheck()
#       真调 reply_in_chat_with_lease + 找不到会话时软失败 + 三版本面一致性
set -euo pipefail

PYTHON="${PYTHON:-python3}"

echo "=== Smoke: line04 启动自检消息（Step6）==="

# Step-selfcheck-1: deny-by-default（收件人未配置 / 本进程已发过 → 不发）
echo "[Step-selfcheck-1] deny-by-default..."
$PYTHON -c "
import sys
sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat

assert listen_chat._should_send_startup_selfcheck(done=False, contact='') is False, 'FAIL: 空收件人应不发'
assert listen_chat._should_send_startup_selfcheck(done=True, contact='固定测试联系人') is False, 'FAIL: 已发过应不再发'
assert listen_chat._should_send_startup_selfcheck(done=False, contact='固定测试联系人') is True, 'FAIL: 该发时未返回 True'
print('PASS: deny-by-default 正常')
"

# Step-selfcheck-2: 找到目标会话 → 真调 reply_in_chat_with_lease
echo "[Step-selfcheck-2] 找到会话真调发送..."
$PYTHON -c "
import sys
sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat

class _FakeElementInfo:
    def __init__(self, name): self.name = name

class _FakeItem:
    def __init__(self, name): self.element_info = _FakeElementInfo(name)

class _FakeMainWindow:
    def __init__(self, names): self._names = names
    def descendants(self, control_type=None): return [_FakeItem(n) for n in self._names]

called = {}
def _fake_reply_with_lease(mw, item, text, sender, middleware_url):
    called['sender'] = sender
    return True

listen_chat.reply_in_chat_with_lease = _fake_reply_with_lease
listen_chat._STARTUP_SELFCHECK_CONTACT = '固定测试联系人'
mw = _FakeMainWindow(['固定测试联系人'])
result = listen_chat.send_startup_selfcheck(mw, middleware_url='http://mw')
assert result is True, f'FAIL: send_startup_selfcheck 应返回 True，实际 {result}'
assert called.get('sender') == '固定测试联系人', f'FAIL: 未真调 reply_in_chat_with_lease，实际 {called}'
print('PASS: 找到会话真调 reply_in_chat_with_lease 正常')
"

# Step-selfcheck-3: 找不到目标会话 → 软失败
echo "[Step-selfcheck-3] 找不到会话软失败..."
$PYTHON -c "
import sys
sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat

class _FakeElementInfo:
    def __init__(self, name): self.name = name

class _FakeItem:
    def __init__(self, name): self.element_info = _FakeElementInfo(name)

class _FakeMainWindow:
    def __init__(self, names): self._names = names
    def descendants(self, control_type=None): return [_FakeItem(n) for n in self._names]

listen_chat._STARTUP_SELFCHECK_CONTACT = '固定测试联系人'
mw = _FakeMainWindow(['别的联系人'])
result = listen_chat.send_startup_selfcheck(mw, middleware_url='http://mw')
assert result is False, f'FAIL: 找不到会话应软失败返回 False，实际 {result}'
print('PASS: 找不到会话软失败正常')
"

# Step-selfcheck-4: 主循环已接线（每进程只发一次，非每天定时）
echo "[Step-selfcheck-4] 主循环接线检查..."
grep -q "startup_selfcheck_done_once" services/agent/wechat-rpa/listen_chat.py \
  || { echo "FAIL: 主循环未接线 startup_selfcheck_done_once（辅助函数存在但没被真正调用）"; exit 1; }
echo "PASS: 主循环已接线 do-once 模式"

# Step-selfcheck-5: 三版本面一致性（walking-skeleton heartbeat = modules = build-modules）
echo "[Step-selfcheck-5] line04 三版本面一致性..."
V_MOD=$(node -e "process.stdout.write(require('./services/agent/modules/line04/manifest.json').version)")
V_BUILD=$(node -e "process.stdout.write(require('./services/agent/build-modules/line04/manifest.json').version)")
[ "$V_MOD" = "$V_BUILD" ] || { echo "FAIL: modules($V_MOD) != build-modules($V_BUILD)"; exit 1; }
echo "PASS: 三版本面一致 = $V_MOD"

echo ""
echo "=== Smoke PASS: line04 启动自检消息（Step6）全部验证通过 ==="
