#!/usr/bin/env bash
# line04-version-lock-closure-smoke.sh
# Sprint 06292125 — Path 4 版本锁闭环验收：4.1.10 自动降 4.1.8 + 关更新锁住（PR-A）。
#
# 验收断言（对发货产物 build-modules/line04，不是源 .ts）：
#   1. isWechatVersionSupported 锁 4.1.8.x：4.1.8.107=true；4.1.10.27 / 4.1.9 / 4.1.7.0 = false（核心反例）。
#   2. 发货 preflight.js 含「装完关更新」接线：lockWechatUpdate + interpretUpdateLock。
#   3. reset_stage 与 preflight 同口径：_version_in_range('4.1.8.107')=True，('4.1.10.0')=False（无放行裂缝）。
#   4. 三个版本面一致（modules / build-modules / 中台心跳 required_version）。
#
# 退出码：0 全过 / 2 版本闸放行 4.1.10（锁失败）/ 3 缺关更新接线 / 4 reset_stage 裂缝 / 5 三面不一致 / 6 缺 node/python3
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
AGENT="$REPO_ROOT/services/agent"
echo "line04-version-lock-closure-smoke (repo=$REPO_ROOT)"

command -v node >/dev/null 2>&1    || { echo "FAIL: 缺 node"; exit 6; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: 缺 python3"; exit 6; }

# 1. 版本闸只认 4.1.8.x（4.1.10 必须 false，否则压根不进降级分支 = 锁失败）。
node -e "
const pf = require('$AGENT/build-modules/line04/preflight.js');
const ok = pf.isWechatVersionSupported;
const must = (v, exp) => { if (ok(v) !== exp) { console.error('FAIL 版本闸 '+v+' 期望 '+exp+' 实得 '+ok(v)); process.exit(2); } };
must('4.1.8.107', true); must('4.1.8', true);
must('4.1.10.27', false); must('4.1.10.0', false); must('4.1.9', false); must('4.1.7.0', false); must('4.2.0', false);
console.log('  OK: isWechatVersionSupported 锁 4.1.8.x（4.1.10 → false 触发降级）');
" || exit 2

# 2. 发货 preflight.js 含「装完强版关更新」接线（重启不自升靠它）。
node -e "
const fs = require('fs');
const src = fs.readFileSync('$AGENT/build-modules/line04/preflight.js', 'utf8');
for (const fn of ['lockWechatUpdate', 'interpretUpdateLock']) {
  if (!src.includes(fn)) { console.error('FAIL: build-modules preflight.js 缺 ' + fn); process.exit(3); }
}
console.log('  OK: 发货 preflight.js 含 lockWechatUpdate + interpretUpdateLock（装完关更新接线）');
" || exit 3

# 3. reset_stage 与 preflight 同口径（杜绝一处放行一处拒）。
python3 -c "
import sys
sys.path.insert(0, '$AGENT/wechat-rpa')
import reset_stage as rs
assert rs._version_in_range('4.1.8.107') is True, 'reset_stage 应放行 4.1.8.x'
assert rs._version_in_range('4.1.10.0') is False, 'reset_stage 不能放行 4.1.10（裂缝）'
assert rs._version_in_range('4.1.7.99') is False, 'reset_stage 应拒 < 4.1.8'
print('  OK: reset_stage 只认 4.1.8.x（与 preflight/find_weixin 同口径）')
" || exit 4

# 4. 三个版本面一致。
V_MOD=$(node -e "process.stdout.write(require('$AGENT/modules/line04/manifest.json').version)")
V_BUILD=$(node -e "process.stdout.write(require('$AGENT/build-modules/line04/manifest.json').version)")
SVC="$REPO_ROOT/apps/api/src/services/walking-skeleton.service.ts"
V_HB=$(grep -oE "'line04-wechat-cs': \{ status: 'active', required_version: '[0-9.]+' \}" "$SVC" | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")
echo "  modules=$V_MOD build-modules=$V_BUILD heartbeat=$V_HB"
if [ "$V_MOD" != "$V_BUILD" ] || [ "$V_MOD" != "$V_HB" ]; then
  echo "FAIL: 三个版本面不一致"; exit 5
fi
echo "  OK: 三个版本面一致 = $V_MOD"

echo "line04-version-lock-closure-smoke: PASS"
