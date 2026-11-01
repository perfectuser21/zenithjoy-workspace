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
 const {createControllerBridge}=await api();assert.equal(typeof createControllerBridge,'function');const f=fixture();const b=createControllerBridge(f.config,{brain:f.brain,remote:f.remote});await b.begin();await b.command('text-input',['悦升']);await b.finish();assert.ok(f.calls.indexOf('brain-acquire')<f.calls.indexOf('lock-acquire-new'));assert.ok(f.calls.indexOf('lock-release-exact')<f.calls.indexOf('brain-release'));assert.equal(b.state.lockReleased,true);
});
test('controller hash or profile identity mismatch fails before any device command and releases only own Brain lock',async()=>{
 const {createControllerBridge}=await api();assert.equal(typeof createControllerBridge,'function');const f=fixture(),base=f.remote;f.remote=async r=>r.action==='inspect'?{...await base(r),controllerSha256:'c'.repeat(64)}:base(r);const b=createControllerBridge(f.config,{brain:f.brain,remote:f.remote});await assert.rejects(b.begin(),/CONTROLLER_BINDING_MISMATCH/);assert.equal(f.calls.includes('text-input'),false);assert.equal(f.calls.includes('lock-acquire-new'),false);assert.ok(f.calls.includes('brain-release'));
});
test('a remote command timeout freezes subsequent effects and preserves both locks until explicit reconciliation',async()=>{
 const {createControllerBridge}=await api();assert.equal(typeof createControllerBridge,'function');const f=fixture(),base=f.remote;const remote=async r=>r.command==='text-input'?Promise.reject(Object.assign(new Error('SSH_TIMEOUT'),{remoteUnknown:true})):base(r);const b=createControllerBridge(f.config,{brain:f.brain,remote});await b.begin();await assert.rejects(b.command('text-input',['book']),/SSH_TIMEOUT/);await assert.rejects(b.command('media-push',['x']),/REMOTE_TERMINATION_UNCONFIRMED/);await assert.rejects(b.finish(),/REMOTE_TERMINATION_UNCONFIRMED/);assert.equal(f.calls.includes('brain-release'),false);assert.equal(f.calls.includes('lock-release-exact'),false);assert.equal(b.state.remoteUnknown,true);
});
test('expired Brain lease rejects writes and no generic shell or publish operation is callable',async()=>{
 const {createControllerBridge}=await api();assert.equal(typeof createControllerBridge,'function');const f=fixture();const b=createControllerBridge(f.config,{brain:f.brain,remote:f.remote});await b.begin();await assert.rejects(b.command('shell',['input','tap','1','1']),/FORBIDDEN_CONTROLLER_COMMAND/);f.brain.lease=async()=>({locked_by:b.state.owner,expired:true,expires_at:new Date().toISOString(),serverTimeMs:Date.now(),networkElapsedMs:1});await assert.rejects(b.command('text-input',['x']),/LEASE_UNSAFE/);assert.equal(f.calls.includes('text-input'),false);
});
