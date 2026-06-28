#!/usr/bin/env bash
# cs-account-workbench-smoke.sh
# 微信客服「以号为中心」IA 重设计刀2 轻量 smoke（前端 IA 重组，无需 DB/server）。
# 验：① 导航入口改 CsAreaEntryPage + 新增 总览/单号工作台 路由 + 三页懒加载注册；
#     ② 单号工作台复用现有 4 个页面组件（embedded 模式）+ 5 个 Tab；
#     ③ 各 Tab 按号 context 收窄（CustomerListPage 透传 cs_wechat_id scope；总览/分诊用 scoped /cs/machines）。
# 可选 live：BASE_URL 指向运行中的 API → curl GET /api/wechat/cs/machines 验证 scoped 列表 shape。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
DASH="apps/dashboard/src"

echo "── ① 导航：/area/wechat → CsAreaEntryPage + 总览/工作台路由 + 懒加载注册 ──"
node -e 'const fs=require("fs");
const c=fs.readFileSync("'"$DASH"'/config/navigation.config.ts","utf8");
if(!/path:\s*.\/area\/wechat.[^]*?component:\s*.CsAreaEntryPage./.test(c)){console.error("FAIL: /area/wechat 未改 CsAreaEntryPage");process.exit(1)}
if(!/path:\s*.\/wechat\/accounts.[^]*?component:\s*.CsAccountOverviewPage./.test(c)){console.error("FAIL: 缺 /wechat/accounts → CsAccountOverviewPage");process.exit(1)}
if(!/path:\s*.\/wechat\/account\/:machineId.[^]*?component:\s*.CsAccountWorkbenchPage./.test(c)){console.error("FAIL: 缺 /wechat/account/:machineId → CsAccountWorkbenchPage");process.exit(1)}
for(const n of ["CsAreaEntryPage","CsAccountOverviewPage","CsAccountWorkbenchPage"]){
  if(!new RegExp("."+n+".:\\s*\\(\\)\\s*=>\\s*import").test(c)){console.error("FAIL: 未注册懒加载 "+n);process.exit(1)}
}
// 旧 5 平级页路由仍保留（深链不死链）
for(const p of ["/wechat/cs-config","/wechat/setup","/wechat/cs-stats","/wechat/crm"]){
  if(!c.includes("\x27"+p+"\x27")){console.error("FAIL: 旧路由丢失(死链) "+p);process.exit(1)}
}
console.log("PASS: 导航入口 + 总览/工作台路由 + 懒加载 + 旧路由保留");'

echo "── ② 单号工作台复用 4 现有页面 + 5 Tab ──"
node -e 'const fs=require("fs");
const c=fs.readFileSync("'"$DASH"'/pages/CsAccountWorkbenchPage.tsx","utf8");
for(const comp of ["WechatCustomerServiceConfigPage","CsOneClickSetupPage","CustomerListPage","CsWorkStatsPage"]){
  if(!new RegExp("import\\s+"+comp+"\\s+from").test(c)){console.error("FAIL: 工作台未复用 "+comp);process.exit(1)}
}
if(!/cs-tab-\$\{/.test(c)){console.error("FAIL: 缺 cs-tab- 测试钩子");process.exit(1)}
for(const t of ["persona","kb","settings","customers","stats"]){
  if(!new RegExp("key:\\s*."+t+".").test(c)){console.error("FAIL: 缺 Tab "+t);process.exit(1)}
}
if(!/section="persona"/.test(c)||!/section="kb"/.test(c)){console.error("FAIL: 人设/知识库未按 section 拆 Tab");process.exit(1)}
if(!/embedded/.test(c)){console.error("FAIL: 未用 embedded 复用");process.exit(1)}
console.log("PASS: 复用 4 页面 + 5 Tab");'

echo "── ③ 按号 context 收窄：客户透传 cs_wechat_id scope + 总览/分诊用 scoped /cs/machines ──"
node -e 'const fs=require("fs");
const cl=fs.readFileSync("'"$DASH"'/pages/CustomerListPage.tsx","utf8");
if(!/cs_wechat_id=\$\{encodeURIComponent\(fixedCsWechatId\)\}/.test(cl)){console.error("FAIL: CustomerListPage 未按号过滤(cs_wechat_id)");process.exit(1)}
const ov=fs.readFileSync("'"$DASH"'/pages/CsAccountOverviewPage.tsx","utf8");
const en=fs.readFileSync("'"$DASH"'/pages/CsAreaEntryPage.tsx","utf8");
if(!/listCSMachines/.test(ov)||!/listCSMachines/.test(en)){console.error("FAIL: 总览/分诊未用 scoped listCSMachines");process.exit(1)}
if(!/isSuperAdmin/.test(en)){console.error("FAIL: 分诊未按角色(isSuperAdmin)分流");process.exit(1)}
const wb=fs.readFileSync("'"$DASH"'/pages/CsAccountWorkbenchPage.tsx","utf8");
if(!/cs-workbench-forbidden/.test(wb)){console.error("FAIL: 工作台缺可见性兜底(forbidden)");process.exit(1)}
console.log("PASS: 客户按号过滤 + 总览/分诊 scoped + 角色分流 + 可见性兜底");'

# ── 可选 live：对运行中的 API 验证 scoped 客服号列表 shape ──
if [ -n "${BASE_URL:-}" ]; then
  echo "── ④ live: GET ${BASE_URL}/api/wechat/cs/machines (scoped 列表 shape) ──"
  RESP=$(curl -fsS "${BASE_URL}/api/wechat/cs/machines" || echo '')
  echo "$RESP" | node -e 'const fs=require("fs");const s=fs.readFileSync(0,"utf8");
  if(!s){console.error("WARN: 空响应(可能未起服务)，跳过 live");process.exit(0)}
  const d=JSON.parse(s); if(!Array.isArray(d.machines)){console.error("FAIL: /cs/machines 应返回 {machines:[...]}");process.exit(1)}
  console.log("PASS live: machines 数组 len="+d.machines.length);'
else
  echo "── ④ live 跳过（未设 BASE_URL，IA 重组验证以静态为准）──"
fi

echo "✅ cs-account-workbench smoke 全过"
