#!/usr/bin/env bash
# line04-selfheal-observability-smoke.sh
# 三自愈 PR（cp-07081556）smoke：
#  1) line04 三个版本面一致（build-modules / modules manifest / walking-skeleton HEARTBEAT_MODULES）
#  2) 自愈观测字段（window_state / welcome_click_fails）真实存在于 diag 构造器，且源码与
#     build-modules 打包副本两份都有（防"改了源码没同步副本、客户机永远拿不到"）
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

BM_VER=$(node -e "console.log(require('./services/agent/build-modules/line04/manifest.json').version)")
M_VER=$(node -e "console.log(require('./services/agent/modules/line04/manifest.json').version)")
HB_VER=$(node -e "
const s = require('fs').readFileSync('apps/api/src/services/walking-skeleton.service.ts','utf8');
const m = s.match(/line04[^}]*?required_version:\s*'([0-9.]+)'/s);
console.log(m ? m[1] : 'NOT_FOUND');
")
echo "版本面: build-modules=$BM_VER modules=$M_VER heartbeat=$HB_VER"
if [ "$BM_VER" != "$M_VER" ] || [ "$BM_VER" != "$HB_VER" ]; then
  echo "FAIL: line04 三个版本面不一致"
  exit 1
fi

for f in services/agent/wechat-rpa/listen_chat.py services/agent/build-modules/line04/wechat-rpa/listen_chat.py; do
  node -e "
const s = require('fs').readFileSync('$f','utf8');
for (const key of ['window_state', 'welcome_click_fails', 'window_needs_maximize', 'should_attempt_welcome_click']) {
  if (!s.includes(key)) { console.error('FAIL: ' + '$f' + ' 缺少自愈字段/函数 ' + key); process.exit(1); }
}
console.log('OK: $f 自愈观测字段齐全');
"
done

echo "PASS line04-selfheal-observability-smoke"
