#!/usr/bin/env bash
# line04-client-wiring-smoke.sh
# 轻量 smoke（无需 DB/server，CI 任意环境可跑）：
#   ① 按 machine_id 拉配置的解析器单测过；
#   ② migration 给 service_agents 加了 wechat_id 列。
# 真实端到端（起 API + postgres 验隔离/未绑403/诊断入库）走 e2e-line04-client-wiring.yml。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

echo "── ① getCSConfigByMachine 解析器单测 ──"
( cd apps/api && npx vitest run src/services/wechat/__tests__/cs-account-config-store.test.ts )

echo "── ② migration 加 service_agents.wechat_id 列 ──"
node -e 'const fs=require("fs");
const f=fs.readdirSync("apps/api/db/migrations").find(n=>/add_service_agent_wechat_id/.test(n));
if(!f){console.error("FAIL: 缺 migration");process.exit(1)}
const c=fs.readFileSync("apps/api/db/migrations/"+f,"utf8");
if(!/ALTER TABLE zenithjoy\.service_agents[\s\S]*ADD COLUMN[\s\S]*wechat_id/i.test(c)){console.error("FAIL: 未加 wechat_id 列");process.exit(1)}
console.log("PASS: "+f);'

echo "✅ line04-client-wiring smoke 全过"
