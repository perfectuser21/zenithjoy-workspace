#!/usr/bin/env bash
# line04-per-cs-config-smoke.sh
# Line04 每客服独立配置 — 轻量 smoke（无需 DB/server，CI 任意环境可跑）。
# 验：① 客户机真发 gate 决策纯函数行为正确（OFF/ON/拉失败强制 dryrun + 白名单 + 断网缓存）；
#     ② 每客服配置 migration 文件存在且建表 + 含存量全局迁移目标 wxid_legacy_global。
# 真实隔离/身份/迁移的端到端断言走 e2e-line04-per-cs-config.yml（ubuntu+postgres + windows）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

echo "── ① gate 决策纯函数 ──"
node -e 'const {resolveSendMode,resolveActiveConfig,shouldReply}=require("./services/agent/build-modules/line04/cs-config-gate.js");
const cached={auto_agent_enabled:true,whitelist:["客户甲"]};
const ok = resolveSendMode({auto_agent_enabled:true},true)==="real"
  && resolveSendMode({auto_agent_enabled:false},true)==="dryrun"
  && resolveSendMode({auto_agent_enabled:true},false)==="dryrun"
  && JSON.stringify(resolveActiveConfig(null,cached,false))===JSON.stringify(cached)
  && shouldReply(cached,"客户甲")===true && shouldReply(cached,"路人")===false;
if(!ok){console.error("FAIL: gate/缓存/白名单 判定错误");process.exit(1)}
console.log("PASS: gate 决策纯函数");'

echo "── ② migration 文件存在 + 建表 + 含存量迁移目标 ──"
node -e 'const fs=require("fs");
const f=fs.readdirSync("apps/api/db/migrations").find(n=>/wechat_cs_account_config/.test(n));
if(!f){console.error("FAIL: 缺 migration 文件");process.exit(1)}
const c=fs.readFileSync("apps/api/db/migrations/"+f,"utf8");
if(!/CREATE TABLE IF NOT EXISTS zenithjoy\.wechat_cs_account_config/.test(c)){console.error("FAIL: 未建每客服配置表");process.exit(1)}
if(!/wxid_legacy_global/.test(c)||!/wechat_cs_config/.test(c)){console.error("FAIL: 缺存量全局迁移");process.exit(1)}
console.log("PASS: migration 建表 + 存量迁移 "+f);'

echo "✅ line04-per-cs-config smoke 全过"
