import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {foundationFixture} from './helpers/leadgen-foundation-fixture.mjs';
import {prepareLeadgenHost,createRuntime} from '../leadgen-foundation/adapter.mjs';
for(const workflow of ['101','102','103','104'])test(`foundation ${workflow} real source assembly is isolated, reusable and effect free`,async()=>{
 const f=await foundationFixture(workflow);try{
  const before=Date.now(),a=await prepareLeadgenHost(f);assert.equal(a.receipt.status,'assembled_not_started');
  assert.ok(a.receipt.assembled_at_ms>=before);assert.equal(a.context.run_start_ts,undefined);assert.equal(a.context.tasks[workflow].run_tag,f.run.run_id);
  assert.equal(a.context.actor,'foundation:fixture-machine');assert.equal(a.context.root_task_id,f.run.task_id);
  const sourceTools=fs.readFileSync(path.join(a.profile.cwd,'TOOLS.txt'),'utf8');
  assert.doesNotMatch(sourceTools,/顶层 `outputs`/);
  const tools=fs.readFileSync(path.join(a.profile.cwd,a.profile.skill_runtime.tools),'utf8');
  assert.ok(tools.startsWith(sourceTools));
  assert.equal(a.receipt.files[a.profile.skill_runtime.tools],createHash('sha256').update(tools).digest('hex'));
  assert.match(tools,/顶层 `outputs`/);
  assert.match(tools,/`outputs` 的键是合同声明的对象类型/);
  assert.match(tools,/按工具实际回执填写 `evidence`/);
  for(const runtime of Object.values(a.profile.skill_runtime.activities)){
   assert.match(runtime.checker.evidence.provider.description,/先读 proposal.evidence/);
   assert.match(runtime.checker.evidence.provider.description,/只核对本轮实际适用的失败和幂等条件/);
  }
  const binding=JSON.parse(fs.readFileSync(path.join(a.profile.cwd,'checker-input/identity.json'),'utf8'));
  assert.deepEqual(binding.binding,a.receipt.identity);
  assert.equal(binding.business_deadline_ms,f.run.deadline_ms);
  assert.equal(binding.cleanup_deadline_ms,f.run.cleanup_deadline_ms);
  assert.equal(binding.expected_sender_id,a.context.sender_id??a.context.account);
  assert.equal(binding.binding_key,f.run.input.binding_key);
  assert.equal(binding.credentials,undefined);
  if(workflow==='104'){
   assert.equal(binding.approved_send.asset_sha256,a.context.authorization_asset.sha256);
   assert.equal(binding.approved_send.root_task_id,f.run.task_id);
   assert.equal(binding.approved_send.max_send_attempts,1);
   assert.equal(binding.approved_send.message,undefined);
   assert.equal(binding.approved_send.path,undefined);
  }
  assert.deepEqual(fs.readdirSync(path.join(a.profile.cwd,'receipts')),['.keep']);assert.deepEqual(fs.readdirSync(path.join(a.profile.cwd,'outreach-receipts')),['.keep']);
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
test('102 execution readback and Checker use the same raw fact implementation, with no specialized verdict',async()=>{
 const f=await foundationFixture('102');try{const a=await prepareLeadgenHost(f);
  assert.equal(fs.existsSync(path.join(a.profile.cwd,'production-readback-local.mjs')),false);assert.equal(fs.existsSync(path.join(a.profile.cwd,'checker.mjs')),false);
  for(const name of ['collection-readback.mjs','checker-facts-entry.mjs'])assert.match(fs.readFileSync(path.join(a.profile.cwd,name),'utf8'),/checker-facts.mjs/);
  assert.match(fs.readFileSync(path.join(a.profile.cwd,'collection-readback.mjs'),'utf8'),/relation.*comments/);
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
   assert.deepEqual(fs.readdirSync(path.join(runtime.profile.cwd,'outreach-receipts')),['.keep']);assert.equal(runtime.profile.skill_runtime.host_tools.kinds.includes('issue_authorization'),false);
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

test('generated provider binds frozen context and scorer imports actual new modules outside repository cwd',async()=>{
 const f=await foundationFixture('103');try{
  const a=await prepareLeadgenHost(f),root=a.profile.cwd;
  assert.ok(a.receipt.files['checker-facts-entry.mjs']);assert.ok(a.receipt.files['business-runtime/leadgen-score-context.js']);
  const spec=a.profile.skill_runtime.activities.scoring.checker;assert.equal(spec.mode,'agent');assert.equal(spec.evidence.provider.entry,'checker-facts-entry.mjs');assert.equal(spec.evidence.provider.command,process.execPath);
  const hostile={identity:f.run,nonce:'hostile',context:{...a.context,credentials:{database:'/foreign'}},operation:'pg.rows',args:{relation:'comments'}};
  const result=spawnSync(process.execPath,[path.join(root,spec.evidence.provider.entry)],{cwd:f.root,env:{PATH:process.env.PATH,NODE_PATH:''},input:JSON.stringify(hostile),encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).reason,'FACT_SCOPE_REJECTED');
  const src="import {createRequire} from 'node:module';const r=createRequire("+JSON.stringify(path.join(root,'business-runtime/package.json'))+");const m=r('./leadgen-score-context.js');const t=await m.readScoreTranscript({query:async()=>({rows:[{video_url:'v',title:'t',transcript:'actual text'}]})},'line',{source_video_url:'v',source_video:'t'},[]);if(t!=='actual text')throw Error('TRANSCRIPT');const {loadActivityHostPg}=await import("+JSON.stringify('file://'+path.join(root,'activity-host-pg.mjs'))+");const fs=await import('node:fs');const c=JSON.parse(fs.readFileSync("+JSON.stringify(path.join(root,'context.json'))+"));if(typeof (await loadActivityHostPg(c)).Pool!=='function')throw Error('PG');console.log('loaded');";
  const probe=spawnSync(process.execPath,['--input-type=module','-e',src],{cwd:f.root,env:{PATH:process.env.PATH,NODE_PATH:''},encoding:'utf8'});assert.equal(probe.status,0,probe.stderr);assert.equal(probe.stdout.trim(),'loaded');
 }finally{f.close();}
});
