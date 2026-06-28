#!/usr/bin/env bash
# wechat-cs-per-account-ia-redesign-smoke.sh
# IA 重设计刀1 — 微信客服人设+知识库每号化 轻量 smoke（无需 DB/server，CI 任意环境可跑）。
# 验：① 纯 .sql 迁移加 business_kb 列(IF NOT EXISTS) + persona/business_kb 回填带幂等守卫 + 无破坏性语句；
#     ② AI 回复(wechat-draft.ts)读【每号完整 persona + 每号 business_kb】，缺失回落全局；
#     ③ 每号配置 store 承载 business_kb 列读写。
# 端到端隔离/迁移真实往返走 vitest + e2e（ubuntu+postgres）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

echo "── ① 纯 .sql 迁移：business_kb 列 + 幂等回填 + 无破坏性语句 ──"
node -e 'const fs=require("fs");
const f=fs.readdirSync("apps/api/db/migrations").find(n=>/wechat_cs_account_config_full_persona_kb/.test(n));
if(!f){console.error("FAIL: 缺刀1迁移文件");process.exit(1)}
const c=fs.readFileSync("apps/api/db/migrations/"+f,"utf8");
if(!/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+business_kb/i.test(c)){console.error("FAIL: 未加 business_kb 列(IF NOT EXISTS)");process.exit(1)}
if(!/persona\s*-\s*.self_name./.test(c)){console.error("FAIL: persona 回填缺 collapse-guard(幂等)");process.exit(1)}
if(!/business_kb\s+IS\s+NULL|business_kb\s*=\s*.\{\}.::jsonb/i.test(c)){console.error("FAIL: business_kb 回填缺 empty-guard(幂等)");process.exit(1)}
if(/DROP\s+TABLE|DELETE\s+FROM|TRUNCATE/i.test(c)){console.error("FAIL: 出现破坏性语句(会丢数据)");process.exit(1)}
console.log("PASS: 迁移 "+f);'

echo "── ② AI 回复读每号完整 persona + 每号 business_kb（缺失回落全局）──"
node -e 'const fs=require("fs");
const c=fs.readFileSync("apps/api/src/services/wechat-draft.ts","utf8");
if(!/mergePersonaPreferCs\(csConfig\?\.persona/.test(c)){console.error("FAIL: persona 未优先读每号");process.exit(1)}
if(!/csKbHasContent\(csConfig\?\.business_kb\)/.test(c)){console.error("FAIL: business_kb 未优先读每号");process.exit(1)}
if(!/await getBusinessKB\(\)/.test(c)||!/await getPersona\(\)/.test(c)){console.error("FAIL: 缺全局回落兜底");process.exit(1)}
console.log("PASS: 每号 persona+business_kb 优先 + 全局回落");'

echo "── ③ 每号 store 承载 business_kb 读写 ──"
node -e 'const fs=require("fs");
const c=fs.readFileSync("apps/api/src/services/wechat/cs-account-config-store.ts","utf8");
if(!/business_kb:\s*BusinessKB/.test(c)){console.error("FAIL: CSAccountConfig 未含 business_kb");process.exit(1)}
if(!/SELECT wechat_id, persona, business_kb/.test(c)){console.error("FAIL: getCSConfig 未读 business_kb 列");process.exit(1)}
if(!/business_kb = EXCLUDED\.business_kb/.test(c)){console.error("FAIL: saveCSConfig 未 upsert business_kb");process.exit(1)}
console.log("PASS: store 读写 business_kb");'

echo "✅ wechat-cs-per-account-ia-redesign smoke 全过"
