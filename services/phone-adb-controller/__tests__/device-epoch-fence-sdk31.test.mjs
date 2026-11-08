import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir=new URL('./fixtures/device-epoch-fence-sdk31/',import.meta.url),read=n=>readFileSync(new URL(n,dir),'utf8'),load=()=>import('../device-epoch-fence-sdk31.mjs');
const original=Object.fromEntries(['sdk','boot_id','processes','input','activity'].map(q=>[q,read(q+'.txt')]));
test('真实SDK31原始fixture哈希与格式；单独诊断仍不签整体排空',async()=>{
 const p=JSON.parse(read('provenance.json'));for(const [q,v]of Object.entries(p.files)){assert.equal(createHash('sha256').update(original[q]).digest('hex'),v.fixture_sha256);assert.equal(v.wire_complete,true);assert.equal(v.exit_code,0);}
 const {parseSdk31Diagnostics}=await load(),r=parseSdk31Diagnostics(original);assert.equal(r.processes.rows.length,8);assert.equal(r.input.connections,15);assert.equal(r.input.queue_idle,true);assert.equal(r.activities.records,8);assert.equal(r.activities.records_idle,true);assert.equal(r.activities.pending_launch,'not_attested');assert.equal(r.remote_quiescence,'unknown');assert.equal(r.original_execution_stopped,false);assert.ok(r.processes.unresolved_shells.some(p=>p.pid===195));
});
test('wait/outbound/pending/touch/key/dispatcher字段非空或缺失均不视为空闲',async()=>{
 const {parseSdk31Diagnostics}=await load();for(const [from,to]of [['WaitQueue: <empty>','WaitQueue: length=1'],['OutboundQueue: <empty>','OutboundQueue: length=1'],['PendingEvent: <none>','PendingEvent: KeyEvent'],['InboundQueue: <empty>','InboundQueue: length=1'],['KeyDowns: 0 keys currently down','KeyDowns: 1 keys currently down'],['Last Raw Touch: pointerCount=0','Last Raw Touch: pointerCount=1'],['DispatchFrozen: false','DispatchFrozen: true'],['  Connections:','  MissingConnections:']]){const r=parseSdk31Diagnostics({...original,input:original.input.replace(from,to)});assert.equal(r.input.queue_idle,false,from);assert.equal(r.remote_quiescence,'unknown');}
});
test('截断process库存/Activity idle缺失/原producer存在，全部保守UNKNOWN',async()=>{
 const {parseSdk31Diagnostics}=await load();for(const change of [{processes:original.processes+'garbage\n'},{processes:original.processes+'    0 99999 745 uiautomator uiautomator dump --compressed /sdcard/old.xml\n'},{activity:original.activity.replace('idle=true','idle=false')},{activity:original.activity.replace('mVisibilityTransactionDepth=0','mVisibilityTransactionDepth=1')}]){const r=parseSdk31Diagnostics({...original,...change});assert.equal(r.remote_quiescence,'unknown');assert.ok(r.reasons.length);}
 assert.throws(()=>parseSdk31Diagnostics({...original,sdk:'32\n'}),/SDK31_REQUIRED/);
});
