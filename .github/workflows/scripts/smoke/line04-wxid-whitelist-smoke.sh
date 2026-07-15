#!/usr/bin/env bash
# line04-wxid-whitelist-smoke.sh
# Smoke: Line04 白名单匹配升级 wxid 稳定标识符（task:2f98e00d）
# 验证：cs_config_gate.should_reply() 的 wxid 优先匹配 + 显示名降级路径正常
set -euo pipefail

API_URL="${API_URL:-http://localhost:3000}"
PYTHON="${PYTHON:-python3}"

echo "=== Smoke: line04 wxid 白名单匹配 ==="

# Step-wxid-1: BEHAVIOR-1 wxid 优先匹配（名字改了仍命中白名单）
echo "[Step-wxid-1] wxid 优先匹配..."
$PYTHON -c "
import sys; sys.path.insert(0, 'services/agent/wechat-rpa')
import cs_config_gate as gate
cfg = {'whitelist': [{'name': '旧备注', 'wxid': 'wxid_smoketest'}]}
result = gate.should_reply(cfg, '新备注改后', sender_wxid='wxid_smoketest')
assert result is True, f'FAIL: wxid 命中但 should_reply={result}'
print('PASS: wxid 优先匹配正常')
"

# Step-wxid-2: BEHAVIOR-2 wxid=None 降级走显示名
echo "[Step-wxid-2] wxid=None 降级显示名..."
$PYTHON -c "
import sys; sys.path.insert(0, 'services/agent/wechat-rpa')
import cs_config_gate as gate
cfg = {'whitelist': [{'name': '白名单用户', 'wxid': None}]}
result = gate.should_reply(cfg, '白名单用户', sender_wxid=None)
assert result is True, f'FAIL: 降级路径 should_reply={result}'
print('PASS: wxid=None 降级显示名正常')
"

# Step-wxid-3: BEHAVIOR-5 旧格式纯字符串向后兼容
echo "[Step-wxid-3] 旧格式纯字符串向后兼容..."
$PYTHON -c "
import sys; sys.path.insert(0, 'services/agent/wechat-rpa')
import cs_config_gate as gate
cfg = {'whitelist': ['老客户甲', '老客户乙']}
result = gate.should_reply(cfg, '老客户甲', sender_wxid=None)
assert result is True, f'FAIL: 旧格式不兼容 should_reply={result}'
print('PASS: 旧格式纯字符串向后兼容正常')
"

# Step-wxid-4: 三版本面一致性（walking-skeleton heartbeat = modules = build-modules）
echo "[Step-wxid-4] line04 三版本面一致性..."
V_MOD=$(node -e "process.stdout.write(require('./services/agent/modules/line04/manifest.json').version)")
V_BUILD=$(node -e "process.stdout.write(require('./services/agent/build-modules/line04/manifest.json').version)")
[ "$V_MOD" = "$V_BUILD" ] || { echo "FAIL: modules($V_MOD) != build-modules($V_BUILD)"; exit 1; }
echo "PASS: 三版本面一致 = $V_MOD"

echo ""
echo "=== Smoke PASS: line04 wxid 白名单匹配全部验证通过 ==="
