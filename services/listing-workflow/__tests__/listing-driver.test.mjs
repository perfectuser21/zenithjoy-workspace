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
 const state={fields:{},images:[]};
 const runtime={contract:{version:1,actions},profile:{requiredPlanFields:['title'],requiredWriteFields:['title'],minImages:1},deviceBinding:{serial:'SERIAL1',package:'com.xunmeng.merchant'},productionEnabled:false,
  authorize:async()=>({ok:true,evidence:['independent-store-supply-plan-review']}),
  inspect:async action=>({ok:true,storeId:'store-one',serial:'SERIAL1',package:'com.xunmeng.merchant',leaseValid:true,uiApproved:true,unique:true,page:action.page,anchor:action.anchor,evidence:['current-screen-and-anchor']}),
  act:async action=>{effects.push(action.operation);if(action.operation==='setField')state.fields[action.field]=action.value;if(action.operation==='upload')state.images[action.imageIndex]=action.value.sha256;return {ok:true,evidence:['action-readback'],...(action.operation==='publish'?{productId:'new-platform-id'}:{})};},
  verifyAction:async action=>({ok:true,value:state.fields[action.field],sha256:state.images[action.imageIndex],evidence:['independent-field-readback']}),
  reviewPlan:async()=>({ok:true,storeId:'store-one',fields:{...state.fields},images:[...state.images],evidence:['full-form-review']}),
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
 let checks=0;const inspect=runtime.inspect;runtime.inspect=async action=>({...await inspect(action),ok:++checks<4});
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
 const act=runtime.act;runtime.act=async action=>{const r=await act(action);if(action.operation==='publish')throw new Error('network-lost-after-effect');return r;};
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

test('trusted business profile cannot be reduced to an empty image publish-only contract',async()=>{
 const {runListing}=await driver();const {input,runtime,effects}=fixture();runtime.productionEnabled=true;runtime.contract.actions=runtime.contract.actions.slice(-1);input.payload.plan.images=[];delete input.payload.plan.title;
 const r=await runListing({...input,mode:'live'},runtime);assert.equal(r.status,'blocked');assert.ok(r.reasons.includes('BUSINESS_PROFILE_INCOMPLETE'));assert.deepEqual(effects,[]);
});
test('wrong field readback or incomplete final form prevents final publication',async()=>{
 const {runListing}=await driver();const one=fixture();one.runtime.productionEnabled=true;one.runtime.verifyAction=async()=>({ok:true,value:'wrong-title',evidence:['actual-field']});
 const r=await runListing({...one.input,mode:'live'},one.runtime);assert.equal(r.status,'unknown');assert.deepEqual(one.effects,['setField']);
 const two=fixture();two.runtime.productionEnabled=true;two.runtime.reviewPlan=async()=>({ok:true,storeId:'store-one',fields:{title:'other'},images:[],evidence:['wrong-form']});
 const r2=await runListing({...two.input,mode:'live'},two.runtime);assert.equal(r2.status,'unknown');assert.deepEqual(two.effects,['setField','upload']);
});
