import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {foundationFixture} from './helpers/leadgen-foundation-fixture.mjs';
import {prepareLeadgenHost,createRuntime} from '../leadgen-foundation/adapter.mjs';
for(const workflow of ['101','102','103','104'])test(`foundation ${workflow} real source assembly is isolated, reusable and effect free`,async()=>{
 const f=await foundationFixture(workflow);try{
  const before=Date.now(),a=await prepareLeadgenHost(f);assert.equal(a.receipt.status,'assembled_not_started');
  assert.ok(a.receipt.assembled_at_ms>=before);assert.equal(a.context.run_start_ts,undefined);assert.equal(a.context.tasks[workflow].run_tag,f.run.run_id);
  assert.equal(a.context.actor,'foundation:fixture-machine');assert.equal(a.context.root_task_id,f.run.task_id);
  assert.equal(fs.existsSync(path.join(a.profile.cwd,'receipts')),false);assert.equal(fs.existsSync(path.join(a.profile.cwd,'outreach-receipts')),false);
  const contextFile=path.join(a.profile.cwd,'context.json'),bytes=fs.readFileSync(contextFile),mtime=fs.statSync(contextFile).mtimeMs;
  const {canonical}=await import('../leadgen-foundation/context.mjs');f.run.input=JSON.parse(canonical(f.run.input));
  const b=await prepareLeadgenHost(f);assert.equal(b.receipt.recovered,true);assert.equal(b.receipt.assembled_at_ms,a.receipt.assembled_at_ms);assert.equal(fs.statSync(contextFile).mtimeMs,mtime);assert.deepEqual(fs.readFileSync(contextFile),bytes);
  const proof=JSON.parse(fs.readFileSync(a.context.verification.proof_manifest_path));assert.deepEqual(proof.fields,{});assert.equal(proof.identity.run_id,f.run.run_id);
  if(workflow==='104'){
   const exact=JSON.parse(fs.readFileSync(path.join(a.profile.cwd,'outreach-scope.json')));
   assert.deepEqual(Object.keys(exact).sort(),['record_id','comment_id','company_id','source_run','mark_run','target_douyin_id','line_key'].sort());
   assert.equal(exact.record_id,f.run.input.business.scope.record_id);assert.equal(exact.source_run,f.run.input.business.scope.source_102_run);
   assert.match(fs.readFileSync(path.join(a.profile.cwd,'invoke.mjs'),'utf8'),/LEADGEN_OUTREACH_MODE/);
   assert.ok(a.profile.skill_runtime.codex.env_keys.includes('LEADGEN_OUTREACH_SCOPE_FILE'));
  }
  await a.verifySource();
  for(const name of Object.keys(a.receipt.files).filter(n=>n.endsWith('.mjs')&&!n.startsWith('asr-runtime/'))){const r=spawnSync(process.execPath,['--check',path.join(a.profile.cwd,name)],{encoding:'utf8'});assert.equal(r.status,0,name+': '+r.stderr);}
  const python=spawnSync('python3',['-c',"import pathlib,sys; [compile(p.read_text(),str(p),'exec') for p in pathlib.Path(sys.argv[1]).rglob('*.py')]",a.profile.cwd],{encoding:'utf8'});assert.equal(python.status,0,python.stderr);
  fs.appendFileSync(contextFile,' ');await assert.rejects(a.verifySource(),/LEADGEN_RECOVERY_SOURCE/);
 }finally{f.close();}
});
test('foundation recovery rejects coordinated source and self-reported receipt hash tampering',async()=>{
 const f=await foundationFixture();try{
  const first=await prepareLeadgenHost(f),file=path.join(first.profile.cwd,'tools.py'),receiptFile=path.join(first.profile.cwd,'leadgen-host-receipt.json');
  fs.appendFileSync(file,'\n# foreign replacement\n');const receipt=JSON.parse(fs.readFileSync(receiptFile));receipt.files['tools.py']=createHash('sha256').update(fs.readFileSync(file)).digest('hex');fs.writeFileSync(receiptFile,JSON.stringify(receipt));
  await assert.rejects(prepareLeadgenHost(f),/LEADGEN_RECOVERY_SOURCE/);assert.match(fs.readFileSync(file,'utf8'),/foreign replacement/);
 }finally{f.close();}
});
test('foundation recovery never recreates missing mutable proof evidence',async()=>{
 const f=await foundationFixture();try{
  const first=await prepareLeadgenHost(f),proof=first.context.verification.proof_manifest_path;fs.unlinkSync(proof);
  await assert.rejects(prepareLeadgenHost(f),/LEADGEN_PROOF_MISSING/);assert.equal(fs.existsSync(proof),false);
 }finally{f.close();}
});
test('104 actual Codex child receives frozen exact scope without changing parent environment',async()=>{
 const f=await foundationFixture('104');try{
  const binary=path.join(f.root,'codex-probe');fs.writeFileSync(binary,'#!/bin/sh\nprintf \'%s\\n\' "$LEADGEN_OUTREACH_MODE" "$LEADGEN_OUTREACH_SCOPE_FILE" "$1"\n',{mode:0o700});
  f.profile.skill_runtime.codex={command:binary,command_sha256:createHash('sha256').update(fs.readFileSync(binary)).digest('hex')};
  const before=process.env.LEADGEN_OUTREACH_MODE,a=await prepareLeadgenHost(f),probe=spawnSync(a.profile.skill_runtime.codex.command,['probe'],{encoding:'utf8',env:{PATH:process.env.PATH,LEADGEN_OUTREACH_MODE:'company_queue'}});
  assert.equal(probe.status,0,probe.stderr);assert.deepEqual(probe.stdout.trim().split('\n'),['exact',path.join(a.profile.cwd,'outreach-scope.json'),'probe']);assert.equal(process.env.LEADGEN_OUTREACH_MODE,before);
  fs.appendFileSync(binary,'\n# changed\n');const drift=spawnSync(a.profile.skill_runtime.codex.command,[],{encoding:'utf8'});assert.notEqual(drift.status,0);assert.match(drift.stderr,/LEADGEN_CODEX_SOURCE/);
 }finally{f.close();}
});
test('102 emitted checker and collection wrapper import the same admitted producer-aware reader',async()=>{
 const f=await foundationFixture('102');try{
  const a=await prepareLeadgenHost(f),reader=fs.readFileSync(path.join(a.profile.cwd,'production-readback-local.mjs'),'utf8');assert.match(reader,/resolveProducerIdentity/);
  const probe=path.join(f.root,'reader-probe');fs.cpSync(a.profile.cwd,probe,{recursive:true});
  fs.writeFileSync(path.join(probe,'production-readback-local.mjs'),"export async function main(request){return {reader:'same-local-production',activity:request.activity,run_id:request.run_id};}\n");
  for(const [file,request]of [['collection-readback.mjs',a.context],['checker.mjs',{phase:'end',workflow:'102',activity:'collection',run_id:f.run.run_id,context:a.context}]]){
   const result=spawnSync(process.execPath,[path.join(probe,file)],{encoding:'utf8',input:JSON.stringify(request),cwd:probe});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{reader:'same-local-production',activity:'collection',run_id:f.run.run_id});
  }
  assert.equal(fs.existsSync(path.join(a.profile.cwd,'skills/douyin-leadgen-commander/scripts/production_readback.mjs')),false);
 }finally{f.close();}
});
test('102 emitted upstream scope carries controlled producer run identity for the actual reader',async()=>{
 const f=await foundationFixture('102');try{
  const a=await prepareLeadgenHost(f),c=JSON.parse(fs.readFileSync(path.join(a.profile.cwd,'context.json'))),video=c.verification['102'].video_ids[0];
  const {resolveProducerIdentity}=await import('../activity-upstream-source.mjs');
  assert.deepEqual(resolveProducerIdentity(c,'dedup',c.verification['102'].upstream[video]),{source_commit:'b'.repeat(40),profile:'different-producer-phone'});
 }finally{f.close();}
});

function intentConfiguration(f){
 const hash=x=>createHash('sha256').update(x).digest('hex'),config=JSON.parse(fs.readFileSync(f.environment.LEADGEN_HOST_CONFIG)),b=config.bindings.customer,c=b.context;
 const original=JSON.parse(fs.readFileSync(c.authorization_asset.path)),state=path.join(f.root,'persistent-authorization');fs.mkdirSync(state,{mode:0o700});delete c.authorization_asset;
 const scope={...Object.fromEntries(['company_id','tenant_id','line','account','host','profile','serial','adb_serial'].map(k=>[k,c[k]])),sender_id:c.account,policy_id:c.verification.policy_id,policy_version:c.verification.policy_version,scope:f.run.input.business.scope,message_sha256:original.message_sha256};
 const intent={schema:'leadgen-send-authorization-intent/v1',machine_id:config.machine_id,decision_id:original.decision_id,authorizing_root_task_id:'33333333-3333-4333-8333-333333333333',scope,message:original.message,message_sha256:original.message_sha256,max_new_recipients:1,max_send_attempts:1,test_execution_daily_cap:100,company_policy_changed:false,requires_current_pause_and_daily_count_readback:true};
 const file=path.join(f.root,'intent.json');fs.writeFileSync(file,JSON.stringify(intent),{mode:0o600});Object.assign(b,{authorization_intent:{path:file,sha256:hash(fs.readFileSync(file))},authorization_state_root:state,authorization_message_sha256:original.message_sha256});
 const save=()=>{fs.writeFileSync(f.environment.LEADGEN_HOST_CONFIG,JSON.stringify(config));f.environment.LEADGEN_HOST_CONFIG_SHA256=hash(fs.readFileSync(f.environment.LEADGEN_HOST_CONFIG));};save();return {config,b,state,save};
}
test('104 runtime binds intent before a simulated task-create response and validates the original exact authorization',async()=>{
 const f=await foundationFixture('104');try{
  const setup=intentConfiguration(f),events=[];
  const kernel=path.join(f.profile.runtimeRoot,'scripts/commander-workflow');fs.mkdirSync(kernel,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(kernel,'skill-adapter.mjs'),'export async function createRuntime(options){return options;}');
  const createTask=async()=>{
   const {randomUUID}=await import('node:crypto');f.run.task_id=randomUUID();f.run.run_id=randomUUID();f.run.input.run_tag=f.run.run_id;events.push('task_created','worker_claimed');
   const runtime=await createRuntime(f);events.push('runtime_bound');
   const {validateAuthorization}=await import('../activity-104-context.mjs'),auth=validateAuthorization(runtime.run.input);assert.equal(auth.root_task_id,f.run.task_id);assert.equal(auth.max_send_attempts,1);
   assert.equal(fs.existsSync(path.join(runtime.profile.cwd,'outreach-receipts')),false);assert.equal(runtime.profile.skill_runtime.host_tools.kinds.includes('issue_authorization'),false);
   return runtime;
  };
  const runtime=await createTask();events.push('task_response');assert.deepEqual(events,['task_created','worker_claimed','runtime_bound','task_response']);
  const before=fs.readFileSync(runtime.run.input.authorization_asset.path),again=await createRuntime(f);assert.deepEqual(fs.readFileSync(again.run.input.authorization_asset.path),before);assert.equal(fs.readdirSync(setup.state).length,1);
 }finally{f.close();}
});
test('104 intent rejects a state directory beside the bundle inside the official run directory',async()=>{
 const f=await foundationFixture('104');try{
  const setup=intentConfiguration(f),runRoot=path.join(f.root,f.run.run_id),cwd=path.join(runRoot,'bundle');fs.mkdirSync(runRoot,{mode:0o700});fs.renameSync(f.profile.cwd,cwd);f.profile.cwd=cwd;
  const inside=path.join(runRoot,'authorizations');fs.mkdirSync(inside,{mode:0o700});setup.b.authorization_state_root=inside;setup.save();
  await assert.rejects(prepareLeadgenHost(f),/LEADGEN_AUTHORIZATION_STATE_ROOT/);assert.deepEqual(fs.readdirSync(inside),[]);
 }finally{f.close();}
});
test('foundation recovery survives the official host normalization of equivalent input object keys',async()=>{
 const f=await foundationFixture('102');try{
  const first=await prepareLeadgenHost(f),bytes=fs.readFileSync(path.join(first.profile.cwd,'context.json'));
  const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/foundation-normalized-input.json',import.meta.url)));assert.deepEqual(f.run.input,fixture.input);assert.match(fixture.source.sha256,/^[a-f0-9]{64}$/);f.run.input=fixture.normalized_input;
  const recovered=await prepareLeadgenHost(f);assert.equal(recovered.receipt.recovered,true);assert.deepEqual(fs.readFileSync(path.join(recovered.profile.cwd,'context.json')),bytes);
 }finally{f.close();}
});

test('independent failed checks survive the actual assembled checker without granting retry',async()=>{
 const f=await foundationFixture('102');try{
  const a=await prepareLeadgenHost(f),probe=path.join(f.root,'failed-checker-probe');fs.cpSync(a.profile.cwd,probe,{recursive:true});
  // Only the database/native readback is replaced; execute the real assembled checker entry.
  fs.writeFileSync(path.join(probe,'production-readback-local.mjs'),"import fs from 'node:fs';export async function main(){return JSON.parse(fs.readFileSync(new URL('./observed.json',import.meta.url)));}\n");
  const identity={task_id:f.run.task_id,run_id:f.run.run_id,run_tag:f.run.run_id,workflow:'102',activity:'dedup',attempt:1};
  const ids=['upstream_provenance','company_policy_scope','eligible_video_set','video_claim_ownership'];
  const request={...identity,phase:'end',nonce:'fixed-independent-nonce',checks:ids,context:a.context,proposal:{status:'needs_review'}};
  const observed={identity,nonce:request.nonce,outcome:'blocked',checks:ids.map((id,i)=>({id,status:i===3?'failed':'passed',evidence:[{source:'postgres:fixture/read-only',observation:i===3?{process_status:'待判定',claimed:false}:{verified:true}}]})),output:{model_call_count:0,read_only:true}};
  const run=(value,req=request)=>{fs.writeFileSync(path.join(probe,'observed.json'),JSON.stringify(value));const r=spawnSync(process.execPath,[path.join(probe,'checker.mjs')],{encoding:'utf8',input:JSON.stringify(req),cwd:probe});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
  const failed=run(observed);assert.equal(failed.outcome,'failed');assert.equal(failed.retryable,false);assert.equal(failed.external_effect,'unknown');
  assert.deepEqual(failed.identity,identity);assert.equal(failed.nonce,request.nonce);assert.deepEqual(failed.output,observed.output);
  assert.deepEqual(failed.checks.slice(0,3),observed.checks.slice(0,3));
  const check=failed.checks[3];assert.deepEqual(check.evidence,observed.checks[3].evidence);assert.deepEqual(check.expected,{status:'passed'});assert.deepEqual(check.actual,{status:'failed',evidence:observed.checks[3].evidence});assert.equal(check.reason,'independent_check_failed');
  for(const mutate of [v=>{v.checks[0].status='unknown';},v=>{v.checks[3].evidence=[];},v=>{v.checks.pop();},v=>{v.checks[3].id=v.checks[0].id;},v=>{v.nonce='wrong';},v=>{v.identity.run_id='different';},v=>{v.output.readback_error='READBACK_UNAVAILABLE';},v=>{v.output.read_only=false;}]){
   const value=structuredClone(observed);mutate(value);assert.deepEqual(run(value),value);
  }
  const stopped={...request,proposal:{execution_stopped:false}};assert.deepEqual(run(observed,stopped),observed);
  for(const outcome of ['passed','empty']){const value=structuredClone(observed);value.outcome=outcome;value.checks.forEach(c=>c.status='passed');assert.deepEqual(run(value),value);}
  await a.verifySource();assert.equal(fs.existsSync(path.join(a.profile.cwd,'receipts')),false);
 }finally{f.close();}
});
test('all four published profiles freeze the checker feedback implementation and assembly',()=>{
 for(const workflow of ['101','102','103','104']){
  const doc=JSON.parse(fs.readFileSync(new URL('../leadgen-foundation/profiles/'+workflow+'.json',import.meta.url)));
  for(const name of ['assembly.mjs','checker-feedback.mjs']){
   const file='services/phone-adb-controller/leadgen-foundation/'+name;
   assert.equal(doc.profile.files[file],createHash('sha256').update(fs.readFileSync(new URL('../leadgen-foundation/'+name,import.meta.url))).digest('hex'),workflow+': '+name);
  }
  for(const a of doc.contract.activities){assert.equal(a.runtime.checker_repair,undefined);assert.deepEqual(a.failure.retryable,[]);}
 }
});
