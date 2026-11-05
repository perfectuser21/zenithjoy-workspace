import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startPrimaryActivityBroker} from '../activity-skill-primary-broker.mjs';

async function fixture(t,{raw=true,authorizeParentContext=async()=>false,inspect=async()=>({phone_capabilities:['account-current'],pending_write_readbacks:[]})}={}){
 const directory=mkdtempSync(join(tmpdir(),'parent-context-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const request={protocol:'leadgen-activity-v1',mode:'execute',...(raw?{execution_transport:'raw-model-v1'}:{}),run_id:'context-fixture',task_id:'11111111-1111-4111-8111-111111111111',binding_id:'22222222-2222-4222-8222-222222222222',activity_key:'preflight',nonce:'a'.repeat(48),source_commit:'b'.repeat(40),runtime_snapshot_sha256:'c'.repeat(64),deadline_ms:Date.now()+10000};
 const effects=[];
 const broker=await startPrimaryActivityBroker({directory,request,inspect,phone:async()=>effects.push('phone'),business:async()=>effects.push('business'),authorize:async()=>false,authorizeParentContext,onEvent:async()=>({action:'steer',text:'Keep the original account rule.'})});
 t.after(()=>broker.close());return {request,broker,effects};
}

test('Code parent context is separately authorized and returns original Commander guidance without a business intent',async t=>{
 let authorizations=0;
 const {broker,request,effects}=await fixture(t,{authorizeParentContext:async q=>{assert.equal(q.nonce,'a'.repeat(48));assert.equal(q.binding_id,'22222222-2222-4222-8222-222222222222');authorizations++;return true;}});
 assert.equal(typeof broker.readParentContext,'function','raw parent context needs an independent Code-only capability');
 await broker.report({type:'progress',text:'Context only.'});
 const context=await broker.readParentContext();
 assert.deepEqual(context.commander_guidance,['Keep the original account rule.']);assert.equal(authorizations,2);
 assert.deepEqual(effects,[]);assert.equal(broker.getResult().pending,0);assert.equal(request.execution_transport,'raw-model-v1');
});

test('old child and missing Code authority cannot use the raw parent context capability',async t=>{
 const old=await fixture(t,{raw:false,authorizeParentContext:async()=>true});
 assert.equal(typeof old.broker.readParentContext,'function');
 await assert.rejects(old.broker.readParentContext(),/SKILL_PRIMARY_PARENT_CONTEXT_UNSUPPORTED/);
 let inspections=0;
 const raw=await fixture(t,{inspect:async()=>{inspections++;return {};}});
 await assert.rejects(raw.broker.readParentContext(),/SKILL_PRIMARY_PARENT_CONTEXT_UNAUTHORIZED/);
 assert.equal(inspections,0);assert.deepEqual(raw.effects,[]);
});

test('Code authority lost during a context read cannot deliver the stale context',async t=>{
 let epoch=1;
 const {broker,effects}=await fixture(t,{authorizeParentContext:async()=>epoch===1,inspect:async()=>{epoch=2;return {account:'stale'};}});
 await assert.rejects(broker.readParentContext(),/SKILL_PRIMARY_PARENT_CONTEXT_UNAUTHORIZED/);
 assert.deepEqual(effects,[]);assert.equal(broker.getResult().pending,0);
});

test('seal while context I/O is outstanding preserves uncertainty and refuses the late context',async t=>{
 let release,entered;
 const started=new Promise(resolve=>{entered=resolve;});
 const {broker,effects}=await fixture(t,{authorizeParentContext:async()=>true,inspect:async()=>{entered();return new Promise(resolve=>{release=resolve;});}});
 const pending=broker.readParentContext();await started;
 const sealed=broker.seal();assert.equal(sealed.pending,1);assert.equal(sealed.execution_unknown,true);
 release({account:'late'});await assert.rejects(pending,/SKILL_PRIMARY_SEALED/);
 await assert.rejects(broker.readParentContext(),/SKILL_PRIMARY_SEALED/);
 assert.deepEqual(effects,[]);assert.equal(broker.getResult().execution_unknown,true);
});
