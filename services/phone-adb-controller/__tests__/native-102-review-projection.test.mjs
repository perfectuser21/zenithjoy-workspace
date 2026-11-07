// Independent review probe: real private PG COMMIT loss, unchanged production
// processing object, and the exact final runtime projection expression.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {usingNative102Queue} from './fixtures/native-102-queue-fixture.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('actual processing claim COMMIT loss must remain unknown in the runtime state projection',async t=>usingNative102Queue(t,async f=>{
 const pins=f.source.files.filter(r=>r.path==='native-phone-processing.mjs');assert.equal(pins.length,1,'review must consume the unique formal processing Source');assert.equal(pins[0].sha256,sha(readFileSync(join(f.root,'native-phone-processing.mjs'))));
 let lost=false;const createPool=async options=>{const a=await f.createPool(options),connect=a.pool.connect.bind(a.pool);a.pool.connect=async()=>{const c=await connect(),query=c.query.bind(c);let write=false;return {...c,async query(text,args){if(text.startsWith('WITH pending AS'))write=true;const value=await query(text,args);if(text==='COMMIT'&&write&&!lost){lost=true;throw Error('REVIEW_ACTUAL_CLAIM_COMMIT_ACK_LOST');}return value;}};};return a;};
 const mod=await f.load('native-phone-processing.mjs'),processing=mod.createNativePhoneProcessing({root:f.root,source:f.source,env:f.env,createPool});
 const ds=f.activate('dedup');await processing.prepareActivity(ds,{directory:f.makeDirectory('review-intake'),assertAuthority:f.authority(),resources:async()=>true,refreshOwned:async()=>{throw Error("UNUSED_REVIEW_HOOK");},readbackAuthority:async()=>{throw Error("UNUSED_REVIEW_HOOK");}});await processing.primitives(ds).verifyUpstream();assert.equal((await processing.closeActivity(ds)).execution_stopped,true);
 const qs=f.activate('qualification');await processing.prepareActivity(qs,{directory:f.makeDirectory('review-claim'),assertAuthority:f.authority(),resources:async()=>true,refreshOwned:async()=>{throw Error("UNUSED_REVIEW_HOOK");},readbackAuthority:async()=>{throw Error("UNUSED_REVIEW_HOOK");}});await assert.rejects(processing.primitives(qs).queue('claim_videos'),/COMMIT_UNKNOWN/);
 assert.equal(lost,true);const inner=await processing.closeActivity(qs);assert.equal(inner.external_effect,'unknown');assert.equal(inner.execution_stopped,false);assert.equal(processing.snapshot().execution_unknown,true);assert.equal((await f.read()).find(v=>v.video_id===f.vid).process_status,'处理中:'+qs.run);
 const runtime=readFileSync(join(f.root,'native-phone-runtime.mjs'),'utf8'),start=runtime.indexOf('nativeState:()=>'),end=runtime.indexOf(',snapshot:',start),expression=runtime.slice(start+'nativeState:'.length,end);
 const projection=Function('entries','unsafe','judgeUnknown','processing','return ('+expression+')')([{scope:qs,processingStop:inner}],true,false,processing)();
 console.log(JSON.stringify({event:'independent-102-projection',inner,processing:processing.snapshot(),runtime:projection,limitation:'exact unchanged runtime state expression over real processing state; not a full public phone/model run'}));
 assert.equal(projection.execution_unknown,true);assert.equal(projection.native_stop_unproven,true);assert.equal(projection.external_effect,'unknown','outer state must preserve the real committed-but-unacknowledged effect');
}));
