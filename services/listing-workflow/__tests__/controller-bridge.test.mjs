import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync}from'node:fs';
import {tmpdir}from'node:os';
import {join}from'node:path';
async function api(){try{return await import('../controller-bridge.mjs');}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;}}
function fixture(){
 const calls=[];let brainOwner=null,controllerOwner=null;
 const binding={serial:'SERIAL123',model:'MAA-AN00',width:1200,height:2664,route:['jump','operator@host'],controllerPath:'/Users/operator/bin-harvest/douyin-phone-adb',controllerSha256:'a'.repeat(64),focusSha256:'b'.repeat(64),baseProfile:'xiaolongxia',authority:'reviewed-device-binding'};
 const brain={acquire:async(serial,owner)=>{calls.push('brain-acquire');brainOwner=owner;return{acquired:true};},lease:async()=>({locked_by:brainOwner,expired:false,expires_at:new Date(Date.now()+7200000).toISOString(),serverTimeMs:Date.now(),networkElapsedMs:1}),release:async()=>{calls.push('brain-release');brainOwner=null;return{success:true};}};
 const remote=async request=>{calls.push(request.action==='controller'?request.command:request.action);if(request.action==='inspect')return{controllerSha256:binding.controllerSha256,focusSha256:binding.focusSha256,profile:{serial:binding.serial,model:binding.model,width:1200,height:2664,enabled:true}};if(request.action==='initialize')return{ok:true};if(request.command==='lock-acquire-new'){controllerOwner=request.owner;return{stdout:'lock=acquired owner='+controllerOwner};}if(request.command==='lock-status')return{stdout:controllerOwner?'lock=held owner='+controllerOwner+' age=0s stale=false reclaimable=false ttl=1800s':'lock=free'};if(request.command==='lock-release-exact'){controllerOwner=null;return{stdout:'lock=released'};}if(request.command==='lock-refresh')return{stdout:'lock=refreshed'};return{stdout:'ok'};};
 return{binding,brain,remote,calls,config:{binding,runId:'native-run',root:mkdtempSync(join(tmpdir(),'pdd-controller-'))}};
}
test('acquires Brain then a fresh controller lock and releases only after exact-owner readback',async()=>{
 const {createControllerBridge}=await api();assert.equal(typeof createControllerBridge,'function');const f=fixture();const b=createControllerBridge(f.config,{brain:f.brain,remote:f.remote});await b.begin();await b.command('foreground',[]);await b.finish();assert.ok(f.calls.indexOf('brain-acquire')<f.calls.indexOf('lock-acquire-new'));assert.ok(f.calls.indexOf('lock-release-exact')<f.calls.indexOf('brain-release'));assert.equal(b.state.lockReleased,true);
});
test('controller hash or profile identity mismatch fails before any device command and releases only own Brain lock',async()=>{
 const {createControllerBridge}=await api();assert.equal(typeof createControllerBridge,'function');const f=fixture(),base=f.remote;f.remote=async r=>r.action==='inspect'?{...await base(r),controllerSha256:'c'.repeat(64)}:base(r);const b=createControllerBridge(f.config,{brain:f.brain,remote:f.remote});await assert.rejects(b.begin(),/CONTROLLER_BINDING_MISMATCH/);assert.equal(f.calls.includes('text-input'),false);assert.equal(f.calls.includes('lock-acquire-new'),false);assert.ok(f.calls.includes('brain-release'));
});
test('a remote command timeout freezes subsequent effects and preserves both locks until explicit reconciliation',async()=>{
 const {createControllerBridge}=await api();assert.equal(typeof createControllerBridge,'function');const f=fixture(),base=f.remote;const remote=async r=>r.command==='foreground'?Promise.reject(Object.assign(new Error('SSH_TIMEOUT'),{remoteUnknown:true})):base(r);const b=createControllerBridge(f.config,{brain:f.brain,remote});await b.begin();await assert.rejects(b.command('foreground',[]),/SSH_TIMEOUT/);await assert.rejects(b.command('media-push',['x']),/REMOTE_TERMINATION_UNCONFIRMED/);await assert.rejects(b.finish(),/REMOTE_TERMINATION_UNCONFIRMED/);assert.equal(f.calls.includes('brain-release'),false);assert.equal(f.calls.includes('lock-release-exact'),false);assert.equal(b.state.remoteUnknown,true);
});
test('expired Brain lease rejects writes and no generic shell or publish operation is callable',async()=>{
 const {createControllerBridge}=await api();assert.equal(typeof createControllerBridge,'function');const f=fixture();const b=createControllerBridge(f.config,{brain:f.brain,remote:f.remote});await b.begin();await assert.rejects(b.command('shell',['input','tap','1','1']),/FORBIDDEN_CONTROLLER_COMMAND/);f.brain.lease=async()=>({locked_by:b.state.owner,expired:true,expires_at:new Date().toISOString(),serverTimeMs:Date.now(),networkElapsedMs:1});await assert.rejects(b.command('foreground',[]),/LEASE_UNSAFE/);assert.equal(f.calls.includes('text-input'),false);
});

test('a lost acquire receipt is reconciled without acquiring twice',async()=>{
 const {createControllerBridge}=await api();const f=fixture(),acquire=f.brain.acquire;f.brain.acquire=async(...a)=>{await acquire(...a);throw new Error('HTTP_REPLY_LOST');};const b=createControllerBridge(f.config,{brain:f.brain,remote:f.remote});await assert.rejects(b.begin(),/HTTP_REPLY_LOST/);assert.equal(f.calls.filter(x=>x==='brain-acquire').length,1);assert.ok(f.calls.includes('brain-release'));
});
test('an existing unfinished local session cannot be silently overwritten by a new owner',async()=>{
 const {createControllerBridge}=await api();const f=fixture();const one=createControllerBridge(f.config,{brain:f.brain,remote:f.remote});await one.begin();assert.throws(()=>createControllerBridge(f.config,{brain:f.brain,remote:f.remote}),/EXISTING_SESSION/);await one.finish();
});

test('host data cannot override locked session identity',async()=>{
 const {createControllerBridge}=await api();const f=fixture();const b=createControllerBridge(f.config,{brain:f.brain,remote:f.remote});await b.begin();
 await assert.rejects(b.host('observe',{action:'controller',command:'text-input',owner:'other'}),/RESERVED_REQUEST_FIELD/);assert.equal(f.calls.includes('text-input'),false);await b.finish();
});

test('public bridge cannot bypass semantic draft validation with direct text input',async()=>{const {createControllerBridge}=await api();const f=fixture();const b=createControllerBridge(f.config,{brain:f.brain,remote:f.remote});await b.begin();await assert.rejects(b.command('text-input',['任意输入']),/FORBIDDEN_CONTROLLER_COMMAND/);await b.finish();});

test('a slow lock refresh cannot consume the device lease before dispatch',async()=>{const {createControllerBridge}=await api();const f=fixture();let expired=false;const lease=f.brain.lease;f.brain.lease=async()=>({...await lease(),expired});const remote=async r=>{const result=await f.remote(r);if(r.command==='lock-refresh')expired=true;return result;};const b=createControllerBridge(f.config,{brain:f.brain,remote});await b.begin();await assert.rejects(b.host('observe'),/LEASE_UNSAFE/);assert.equal(f.calls.includes('observe'),false);});

test('overlapping local operations cannot race finish against a native action',async()=>{const {createControllerBridge}=await api();const f=fixture();let release,entered;const waiting=new Promise(r=>entered=r);const remote=async q=>{if(q.action==='observe'){entered();await new Promise(r=>release=r);}return f.remote(q);};const b=createControllerBridge(f.config,{brain:f.brain,remote});await b.begin();const active=b.host('observe');await waiting;await assert.rejects(b.finish(),/SESSION_OPERATION_BUSY/);release();await active;await b.finish();});
