import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {authorizeMaintenance} from '../qualification-maintenance-authority.mjs';
import {authorityFixture} from './helpers/qualification-maintenance-fixture.mjs';
const api=await import('../qualification-maintenance-journal.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(t) {
 const home=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'maintenance-journal-')));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const f=authorityFixture();f.maintenanceTask.claimed_at='2026-10-28T00:00:00.000Z';f.originalTask.claimed_at='2026-10-27T22:16:40.000Z';
 const authority=authorizeMaintenance(f),path=join(home,'.local/share/zenithjoy/qualification-maintenance',authority.maintenance_task_id,authority.scope.intent_id);
 const record=(phase,extra={})=>({phase,at_ms:1793148000000,contract_sha256:authority.contract_sha256,...extra});
 assert.equal(typeof api?.readMaintenanceJournal,'function');assert.equal(typeof api?.appendMaintenanceJournal,'function');
 return {home,authority,path,record};
}
function fault(name,replacement,body) {
 const original=fs[name];fs[name]=replacement(original);syncBuiltinESMExports();
 try{return body();}finally{fs[name]=original;syncBuiltinESMExports();}
}
test('新read纯读不创建目录；完成回执原件持久且不覆盖',t=>{
 const f=fixture(t);assert.deepEqual(api.readMaintenanceJournal(f.authority,{home:f.home}),[]);assert.equal(fs.existsSync(join(f.home,'.local')),false);
 const a=api.appendMaintenanceJournal(f.authority,f.record('db_intent'),{home:f.home});
 const original=fs.readFileSync(a.path);assert.equal(a.durable,true);assert.equal(a.sha256,sha(original));
 const b=api.appendMaintenanceJournal(f.authority,f.record('db_committed'),{home:f.home});
 assert.notEqual(a.path,b.path);assert.deepEqual(fs.readFileSync(a.path),original);
 const rows=api.readMaintenanceJournal(f.authority,{home:f.home});assert.deepEqual(rows.map(r=>r.phase),['db_intent','db_committed']);
 assert.deepEqual(rows.map(r=>r.journal_sequence),[1,2]);assert.equal(rows[0].journal_sha256,a.sha256);
});
for(const key of ['actor','original_actor','maintenance_claimed_at','original_claimed_at','contract_sha256'])test(key+'变化不能沿用旧epoch回执',t=>{
 const f=fixture(t);api.appendMaintenanceJournal(f.authority,f.record('db_intent'),{home:f.home});
 const changed={...f.authority,[key]:key.includes('claimed')?'2026-10-28T01:00:00.000Z':'changed'};
 assert.throws(()=>api.readMaintenanceJournal(changed,{home:f.home}),/MAINTENANCE_JOURNAL_/);
});
test('私有回执目录符号链接和文件权限放宽均拒绝',t=>{
 const f=fixture(t),a=api.appendMaintenanceJournal(f.authority,f.record('db_intent'),{home:f.home});
 fs.chmodSync(a.path,0o644);assert.throws(()=>api.readMaintenanceJournal(f.authority,{home:f.home}),/MAINTENANCE_JOURNAL_/);
 fs.chmodSync(a.path,0o600);const moved=f.path+'-moved';fs.renameSync(f.path,moved);fs.symlinkSync(moved,f.path);
 assert.throws(()=>api.readMaintenanceJournal(f.authority,{home:f.home}),/MAINTENANCE_JOURNAL_/);
});
test('rename失败保留pending原字节，未知不能允许再写db_intent',t=>{
 const f=fixture(t);
 fault('renameSync',()=>()=>{throw Error('injected rename failure');},()=>assert.throws(()=>api.appendMaintenanceJournal(f.authority,f.record('db_intent'),{home:f.home}),/MAINTENANCE_JOURNAL_/));
 const names=fs.readdirSync(f.path),pending=names.find(n=>n.endsWith('.pending'));assert.ok(pending);
 const before=fs.readFileSync(join(f.path,pending)),rows=api.readMaintenanceJournal(f.authority,{home:f.home});
 assert.equal(rows[0].phase,'journal_incomplete');assert.ok(rows[0].raw_manifest.some(r=>r.sha256===sha(before)));
 assert.throws(()=>api.appendMaintenanceJournal(f.authority,f.record('db_intent'),{home:f.home}),/MAINTENANCE_JOURNAL_/);
 assert.deepEqual(fs.readFileSync(join(f.path,pending)),before);
});
test('PG已提交后的pending崩溃可追加新观察收口，旧未知和hash仍保留',t=>{
 const f=fixture(t);api.appendMaintenanceJournal(f.authority,f.record('db_intent'),{home:f.home});
 fault('renameSync',()=>()=>{throw Error('crash after DB commit');},()=>assert.throws(()=>api.appendMaintenanceJournal(f.authority,f.record('db_committed'),{home:f.home}),/MAINTENANCE_JOURNAL_/));
 const before=api.readMaintenanceJournal(f.authority,{home:f.home}),unknown=before[1];assert.equal(unknown.phase,'journal_incomplete');
 api.appendMaintenanceJournal(f.authority,f.record('db_committed'),{home:f.home});api.appendMaintenanceJournal(f.authority,f.record('closed'),{home:f.home});
 const after=api.readMaintenanceJournal(f.authority,{home:f.home});assert.deepEqual(after.map(r=>r.phase),['db_intent','journal_incomplete','db_committed','closed']);
 assert.deepEqual(after[1],unknown);assert.throws(()=>api.appendMaintenanceJournal(f.authority,f.record('db_intent'),{home:f.home}),/MAINTENANCE_JOURNAL_/);
});
test('半写reserve保留为未知，不能丢文件或猜成新空epoch',t=>{
 const f=fixture(t);
 fault('writeFileSync',original=>(file,contents,...rest)=>{original(file,String(contents).slice(0,12),...rest);throw Error('partial write');},()=>assert.throws(()=>api.appendMaintenanceJournal(f.authority,f.record('db_intent'),{home:f.home}),/MAINTENANCE_JOURNAL_/));
 const rows=api.readMaintenanceJournal(f.authority,{home:f.home});assert.equal(rows.length,1);assert.equal(rows[0].phase,'journal_incomplete');
 const file=fs.readdirSync(f.path)[0],original=fs.readFileSync(join(f.path,file));assert.equal(original.length,12);
 assert.throws(()=>api.appendMaintenanceJournal(f.authority,f.record('db_intent'),{home:f.home}),/MAINTENANCE_JOURNAL_/);assert.deepEqual(fs.readFileSync(join(f.path,file)),original);
});
test('目录fsync失败不返回durable成功，已落盘db_intent仍挡重复写库',t=>{
 const f=fixture(t);
 fault('fsyncSync',original=>fd=>{if(fs.fstatSync(fd).isDirectory())throw Error('directory fsync failure');return original(fd);},()=>assert.throws(()=>api.appendMaintenanceJournal(f.authority,f.record('db_intent'),{home:f.home}),/MAINTENANCE_JOURNAL_/));
 const rows=api.readMaintenanceJournal(f.authority,{home:f.home});assert.ok(rows.some(r=>r.phase==='db_intent'||r.phase==='journal_incomplete'));
 assert.throws(()=>api.appendMaintenanceJournal(f.authority,f.record('db_intent'),{home:f.home}),/MAINTENANCE_JOURNAL_/);
});
test('删除序号、改旧原字节或塞未知文件不允许静默跳过',t=>{
 const f=fixture(t);const a=api.appendMaintenanceJournal(f.authority,f.record('db_intent'),{home:f.home});api.appendMaintenanceJournal(f.authority,f.record('db_committed'),{home:f.home});
 const original=fs.readFileSync(a.path);fs.writeFileSync(a.path,original.toString().replace('db_intent','db_closed'));
 assert.throws(()=>api.readMaintenanceJournal(f.authority,{home:f.home}),/MAINTENANCE_JOURNAL_/);
 fs.writeFileSync(a.path,original);const reserve=fs.readdirSync(f.path).find(n=>n.startsWith('00000001')&&n.endsWith('.reserve'));fs.unlinkSync(join(f.path,reserve));
 assert.throws(()=>api.readMaintenanceJournal(f.authority,{home:f.home}),/MAINTENANCE_JOURNAL_/);
});
