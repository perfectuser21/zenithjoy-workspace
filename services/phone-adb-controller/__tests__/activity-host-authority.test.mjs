import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {foundationFixture} from './helpers/leadgen-foundation-fixture.mjs';
import {prepareLeadgenHost} from '../leadgen-foundation/adapter.mjs';
const probe=new URL('./fixtures/host-authority-http.py',import.meta.url);
async function run(mode){
 const f=await foundationFixture('102');try{
  const host=await prepareLeadgenHost(f);
  const r=spawnSync('python3',[probe.pathname,host.profile.cwd,mode],{encoding:'utf8',timeout:30000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
 }finally{f.close();}
}
const requests=x=>Object.values(x.counts).reduce((a,b)=>a+b,0);
test('actual assembled 102 deduplicates the same root and current Task GET',async()=>{
 const r=await run('healthy');assert.equal(r.error,null);assert.equal(r.code,0);assert.equal(requests(r),1);assert.equal(r.dispatches,1);
});
test('real HTTP disconnect waits once eight seconds then invokes exactly once',async()=>{
 const r=await run('retry-real');assert.equal(r.error,null);assert.equal(r.code,0);assert.equal(requests(r),2);assert.equal(r.dispatches,1);assert.ok(r.duration>=8&&r.duration<20,r.duration);
});
test('exhausted pre-dispatch transport emits explicit refusal without a business receipt',async()=>{
 const r=await run('exhaust');assert.equal(r.code,75);assert.equal(r.error,null);assert.equal(requests(r),2);assert.deepEqual(r.sleeps,[8]);assert.equal(r.dispatches,0);assert.deepEqual(r.receipts,[]);
 const p=JSON.parse(r.stdout);assert.equal(p.state,'terminal');assert.equal(p.result.exit_code,75);assert.equal(p.result.data.code,'TASK_AUTHORITY_TRANSPORT_UNAVAILABLE');assert.equal(p.result.data.phase,'pre_dispatch');assert.equal(p.result.data.dispatched,false);assert.equal(p.result.data.business_receipt_created,false);
});
test('different root and current Task each remain authorized with one shared twenty-second budget',async()=>{
 const r=await run('distinct');assert.equal(r.code,0);assert.equal(Object.keys(r.counts).length,2);assert.deepEqual(Object.values(r.counts),[2,2]);assert.deepEqual(r.sleeps,[8,8]);assert.ok(r.timeouts[2]<=12&&r.timeouts[3]<=4);assert.equal(r.dispatches,1);
});
test('insufficient activity budget returns without sleeping or making a second GET',async()=>{
 const r=await run('short');assert.equal(r.code,75);assert.equal(requests(r),1);assert.deepEqual(r.sleeps,[]);assert.equal(r.dispatches,0);assert.ok(r.timeouts[0]<=7);
});
for(const mode of ['http401','http403','http500','bad-json','bad-owner','bad-status','post'])test(`${mode} is never retried or classified as a transient authority refusal`,async()=>{
 const r=await run(mode);assert.equal(requests(r),1);assert.equal(r.dispatches,0);assert.deepEqual(r.sleeps,[]);assert.notEqual(r.error,null);assert.equal(r.stdout,'');
});
test('cleanup uses its actual cleanup deadline after business deadline has passed',async()=>{
 const r=await run('cleanup');assert.equal(r.code,0);assert.equal(requests(r),1);assert.equal(r.dispatches,1);
});

test('real TCP reset is retried only at the read-only Task boundary',async()=>{
 const r=await run('reset');assert.equal(r.code,0);assert.equal(requests(r),2);assert.deepEqual(r.sleeps,[8]);assert.equal(r.dispatches,1);
});
test('the same authority failure after actual invoke remains unknown without a false pre-dispatch receipt',async()=>{
 const r=await run('post-dispatch');assert.equal(r.code,null);assert.match(r.error,/TaskAuthorityUnavailable/);assert.equal(r.stdout,'');assert.equal(r.dispatches,1);assert.deepEqual(r.states,['unknown']);
});

test('a trickling HTTP body cannot extend the admission deadline or dispatch late',async()=>{
 const r=await run('slow-body');assert.equal(r.code,75);assert.equal(r.dispatches,0);assert.equal(requests(r),1);assert.ok(r.duration<0.8,r.duration);assert.deepEqual(r.receipts,[]);
});
