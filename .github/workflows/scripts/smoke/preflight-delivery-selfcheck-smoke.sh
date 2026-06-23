#!/usr/bin/env bash
# preflight-delivery-selfcheck-smoke.sh
# Sprint 06211342 — 把「带发送接缝自检」（真送达 + 焦点归还）接进 line04 preflight 的逻辑守卫。
#
# 背景：preflight 原本只跑 --verify-silent --no-send（只读），不覆盖真送达 + 切会话后焦点归还。
# 本守卫验证编译产物 build-modules/line04/preflight.js 真的含 interpretVerifyDelivery /
# checkVerifyDelivery，且解析逻辑正确（DELIVERED / NOT_DELIVERED / NOT_RESTORED / skip）。
#
# 退出码：0 全过 / 2 preflight.js 缺失 / 3 manifest 版本不符 / 5 逻辑断言失败 / 6 缺 node
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
EXPECTED="1.0.56"
PF="$REPO_ROOT/services/agent/build-modules/line04/preflight.js"

command -v node >/dev/null 2>&1 || { echo "FAIL: 缺 node"; exit 6; }
[ -f "$PF" ] || { echo "FAIL: build-modules/line04/preflight.js 缺失（build-line-module 没跑？）"; exit 2; }

node -e "
const p = require('$PF');
const a = require('assert');
// 带发送自检解析：真送达 + 焦点归还
a.strictEqual(p.interpretVerifyDelivery(0, JSON.stringify({sent:true, restored:true})).found, 'DELIVERED', 'sent+restored→DELIVERED');
a.strictEqual(p.interpretVerifyDelivery(1, JSON.stringify({sent:false})).ok, false, 'sent:false→红');
a.strictEqual(p.interpretVerifyDelivery(1, JSON.stringify({sent:true, restored:false})).found, 'NOT_RESTORED', '送达但焦点没还→NOT_RESTORED');
a.strictEqual(p.interpretVerifyDelivery(1, JSON.stringify({error:'NO_WINDOW（微信未登录）'})).skipped, true, '环境未就绪→skip');
a.strictEqual(p.interpretVerifyDelivery(1, JSON.stringify({error:'找不到目标会话'})).skipped, true, '找不到会话→skip');
// checkVerifyDelivery mock 注入（跨平台可测）
process.env.MOCK_VERIFY_DELIVERY = 'delivered';     a.strictEqual(p.checkVerifyDelivery().ok, true,  'mock delivered→ok');
process.env.MOCK_VERIFY_DELIVERY = 'not_delivered'; a.strictEqual(p.checkVerifyDelivery().ok, false, 'mock not_delivered→红');
process.env.MOCK_VERIFY_DELIVERY = 'skip';          a.strictEqual(p.checkVerifyDelivery().skipped, true, 'mock skip→skip');
console.log('  OK: 带发送自检 interpretVerifyDelivery/checkVerifyDelivery 逻辑链路（编译产物）');
" || { echo "FAIL: 带发送自检逻辑断言不通过"; exit 5; }

V=$(node -e "process.stdout.write(require('$REPO_ROOT/services/agent/build-modules/line04/manifest.json').version)")
[ "$V" = "$EXPECTED" ] || { echo "FAIL: build-modules/line04 manifest=$V != $EXPECTED"; exit 3; }
echo "  OK: build-modules/line04 manifest = $V"

echo "preflight-delivery-selfcheck-smoke: PASS"
