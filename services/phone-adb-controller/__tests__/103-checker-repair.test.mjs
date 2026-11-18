import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const modulePath=process.env.ACTIVITY103_CHECKER_REPAIR||new URL('../activity-103-checker-repair.mjs',import.meta.url);
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
test('new manifest config enables only one mark repair without changing acceptance or scoring',async()=>{
 const {configure103CheckerRepair}=await import(modulePath);
 const contract={workflow:'douyin-leadgen-103',activities:[{key:'scoring',runtime:{executor_kind:'agent'},acceptance:{required:['score']}},{key:'mark_leads',runtime:{executor_kind:'agent'},acceptance:{required:['lead','delivery']}}]};
 const before=structuredClone(contract),after=configure103CheckerRepair(contract);assert.deepEqual(contract,before);
 assert.deepEqual(after.activities[0],before.activities[0]);assert.deepEqual(after.activities[1].acceptance,before.activities[1].acceptance);
 assert.deepEqual(after.activities[1].runtime.checker_repair,{max_attempts:2,retry_safe:true});
 after.activities[1].runtime.checker_repair.max_attempts=3;assert.throws(()=>configure103CheckerRepair(after));
});
function fixture(){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'103-repair-')));
 const identity={task_id:'task-103',run_id:'run-103',run_tag:'score-run',workflow:'103',activity:'mark_leads',attempt:1};
 const action_id='a'.repeat(64),scope=['comment-1'];
 const request={...identity,nonce:'checker-nonce',phase:'end',checks:['existing_score_readback','lead_identity_and_scope','persisted_leads','delivery_readback'],context:{action_id,verification:{'103':{comment_ids:scope}}}};
 const checks=[
  {id:'existing_score_readback',status:'passed',evidence:[{source:'postgres:score',observation:{stored:[{id:scope[0],status:'pass'}]}}]},
  {id:'lead_identity_and_scope',status:'failed',evidence:[{source:'postgres:leads',observation:{comment_ids:scope,lead_ids:[]}}]},
  {id:'persisted_leads',status:'failed',evidence:[{source:'postgres:outbox',observation:{lead_ids:[],outbox_ids:[]}}]},
  {id:'delivery_readback',status:'unknown',evidence:[{source:'production-readback',observation:{reason:'not_yet_verified'}}]},
 ];
 const observed={identity,nonce:request.nonce,outcome:'blocked',checks,output:{comment_ids:scope,outbox_states:[]}};
 const binding={task_id:identity.task_id,run_id:identity.run_id,activity_key:identity.activity,action_id,definition_sha256:'b'.repeat(64),input_sha256:'c'.repeat(64)};
 const manifest={protocol:'activity-supervisor/v1',binding,nonce:'supervisor-nonce',deadline:9999999999999};
 const transport={stdout:'{}',stderr:'',exit_code:0,exit_signal:null,reason_code:null,started_at_ms:1000,ended_at_ms:2000};
 const result={protocol:'activity-supervisor-result/v1',binding,nonce:manifest.nonce,deadline:manifest.deadline,transport,transport_sha256:digest(transport)};
 const receipt={binding:{kind:'business',activity:'mark_leads',identity:{task_id:identity.task_id,run_id:identity.run_id,run_tag:identity.run_tag},args:['{"op":"company_config"}']},state:'terminal',started_at:1.1,ended_at:1.2,result:{exit_code:2,error:'BUSINESS_ACTIVITY_SCOPE',data:{phase:'pre_dispatch',activity:'mark_leads',dispatched:false,external_effect:'none',allowed_operations:['policy_review','score_readback','mark_leads','mark_readback','bridge_outreach','bridge_readback']}}};
 const action=join(root,'control',identity.run_id,'actions',action_id);mkdirSync(action,{recursive:true,mode:0o700});mkdirSync(join(root,'receipts'),{mode:0o700});
 const save=(file,value)=>writeFileSync(file,JSON.stringify(value),{mode:0o600});
 const persist=()=>{save(join(action,'manifest.json'),manifest);result.transport_sha256=digest(result.transport);save(join(action,'result.json'),result);save(join(root,'receipts/rejected.json'),receipt);};persist();
 return {root,request,observed,receipt,result,manifest,persist,save,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('confirmed local rejection and independently absent output become actionable failed checks',async()=>{
 const f=fixture();try{const {repair103Readback}=await import(modulePath);const r=await repair103Readback(f.request,f.observed,{root:f.root});
 assert.equal(r.outcome,'failed');assert.equal(r.retryable,true);assert.equal(r.external_effect,'none');
 assert.equal(r.checks.find(x=>x.id==='existing_score_readback').status,'passed');
 for(const c of r.checks.filter(x=>x.status==='failed')){assert.ok(c.reason);assert.ok(Object.hasOwn(c,'expected'));assert.ok(Object.hasOwn(c,'actual'));}
 assert.equal(r.checks.find(x=>x.id==='delivery_readback').actual,'not_created');assert.equal(f.observed.outcome,'blocked');
 }finally{f.cleanup();}
});
for(const configured of [true,false])test(`scratch evidence requires frozen sandbox identity (${configured})`,async()=>{
 const f=fixture();try{
  f.observed.checks[3].evidence[0].source='scratch:delivery-disabled';
  if(configured)Object.assign(f.request.context,{sandbox:true,sandbox_database:'cecelia_scratch'});
  const {repair103Readback}=await import(modulePath);
  const r=await repair103Readback(f.request,f.observed,{root:f.root,readbackSource:'scratch:delivery-disabled'});
  assert.equal(r.outcome,configured?'failed':'blocked');
 }finally{f.cleanup();}
});
for(const mode of ['missing_receipts','unknown','wrong_identity','after_dispatch','unlisted_read','missing_stop','bad_stop_hash','stop_unknown','network_unknown','has_outbox','wrong_scope','score_unknown','scoring_phase','malformed'])test(`repair remains blocked for ${mode}`,async()=>{
 const f=fixture();try{
  if(mode==='unknown')f.receipt.state='unknown';
  if(mode==='wrong_identity')f.receipt.binding.identity.run_id='foreign';
  if(mode==='after_dispatch'){f.receipt.result={exit_code:0};f.receipt.binding.args=['{"op":"mark_leads"}'];}
  if(mode==='unlisted_read'){f.receipt.result={exit_code:0};f.receipt.binding.args=['{"op":"company_config"}'];}
  if(mode==='stop_unknown')f.result.transport.exit_code=null;
  if(mode==='network_unknown')f.observed.checks[3].evidence[0].observation.reason='READBACK_UNAVAILABLE';
  if(mode==='has_outbox')f.observed.checks[2].evidence[0].observation.outbox_ids=['one'];
  if(mode==='wrong_scope')f.observed.checks[1].evidence[0].observation.comment_ids=['other'];
  if(mode==='score_unknown')f.observed.checks[0].status='unknown';
  if(mode==='scoring_phase')f.request.activity='scoring';
  f.persist();
  if(mode==='missing_receipts')rmSync(join(f.root,'receipts/rejected.json'));
  if(mode==='missing_stop')rmSync(join(f.root,'control/run-103/actions',f.request.context.action_id,'result.json'));
  if(mode==='bad_stop_hash'){f.result.transport_sha256='0'.repeat(64);f.save(join(f.root,'control/run-103/actions',f.request.context.action_id,'result.json'),f.result);}
  if(mode==='malformed')writeFileSync(join(f.root,'receipts/rejected.json'),'{');
  const {repair103Readback}=await import(modulePath);assert.deepEqual(await repair103Readback(f.request,f.observed,{root:f.root}),f.observed);
 }finally{f.cleanup();}
});
