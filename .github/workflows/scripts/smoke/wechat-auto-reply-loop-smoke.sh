#!/usr/bin/env bash
# wechat-auto-reply-loop-smoke.sh — Line 04 无审批自动回复闭环逻辑层 smoke。
#
# 逻辑断言（环境无关，CI 绿即逻辑 done）：
#   1. auto_reply.py 路由真值表 / 营业时间 / 延迟 / 去重 / 超时 / daily_limit / 播报 / 告警 / 回执
#      —— python3 -m pytest 全覆盖（proposer oracle）。
#   2. 自动代理 5 配置键 upsert 读回一致（默认关）—— npx vitest。
#   3. auto_reply.py 导出 8 个核心函数 —— node 断言文件含函数定义。
#
# 真送达接缝（上下线播报真送达 / 名单内自动回不抢焦点 / 名单外 pending_human / 失败告警）
# 不在本 smoke 内，走 e2e-verify.ps1 在 xian-rog 真机验，CI 绿 ≠ 接缝 done。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

echo "[1/3] auto_reply 路由/营业时间/延迟/去重/超时/daily_limit/播报/告警/回执 pytest"
python3 -m pytest services/agent/wechat-rpa/tests/test_auto_reply_route.py -q

echo "[2/3] 自动代理 5 配置键 upsert 读回一致（默认关）vitest"
( cd apps/api && npx vitest run ../../sprints/06220821-line04-cs-no-approval-auto-reply/tests/cs-auto-agent-config.test.ts )

echo "[3/3] auto_reply.py 导出 8 个核心函数"
node -e '
const fs = require("fs");
const src = fs.readFileSync("services/agent/wechat-rpa/auto_reply.py", "utf8");
const fns = ["decide_reply_route","within_business_hours","pick_reply_delay","is_duplicate",
             "llm_timeout_skip","broadcast_action","alert_on_failure","build_receipt"];
const missing = fns.filter((f) => !new RegExp("def\\s+" + f + "\\s*\\(").test(src));
if (missing.length) { console.error("缺函数:", missing.join(", ")); process.exit(1); }
console.log("  8 函数齐备:", fns.join(" / "));
'

echo "PASS wechat-auto-reply-loop-smoke"
