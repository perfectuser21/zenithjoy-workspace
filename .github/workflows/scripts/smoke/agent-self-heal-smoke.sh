#!/usr/bin/env bash
# agent-self-heal-smoke.sh
# Sprint 06221906 (#822) — 客户机 Agent 自愈四件端到端 smoke。
#
# 实质验证（真链路，非占位）：直接 require 编译产出的 ModuleManager + line04 handler，
# 对四件自愈逻辑做断言：
#   件1 模块进程退出 → agent 自动重启（指数退避）+ 超上限告警
#   件2 真发开关 ZENITHJOY_AGENT_REAL_PUBLISH → spawn listen_chat 注入 REAL_PUBLISH
#   件3 身份一处定：activateModule 下发 config.agentId = 稳定 UUID
#   件4 健康上报：模块 IPC {type:status} 含 listen_chat 真实健康（listener_alive/found_window）
#
# 退出码：0 全过 / 1 件1 / 2 件2 / 3 件3 / 4 件4 / 5 环境（缺 node/编译失败）
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
AGENT_DIR="$REPO_ROOT/services/agent"

command -v node >/dev/null 2>&1 || { echo "FAIL: 缺 node"; exit 5; }

echo "━━━ agent-self-heal-smoke (#822 自愈四件) repo=$REPO_ROOT ━━━"

# 编译 module-manager + line04 模块到临时 JS（真编译，不 mock）。
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$AGENT_DIR"
npx tsc src/module-manager.ts \
  --outDir "$TMP" --module commonjs --target ES2020 --moduleResolution node \
  --esModuleInterop --skipLibCheck --types node 2>/dev/null \
  || { echo "FAIL: module-manager.ts 编译失败"; exit 5; }
npx tsc modules/line04/handlers/wechat-rpa.ts \
  --outDir "$TMP/line04" --module commonjs --target ES2020 --moduleResolution node \
  --esModuleInterop --skipLibCheck --types node 2>/dev/null \
  || { echo "FAIL: line04 handler 编译失败"; exit 5; }

# ── 件1：进程退出 → 自动重启（指数退避）+ 超上限告警 ──
node -e "
const path=require('path'), fs=require('fs'), os=require('os');
const { ModuleManager } = require('$TMP/module-manager.js');
const { EventEmitter } = require('events');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'sh-'));
const dir = path.join(root,'line04-wechat-cs-1.0.0');
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'manifest.json'), JSON.stringify({lineId:'line04-wechat-cs',version:'1.0.0',entry:'index.js'}));
fs.writeFileSync(path.join(dir,'index.js'),'');
function child(){const ee=new EventEmitter();return {c:{on:(e,cb)=>ee.on(e,cb),send:()=>{},kill:()=>{},connected:true}, emit:(x)=>ee.emit('exit',x)};}
const made=[]; const delays=[]; let alerted=false;
const fork=()=>{const k=child();made.push(k);return k.c;};
const mm=new ModuleManager({modulesRoot:root,forkImpl:fork,preflightImpl:async()=>({ok:true}),superviseLines:['line04-wechat-cs'],restartBaseDelayMs:1000,restartMaxDelayMs:60000,restartMaxRetries:3,setTimeoutImpl:(fn,ms)=>{delays.push(ms);fn();return 0;},onModuleAlert:()=>{alerted=true;}});
(async()=>{
  await mm.syncModules({'line04-wechat-cs':{status:'active',required_version:'1.0.0'}});
  made[0].emit(1);
  let g=0; while(!alerted && g<50){made[made.length-1].emit(1);g++;}
  if(delays[0]!==1000 || delays[1]!==2000){console.error('退避序列错误:',delays.slice(0,3));process.exit(1);}
  if(!alerted){console.error('超上限未告警');process.exit(1);}
  console.log('  OK 件1: 退出自动重启 退避='+delays.slice(0,3)+' 超上限告警=true');
})();
" || { echo "FAIL: 件1 模块保活"; exit 1; }

# ── 件2：真发开关注入 ──
node -e "
process.env.ZENITHJOY_AGENT_REAL_PUBLISH='1'; delete process.env.REAL_PUBLISH;
const m=require('$TMP/line04/wechat-rpa.js');
if(m.resolveRealPublishEnv({ZENITHJOY_AGENT_REAL_PUBLISH:'1'})!=='1'){console.error('两名归一失败');process.exit(1);}
let env;
m._listenerKillFuncs.platform='win32';
m._listenerKillFuncs.killExistingListeners=()=>{};
m._listenerKillFuncs.spawnFn=(cmd,args,opts)=>{env=opts.env;return {stdout:{on:()=>{}},stderr:{on:()=>{}},on:()=>{}};};
m.startWechatListener('http://localhost:3000','agent-x');
if(!env || env.REAL_PUBLISH!=='1'){console.error('REAL_PUBLISH 未注入:',env&&env.REAL_PUBLISH);process.exit(1);}
console.log('  OK 件2: ZENITHJOY_AGENT_REAL_PUBLISH=1 → spawn env REAL_PUBLISH=1');
" || { echo "FAIL: 件2 真发开关传递"; exit 2; }

# ── 件3：身份一处定（UUID） ──
node -e "
const path=require('path'),fs=require('fs'),os=require('os');
const { ModuleManager }=require('$TMP/module-manager.js');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'sh3-'));
const dir=path.join(root,'line04-wechat-cs-1.0.0');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({lineId:'line04-wechat-cs',version:'1.0.0',entry:'index.js'}));
fs.writeFileSync(path.join(dir,'index.js'),'');
const sent=[];
const mm=new ModuleManager({modulesRoot:root,forkImpl:()=>({on:()=>{},send:(x)=>sent.push(x),kill:()=>{},connected:true}),preflightImpl:async()=>({ok:true})});
mm.setIdentity('agent-host-envid','https://api.x');
mm.setIdentity('11111111-2222-3333-4444-555555555555','https://api.x');
(async()=>{
  await mm.syncModules({'line04-wechat-cs':{status:'active',required_version:'1.0.0'}});
  const cfg=sent.find(s=>s&&s.type==='config');
  if(!cfg || cfg.agentId!=='11111111-2222-3333-4444-555555555555'){console.error('config.agentId 非稳定UUID:',cfg);process.exit(1);}
  console.log('  OK 件3: config.agentId = 稳定 UUID');
})();
" || { echo "FAIL: 件3 身份一处定"; exit 3; }

# ── 件4：健康上报字段 ──
node -e "
const path=require('path'),fs=require('fs'),os=require('os');
const m=require('$TMP/line04/wechat-rpa.js');
const hf=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'sh4-')),'h.json');
fs.writeFileSync(hf,JSON.stringify({found_window:true,login_present:true,last_delivery_ts:1750000000000}));
const h=m.collectListenerHealth({healthFile:hf,listenerAlive:true});
if(!(h.ok && h.listener_alive && h.found_window && h.last_delivery_ts===1750000000000)){console.error('健康合成错误:',h);process.exit(1);}
const dead=m.collectListenerHealth({healthFile:hf,listenerAlive:false});
if(dead.ok!==false || dead.listener_alive!==false){console.error('进程不在应 ok:false:',dead);process.exit(1);}
const msg=m.buildHealthStatusMessage(h);
if(msg.type!=='status' || msg.found_window!==true){console.error('IPC status 消息错误:',msg);process.exit(1);}
console.log('  OK 件4: collectListenerHealth + buildHealthStatusMessage 含 listener_alive/found_window/last_delivery_ts');
" || { echo "FAIL: 件4 健康上报"; exit 4; }

echo "agent-self-heal-smoke: PASS"
