import test from 'node:test';
import assert from 'node:assert/strict';
import {authorityFixture} from './helpers/qualification-maintenance-fixture.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,symlinkSync,unlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const api=await import('../qualification-maintenance-brain.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
function fake(change={}) {
 const f=authorityFixture(),calls=[];
 const request=async(path,body)=>{
  calls.push({path,body});if(change.request)return change.request(path,body,f,calls);
  if(path.endsWith('/heartbeat'))return {ok:true,lease_seconds:14400,lease_until:new Date(Date.now()+14400000).toISOString()};
  if(path==='/device-locks')return {success:true,locks:[{device_name:f.scope.serial,locked_by:f.originalTask.id,expires_at:new Date(Date.now()+120000).toISOString()}]};
  return structuredClone(path==='/tasks/'+f.maintenanceTask.id?f.maintenanceTask:f.originalTask);
 };
 return {...f,calls,request};
}
test('readback纯GET；没有隐藏heartbeat或claim',async()=>{
 assert.equal(typeof api?.readMaintenanceAuthority,'function');const f=fake();
 const out=await api.readMaintenanceAuthority(f.maintenanceTask.id,{request:f.request,renew:false});
 assert.equal(out.contract_sha256,f.originalTask.result.qualification_maintenance_delegation.contract_sha256);
 assert.ok(f.calls.every(x=>x.body===undefined));
});
test('显式preflight续两Task原lease，省略lease_seconds并有前后Task GET',async()=>{
 assert.equal(typeof api?.readMaintenanceAuthority,'function');const f=fake();await api.readMaintenanceAuthority(f.maintenanceTask.id,{request:f.request,renew:true});
 const h=f.calls.filter(x=>x.path.endsWith('/heartbeat'));assert.equal(h.length,2);
 assert.deepEqual(h.map(x=>x.body),[{claimer:f.maintenanceTask.claimed_by},{claimer:f.originalTask.claimed_by}]);
 for(const id of [f.maintenanceTask.id,f.originalTask.id])assert.ok(f.calls.filter(x=>x.path==='/tasks/'+id).length>=2);
 assert.ok(!f.calls.some(x=>x.path.includes('/claim')));
});
for(const kind of ['409','timeout','owner_drift','claim_epoch_drift','central_drift','no_delegation'])test(kind+'不沿旧authority继续',async()=>{
 assert.equal(typeof api?.readMaintenanceAuthority,'function');const f=fake();const normal=f.request;
 if(kind==='no_delegation')delete f.originalTask.result.qualification_maintenance_delegation;
 const request=async(path,body)=>{
  if(body&&kind==='409')throw Error('HTTP_409');if(body&&kind==='timeout')throw Error('timeout');
  const out=await normal(path,body);
  if(kind==='owner_drift'&&f.calls.some(x=>x.body)&&path==='/tasks/'+f.originalTask.id)out.claimed_by='other';
  if(kind==='claim_epoch_drift'&&f.calls.some(x=>x.body)&&path==='/tasks/'+f.maintenanceTask.id)out.claimed_at='2026-10-27T23:00:00Z';
  if(kind==='central_drift'&&path==='/device-locks')out.locks[0].locked_by='other';
  return out;
 };
 await assert.rejects(api.readMaintenanceAuthority(f.maintenanceTask.id,{request,renew:true}));
 if(kind==='no_delegation'||kind==='central_drift')assert.ok(f.calls.every(x=>x.body===undefined));
});
test('沿正式workflow的brain.env/BRAIN_INTERNAL_TOKEN真身；拒宽权限、symlink及重复键',t=>{
 assert.equal(typeof api?.readMaintenanceBrainToken,'function');const dir=mkdtempSync(join(tmpdir(),'maintenance-credential-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));mkdirSync(join(dir,'.credentials'));
 const file=join(dir,'.credentials','brain.env');writeFileSync(file,'BRAIN_INTERNAL_TOKEN="fixture-not-real-token"\n',{mode:0o600});
 assert.equal(api.readMaintenanceBrainToken(dir),'fixture-not-real-token');
 chmodSync(file,0o644);assert.throws(()=>api.readMaintenanceBrainToken(dir),/MAINTENANCE_/);chmodSync(file,0o600);
 writeFileSync(file,'BRAIN_INTERNAL_TOKEN=first\nBRAIN_INTERNAL_TOKEN=second\n');assert.throws(()=>api.readMaintenanceBrainToken(dir),/MAINTENANCE_/);
 unlinkSync(file);const target=join(dir,'target');writeFileSync(target,'BRAIN_INTERNAL_TOKEN=other\n',{mode:0o600});symlinkSync(target,file);assert.throws(()=>api.readMaintenanceBrainToken(dir),/MAINTENANCE_/);
});
test('真实HTTP适配只给候选六GET开放release读取，不授予release写入',async t=>{
 const home=mkdtempSync(join(tmpdir(),'maintenance-http-'));mkdirSync(join(home,'.credentials'));
 writeFileSync(join(home,'.credentials','brain.env'),'BRAIN_INTERNAL_TOKEN=fixture-not-real-token\n',{mode:0o600});
 const saved={home:process.env.HOME,url:process.env.BRAIN_URL,fetch:globalThis.fetch};
 t.after(()=>{process.env.HOME=saved.home;if(saved.url===undefined)delete process.env.BRAIN_URL;else process.env.BRAIN_URL=saved.url;globalThis.fetch=saved.fetch;rmSync(home,{recursive:true,force:true});});
 process.env.HOME=home;process.env.BRAIN_URL='http://localhost:5221';const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url:String(url),method:options.method});return new Response(JSON.stringify({release:{id:'fixture'}}),{status:200,headers:{'Content-Type':'application/json'}});};
 const path='/releases/33333333-3333-4333-8333-333333333333';
 for(const suffix of ['','/gate','/observations/55555555-5555-4555-8555-555555555555'])await api.maintenanceBrainRequest(path+suffix);
 assert.equal(calls.length,3);assert.ok(calls.every(x=>x.method==='GET'));
 await assert.rejects(api.maintenanceBrainRequest(path,{}),/MAINTENANCE_/);assert.equal(calls.length,3);
});
