#!/usr/bin/env bash
# line04-hotkey-summon-smoke.sh
# handoff_0719_line04_2findings_ready_to_ship 发现1 —— 热键召唤 Ctrl+Alt+W 替代托盘召唤
# + onboarding 功能自检探针(check_hotkey_summon) + 模块版本 1.0.146 三面一致 smoke。
#
# 验证链路（不依赖运行中的服务/真机微信，纯仓内真链路调用）：
#   1. node 解析 modules/build-modules manifest.json + grep walking-skeleton.service.ts
#      → line04 版本三面一致 = EXPECTED（防 #817 部署 gap 复发）
#   2. python3 真跑 preflight.py --dry-run --middleware-url ... → 9 个检测项里含
#      hotkey_summon，dry-run 分支返回 warn（不触碰真实按键）
#   3. grep listen_chat.py 源码：scan 真塌快速自愈路径必须先试
#      _summon_wechat_via_hotkey() 再降级 _summon_wechat_from_tray()（召唤主路已切换）
#
# 退出码：0 全过 / 2 版本三面不一致 / 3 preflight 缺 hotkey_summon 检测项 / 4 召唤主路未接线
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
EXPECTED="1.0.146"
echo "line04-hotkey-summon-smoke: 期望 line04 版本 = $EXPECTED (repo=$REPO_ROOT)"

command -v node >/dev/null 2>&1    || { echo "FAIL: 缺 node"; exit 6; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: 缺 python3"; exit 6; }

# ─── Step 1：版本三面一致 ───────────────────────────────────────────────
MOD_MANIFEST="$REPO_ROOT/services/agent/modules/line04/manifest.json"
BUILD_MANIFEST="$REPO_ROOT/services/agent/build-modules/line04/manifest.json"
V1=$(node -e "process.stdout.write(require('$MOD_MANIFEST').version)")
V2=$(node -e "process.stdout.write(require('$BUILD_MANIFEST').version)")
[ "$V1" = "$EXPECTED" ] || { echo "FAIL: modules/line04 manifest version=$V1 != $EXPECTED"; exit 2; }
[ "$V2" = "$EXPECTED" ] || { echo "FAIL: build-modules/line04 manifest version=$V2 != $EXPECTED"; exit 2; }
SVC="$REPO_ROOT/apps/api/src/services/walking-skeleton.service.ts"
grep -qE "'line04-wechat-cs': \{ status: 'active', required_version: '$EXPECTED' \}" "$SVC" \
  || { echo "FAIL: walking-skeleton.service.ts line04 required_version != $EXPECTED"; exit 2; }
echo "  OK: line04 三面版本一致 = $EXPECTED"

# ─── Step 2：preflight.run_all_checks(dry_run=True) 含 hotkey_summon 检测项 ─────
# 直接调用 Python API（而非 CLI 落盘），规避 Linux CI 上默认 Windows 风格 PUBLIC
# 路径（C:\Users\Public）不可写的问题；main() CLI 真链路已由 test_preflight.py 覆盖。
cd "$REPO_ROOT/services/agent/wechat-rpa"
python3 -c "
import sys
from preflight import run_all_checks, CHECK_NAMES

checks = run_all_checks('http://localhost:9', dry_run=True)
names = [c['name'] for c in checks]
if 'hotkey_summon' not in CHECK_NAMES or 'hotkey_summon' not in names:
    print('FAIL: preflight 检测项缺 hotkey_summon，names=' + str(names))
    sys.exit(1)
hk = next(c for c in checks if c['name'] == 'hotkey_summon')
if hk['status'] != 'warn':
    print('FAIL: dry-run 下 hotkey_summon 应为 warn，实际=' + hk['status'])
    sys.exit(1)
print('  OK: preflight 9 项检测含 hotkey_summon(dry-run warn)')
" || exit 3

# ─── Step 3：召唤主路已切换为热键（scan 快速自愈先热键再托盘）───────────
python3 -c "
import re
with open('$REPO_ROOT/services/agent/wechat-rpa/listen_chat.py', encoding='utf-8') as f:
    src = f.read()
m = re.search(r'_should_fast_heal_hidden_collapsed\(\s*\n?\s*now,\s*scan_collapse_since,', src)
if m is None:
    print('FAIL: 找不到 scan 快速自愈调用')
    raise SystemExit(1)
window = src[m.start(): m.start() + 900]
hk_idx = window.find('_summon_wechat_via_hotkey()')
tray_idx = window.find('_summon_wechat_from_tray()')
if hk_idx == -1 or tray_idx == -1 or hk_idx >= tray_idx:
    print(f'FAIL: 召唤主路未正确接线(hotkey_idx={hk_idx}, tray_idx={tray_idx})')
    raise SystemExit(1)
print('  OK: scan 快速自愈先试热键召唤，再降级托盘召唤')
" || exit 4

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ line04 热键召唤 + onboarding 自检 + 版本三面一致 PASS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
