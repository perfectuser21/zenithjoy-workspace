#!/usr/bin/env bash
# line04-cs-config-permission-smoke.sh
# Line04 客服配置写接口安全闸 — 轻量 smoke（无需 DB/server，CI 任意环境可跑）。
# 验：① 三个写接口都挂了 tenantContext + 管理员角色闸（NOT_ADMIN）；
#     ② guard 中间件实现了租户隔离（CROSS_TENANT）+ deny-by-default（TARGET_NOT_FOUND）；
#     ③ 前台 PerCsConfigPage 含营业时间/每日上限/只读提示 testid + 消费 my-role。
# 真实越权/隔离的端到端断言走 e2e-line04-cs-config-permission.yml（ubuntu+postgres + windows Playwright）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

echo "── ① 写接口挂闸：wechat-config.ts 三个 PUT 前置 tenantContext + 角色闸 ──"
node -e '
const fs = require("fs");
const c = fs.readFileSync("apps/api/src/routes/wechat-config.ts", "utf8");
const checks = [
  [/tenantContext/, "缺 tenantContext"],
  [/requireCsAdmin/, "缺管理员角色闸 requireCsAdmin"],
  [/requireSameTenant\(.wechatId.\)/, "cs/config 缺租户隔离闸"],
  [/requireSameTenant\(.machineId.\)/, "cs/setup 缺租户隔离闸"],
  [/cs\/my-role/, "缺 GET /cs/my-role"],
];
for (const [re, msg] of checks) { if (!re.test(c)) { console.error("FAIL: " + msg); process.exit(1); } }
console.log("PASS: 三写接口挂闸 + my-role");
'

echo "── ② guard 中间件实现拒绝码 NOT_ADMIN / CROSS_TENANT / TARGET_NOT_FOUND ──"
node -e '
const fs = require("fs");
const c = fs.readFileSync("apps/api/src/middleware/cs-config-guard.ts", "utf8");
for (const code of ["NOT_ADMIN", "CROSS_TENANT", "TARGET_NOT_FOUND"]) {
  if (!c.includes(code)) { console.error("FAIL: guard 缺拒绝码 " + code); process.exit(1); }
}
// deny by default：解析不出目标必须拒绝（!targetTenant 分支）
if (!/!targetTenant/.test(c)) { console.error("FAIL: guard 缺 deny-by-default 分支"); process.exit(1); }
console.log("PASS: guard 角色闸 + 租户隔离 + deny-by-default");
'

echo "── ③ 前台补营业时间/每日上限/只读提示 + 消费 my-role ──"
node -e '
const fs = require("fs");
const c = fs.readFileSync("apps/dashboard/src/pages/PerCsConfigPage.tsx", "utf8");
for (const id of ["cs-business-hours-start", "cs-business-hours-end", "cs-daily-limit", "cs-readonly-notice"]) {
  if (!c.includes(id)) { console.error("FAIL: 前台缺 testid " + id); process.exit(1); }
}
if (!/my-role/.test(c)) { console.error("FAIL: 前台未消费 my-role"); process.exit(1); }
console.log("PASS: 前台营业时间/每日上限/只读提示 + my-role");
'

echo "✅ line04-cs-config-permission smoke 全过"
