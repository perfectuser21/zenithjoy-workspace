#!/usr/bin/env bash
# line04-delivery-selfcheck-throttle-smoke.sh
# Sprint 06302137 — 真送达自检（主动发一条到「文件传输助手」远程确认微信在线）降频到默认 1 小时一次。
#
# 背景：checkVerifyDelivery 是 line04 preflight 里唯一「主动发消息到文件传输助手」那段，
# 随 runPreflight 频繁触发（心跳门禁 / agent 重启 / 升级重试 / 崩溃自愈 / 多进程），用户体感
# 「几秒~几分钟就发一次」。本 smoke 在编译产物 build-modules/line04/preflight.js 上验证：
#   1) 间隔常量 DELIVERY_SELFCHECK_INTERVAL_SEC == 3600（1 小时，可配置不写死散落）
#   2) 纯函数 shouldRunDeliverySelfcheck(now,last) 到点才发：10s→不发 / 3700s→发 / 边界 3600s→发 / 从未→发
#   3) 时间戳落盘往返（readDeliveryLastRun/writeDeliveryLastRun，跨进程持久；preflight.js 每次新 spawn）
#   4) 只读静默自检 checkVerifySilent 仍存在（被动心跳不受节流影响）
#
# 退出码：0 全过 / 2 preflight.js 缺失 / 5 逻辑断言失败 / 6 缺 node
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
PF="$REPO_ROOT/services/agent/build-modules/line04/preflight.js"

command -v node >/dev/null 2>&1 || { echo "FAIL: 缺 node"; exit 6; }
[ -f "$PF" ] || { echo "FAIL: build-modules/line04/preflight.js 缺失（build-line-module 没跑？）"; exit 2; }

node -e "
const p = require('$PF');
const a = require('assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
// 1) 间隔常量 = 1 小时
a.strictEqual(p.DELIVERY_SELFCHECK_INTERVAL_SEC, 3600, '真送达自检间隔常量必须=3600s（1小时）');
// 2) 纯函数到点才发
const now = Date.now();
a.strictEqual(p.shouldRunDeliverySelfcheck(now, now - 10 * 1000), false, '距10s<1h→不发');
a.strictEqual(p.shouldRunDeliverySelfcheck(now, now - 3700 * 1000), true, '距3700s>1h→发');
a.strictEqual(p.shouldRunDeliverySelfcheck(now, now - 3600 * 1000), true, '刚好1h边界→发');
a.strictEqual(p.shouldRunDeliverySelfcheck(now, 0), true, '从未发→首次必发');
// 3) 时间戳落盘往返
const tmp = path.join(os.tmpdir(), 'zj-delivery-selfcheck-smoke-' + Date.now() + '.json');
a.strictEqual(p.readDeliveryLastRun(tmp), 0, '不存在→0');
p.writeDeliveryLastRun(1700000000000, tmp);
a.strictEqual(p.readDeliveryLastRun(tmp), 1700000000000, '写后读回相同 ms');
try { fs.unlinkSync(tmp); } catch (e) {}
// 4) 被动只读静默自检仍在（不受节流影响）
a.strictEqual(typeof p.checkVerifySilent, 'function', '只读静默自检 checkVerifySilent 必须仍存在');
console.log('  OK: 真送达自检节流门（间隔=3600s + 纯函数 + 时间戳落盘）+ 被动静默自检保留（编译产物）');
" || { echo "FAIL: 真送达自检节流逻辑断言不通过"; exit 5; }

echo "line04-delivery-selfcheck-throttle-smoke: PASS"
