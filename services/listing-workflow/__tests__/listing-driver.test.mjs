import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const moduleUrl = new URL('../listing-driver.mjs', import.meta.url);
async function driver() { try { return await import(moduleUrl); } catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; } }
function fixture() {
 const root = mkdtempSync(join(tmpdir(), 'listing-driver-'));
 const image = join(root,'book.jpg'); writeFileSync(image, 'approved-image');
 const imageHash = createHash('sha256').update('approved-image').digest('hex');
 const input = { root, businessKey:'book-edition-one', runId:'run-1', target:{storeId:'store-one',sourceProductKey:'isbn-one'}, payload:{plan:{title:'全7册图书悦升',images:[{path:image,sha256:imageHash}]}} };
 const actions=[{id:'title',operation:'setField',field:'title',page:'form',anchor:'title-field'},{id:'cover',operation:'upload',imageIndex:0,page:'form',anchor:'cover-slot'},{id:'publish',operation:'publish',page:'review',anchor:'publish-button'}];
 const effects=[];
 const runtime={contract:{version:1,actions},productionEnabled:false,
  authorize:async()=>({ok:true,evidence:['independent-store-supply-plan-review']}),
  inspect:async()=>({ok:true,storeId:'store-one',evidence:['current-screen-and-anchor']}),
  act:async action=>{effects.push(action.operation);return {ok:true,evidence:['action-readback'],...(action.operation==='publish'?{productId:'new-platform-id'}:{})};},
  lookup:async intent=>({state:'unknown',evidence:['not-yet-visible']})};
 return {input,runtime,effects};
}

test('default dry-run materializes field and image operations but performs no UI writes or publication',async()=>{
 const {runListing}=await driver(); assert.equal(typeof runListing,'function','executable driver is missing');
 const {input,runtime,effects}=fixture();const r=await runListing(input,runtime);
 assert.equal(r.mode,'dry-run');assert.equal(r.publicationAuthorized,false);assert.deepEqual(effects,[]);
 assert.deepEqual(r.wouldActions.map(x=>x.operation),['setField','upload','publish']);assert.equal(r.wouldActions[0].value,'全7册图书悦升');
});
test('live mode remains closed even when the request claims all facts and authorization',async()=>{
 const {runListing}=await driver(); assert.equal(typeof runListing,'function');const {input,runtime,effects}=fixture();
 const r=await runListing({...input,mode:'live',productionEnabled:true},runtime);assert.equal(r.status,'blocked');assert.ok(r.reasons.includes('PRODUCTION_GATE_CLOSED'));assert.deepEqual(effects,[]);
});
test('missing real form contract and changed source bytes fail before any UI action',async()=>{
 const {runListing}=await driver(); assert.equal(typeof runListing,'function');const {input,runtime,effects}=fixture();
 const missing=await runListing(input,{...runtime,contract:null});assert.ok(missing.reasons.includes('UI_CONTRACT_UNVERIFIED'));
 writeFileSync(input.payload.plan.images[0].path,'replaced');const changed=await runListing(input,runtime);assert.ok(changed.reasons.includes('MEDIA_HASH_MISMATCH'));assert.deepEqual(effects,[]);
});
test('an injected trusted transport executes preparation and one submission; retry only reads back',async()=>{
 const {runListing}=await driver(); assert.equal(typeof runListing,'function');const {input,runtime,effects}=fixture();runtime.productionEnabled=true;
 const r=await runListing({...input,mode:'live'},runtime);assert.equal(r.status,'submitted');assert.deepEqual(effects,['setField','upload','publish']);
 const again=await runListing({...input,mode:'live',runId:'restart'},runtime);assert.equal(again.status,'submitted');assert.deepEqual(effects,['setField','upload','publish']);
});
test('ambiguous current page stops preparation and durable unknown forbids automatic resume',async()=>{
 const {runListing}=await driver(); assert.equal(typeof runListing,'function');const {input,runtime,effects}=fixture();runtime.productionEnabled=true;
 let checks=0;runtime.inspect=async()=>({ok:++checks<4,storeId:'store-one',evidence:['screen']});
 const r=await runListing({...input,mode:'live'},runtime);assert.equal(r.status,'unknown');assert.deepEqual(effects,['setField']);
 await runListing({...input,mode:'live',runId:'restart'},runtime);assert.deepEqual(effects,['setField']);
});
test('external messaging operations cannot enter dry-run or live action plans',async()=>{
 const {runListing}=await driver(); assert.equal(typeof runListing,'function');const {input,runtime,effects}=fixture();runtime.contract.actions[0].operation='sendMessage';
 const r=await runListing(input,runtime);assert.equal(r.status,'blocked');assert.ok(r.reasons.includes('FORBIDDEN_ACTION'));assert.deepEqual(effects,[]);
});

test('dry-run always releases probe resources including a failed read and wrong store',async()=>{
 const {runListing}=await driver();const {input,runtime}=fixture();let cleaned=0;runtime.cleanup=async()=>{cleaned++;};
 runtime.inspect=async()=>({ok:true,storeId:'another-store',evidence:['screen']});
 const wrong=await runListing(input,runtime);assert.equal(wrong.status,'blocked');assert.ok(wrong.reasons.includes('CURRENT_CONTEXT_UNVERIFIED'));assert.equal(cleaned,1);
 runtime.inspect=async()=>{throw new Error('probe-lost');};await runListing(input,runtime);assert.equal(cleaned,2);
});
test('a lost submit reply does not cause repeated external submission after a process retry',async()=>{
 const {runListing}=await driver();const {input,runtime,effects}=fixture();runtime.productionEnabled=true;
 runtime.act=async action=>{effects.push(action.operation);if(action.operation==='publish')throw new Error('network-lost-after-effect');return {ok:true,evidence:['checked']};};
 const r=await runListing({...input,mode:'live'},runtime);assert.equal(r.status,'unknown');
 await runListing({...input,mode:'live',runId:'retry'},runtime);assert.equal(effects.filter(x=>x==='publish').length,1);
});
test('dry-run rejects duplicate images and any attempt to schedule upload after final submit',async()=>{
 const {runListing}=await driver();const {input,runtime}=fixture();
 runtime.contract.actions.splice(2,0,{...runtime.contract.actions[1],id:'duplicate-cover'});
 const r=await runListing(input,runtime);assert.equal(r.status,'blocked');assert.ok(r.reasons.includes('IMAGE_ORDER_UNVERIFIED'));
});

test('missing form anchors still permit guarded read-only observation but cannot yield an executable plan',async()=>{
 const {runListing}=await driver();const {input,runtime,effects}=fixture();let reads=0;runtime.contract=null;runtime.inspect=async()=>{reads++;return {ok:false,evidence:['raw-capture'],requiresVisualReview:true};};
 const r=await runListing(input,runtime);assert.equal(reads,1);assert.equal(r.status,'blocked');assert.deepEqual(effects,[]);
});
