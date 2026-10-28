import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const api=await import('../qualification-maintenance-transport.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
test('候选路径仅正规40SHA和两固定target，不能经字符串注入SSH',()=>{
 assert.equal(typeof api?.candidateRuntimeRoot,'function');
 assert.match(api.candidateRuntimeRoot('xian-m4','a'.repeat(40)),/\/phone-candidates\/a{40}\/runtime$/);
 for(const pair of [['other','a'.repeat(40)],['xian-m4','a;id'],['mmv','../a']])assert.throws(()=>api.candidateRuntimeRoot(...pair));
});
test('真实stream actor单请求、响应配对，EOF不发signal',async()=>{
 assert.equal(typeof api?.openMaintenancePeer,'function');
 const child=spawn(process.execPath,['-e',`const rl=require('readline').createInterface({input:process.stdin});let first=true;rl.on('line',x=>{const r=JSON.parse(x);console.log(JSON.stringify(first?(first=false,{status:'guard_held',pid:process.pid,start_identity:'123:4',uid:process.getuid(),script_sha256:'a'.repeat(64)}):{status:'guard_held',local_owner:r.op==='status'?'free':'original_owner'}));});`],{stdio:['pipe','pipe','pipe']});
 const peer=await api.openMaintenancePeer(child,{serial:'SER',profile:'legacy',owner:'tag',deadline_seconds:10});
 assert.equal(peer.identity.pid,child.pid);assert.equal((await peer.request({op:'status'})).local_owner,'free');
 await peer.close();assert.equal(child.signalCode,null);assert.equal(child.exitCode,0);
});
test('actor提前退出/无响应均明确unknown，不能返回虚构guard',async()=>{
 assert.equal(typeof api?.openMaintenancePeer,'function');
 const child=spawn(process.execPath,['-e','process.exit(1)'],{stdio:['pipe','pipe','pipe']});
 await assert.rejects(api.openMaintenancePeer(child,{}, {timeoutMs:1000}),/MAINTENANCE_HOST_UNKNOWN/);
 const quiet=spawn(process.execPath,['-e','process.stdin.resume()'],{stdio:['pipe','pipe','pipe']});
 await assert.rejects(api.openMaintenancePeer(quiet,{}, {timeoutMs:30}),/MAINTENANCE_HOST_UNKNOWN/);
 assert.equal(quiet.signalCode,null);
});
