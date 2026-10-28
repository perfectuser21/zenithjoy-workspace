import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../qualification-maintenance-effects.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
function fixture(){const saved=[],calls=[];return {saved,calls,input:{scope:{serial:'SER1'},epoch:{},contract_sha256:'a'.repeat(64),
 readOriginal:async()=>({raw_manifest:[{path:'original',sha256:'b'.repeat(64)}],recording:{native_audio_restored:{state:'started'}}}),
 readCommander:async()=>{calls.push('commander');return {status:'verified_inactive'};},readMmv:()=>{calls.push('mmv');return {status:'blocked'};},
 readDevice:async()=>{calls.push('device');return {status:'blocked',stage:'parse_processes',diagnostics:{process_header:'UID PID PPID NAME'}};},
 readDomain:async()=>{calls.push('domain');throw Error('must not reach');},retainEvidence:e=>{saved.push(e);return 'c'.repeat(64);}}};}
test('设备BLOCK也先永久保本次已取partial/stage，不触后续域/PG并返回非成功',async()=>{
 assert.equal(typeof api?.collectMaintenanceEffects,'function');const f=fixture(),r=await api.collectMaintenanceEffects(f.input);
 assert.equal(r.status,'blocked');assert.equal(r.stage,'device');assert.equal(f.saved.length,1);
 assert.equal(f.saved[0].device.stage,'parse_processes');assert.deepEqual(f.calls,['commander','mmv','device']);
 assert.equal(r.effects_input_sha256,'c'.repeat(64));
});
test('前段采集未知同样保已得原件摘要；不继续device/域也不把异常当inactive',async()=>{
 assert.equal(typeof api?.collectMaintenanceEffects,'function');const f=fixture();f.input.readCommander=async()=>{throw Error('transport unknown');};
 const r=await api.collectMaintenanceEffects(f.input);assert.equal(r.status,'blocked');assert.equal(r.stage,'commander');
 assert.equal(f.saved.length,1);assert.equal(f.saved[0].original_raw_manifest[0].path,'original');assert.deepEqual(f.calls,[]);
});
test('证据持久化未知不得重发写日志或返回effectsverified',async()=>{
 assert.equal(typeof api?.collectMaintenanceEffects,'function');const f=fixture();let count=0;f.input.retainEvidence=()=>{count++;throw Error('unknown durable write');};
 await assert.rejects(api.collectMaintenanceEffects(f.input));assert.equal(count,1);
});
