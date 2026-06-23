#!/usr/bin/env bash
# cs-oneclick-setup-smoke.sh — 微信客服「一键配置」端点 + 存取层就位（轻量，无 DB）
# 真实端到端（起 API+postgres：机器报到→setup→自动绑+配）走
# sprints/06231304-cs-oneclick-setup/e2e-oneclick-verify.sh（本地已实跑 exit 0）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

echo "── ① 后端端点就位（一键 setup + pending 机器列表）──"
node -e 'const fs=require("fs");const r=fs.readFileSync(process.argv[1],"utf8");
if(!/cs\/setup\/:machineId/.test(r)){console.error("FAIL: 缺 PUT /cs/setup/:machineId");process.exit(1)}
if(!/cs\/pending-machines/.test(r)){console.error("FAIL: 缺 GET /cs/pending-machines");process.exit(1)}
console.log("  PASS: setup + pending-machines 端点就位")' "$ROOT/apps/api/src/routes/wechat-config.ts"

echo "── ② 存取层 setupCSByMachine：自动解析租户 + 自动绑定（不让人手抄 machine_id）──"
node -e 'const fs=require("fs");const r=fs.readFileSync(process.argv[1],"utf8");
if(!/export async function setupCSByMachine/.test(r)){console.error("FAIL: 缺 setupCSByMachine");process.exit(1)}
if(!/license_machines/.test(r)){console.error("FAIL: setupCSByMachine 未经 license_machines 自动解析租户");process.exit(1)}
if(!/export async function listPendingMachines/.test(r)){console.error("FAIL: 缺 listPendingMachines");process.exit(1)}
console.log("  PASS: setupCSByMachine 自动解析租户+绑定 / listPendingMachines 就位")' "$ROOT/apps/api/src/services/wechat/cs-account-config-store.ts"

echo "── ③ 前端一键配置页就位 ──"
node -e 'const fs=require("fs");
if(!fs.existsSync(process.argv[1])){console.error("FAIL: 缺 CsOneClickSetupPage");process.exit(1)}
console.log("  PASS: CsOneClickSetupPage 就位")' "$ROOT/apps/dashboard/src/pages/CsOneClickSetupPage.tsx"

echo "✅ cs-oneclick-setup smoke 全过"
