import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
const moduleURL=new URL('../leadgen-foundation/context.mjs',import.meta.url);
const hash=x=>createHash('sha256').update(x).digest('hex');
const task='11111111-1111-4111-8111-111111111111',runId='22222222-2222-4222-8222-222222222222';
function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'leadgen-foundation-')));
 const config={schema:'leadgen-host-config/v1',machine_id:'fixture-machine',bindings:{customer:{
  allowed_workflows:['101','102','103','104'],context:{company_id:'company',tenant_id:'tenant',line:'line',profile:'fixture-phone',account:'sender',
   verification:{policy_version:1,policy_id:'fixture-policy',runtime_sha256:{}},credentials:{database:'/private/db',brain:'/private/brain',feishu:'/private/feishu',provider_env_files:[]}}
 }}};
 const configFile=path.join(root,'host-config.json');fs.writeFileSync(configFile,JSON.stringify(config),{mode:0o600});
 const environment={LEADGEN_HOST_CONFIG:configFile,LEADGEN_HOST_CONFIG_SHA256:hash(fs.readFileSync(configFile)),LEADGEN_MACHINE_ID:'fixture-machine'};
 const run={task_id:task,run_id:runId,deadline_ms:123000,cleanup_deadline_ms:130000,input:{run_tag:runId,binding_key:'customer',business:{keyword:'工作流',search_filters:{sort:'general'},max_candidates:1}}};
 return {root,config,configFile,environment,run,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('foundation context derives fresh task/run authority and never shares identity between runs',async()=>{
 const {buildContext}=await import(moduleURL);const f=fixture();try{
  const a=buildContext({workflow:'101',run:f.run,environment:f.environment,hostRoot:path.join(f.root,'a')});
  const next=structuredClone(f.run);next.task_id='33333333-3333-4333-8333-333333333333';next.run_id='44444444-4444-4444-8444-444444444444';next.input.run_tag=next.run_id;
  const b=buildContext({workflow:'101',run:next,environment:f.environment,hostRoot:path.join(f.root,'b')});
  assert.deepEqual(a.context.tasks,{'101':{task_id:task,run_id:runId,run_tag:runId}});
  assert.equal(a.context.root_task_id,task);assert.equal(a.context.actor,'foundation:fixture-machine');
  assert.notEqual(a.context.local_owner,b.context.local_owner);assert.equal(b.context.central_owner,next.task_id);
  assert.equal(a.context.business_deadline_ms,f.run.deadline_ms);assert.equal(a.context.keyword,'工作流');
 }finally{f.close();}
});
for(const key of ['task_id','tasks','actor','root_task_id','runtime_root','credentials','source_commit','context'])test(`foundation rejects input authority override ${key}`,async()=>{
 const {buildContext}=await import(moduleURL);const f=fixture();try{
  f.run.input.business[key]='foreign';assert.throws(()=>buildContext({workflow:'101',run:f.run,environment:f.environment,hostRoot:path.join(f.root,'a')}),/LEADGEN_INPUT/);
 }finally{f.close();}
});
test('foundation rejects configuration drift, machine mismatch and arbitrary binding paths before effects',async()=>{
 const {buildContext}=await import(moduleURL);const f=fixture();try{
  const call=()=>buildContext({workflow:'101',run:f.run,environment:f.environment,hostRoot:path.join(f.root,'a')});
  f.run.input.binding_key='../other';assert.throws(call,/LEADGEN_BINDING/);f.run.input.binding_key='customer';
  f.environment.LEADGEN_MACHINE_ID='other';assert.throws(call,/LEADGEN_MACHINE/);f.environment.LEADGEN_MACHINE_ID='fixture-machine';
  fs.appendFileSync(f.configFile,' ');assert.throws(call,/LEADGEN_CONFIG_DIGEST/);
 }finally{f.close();}
});
test('foundation cannot reuse an authorization asset for a different 104 Task',async()=>{
 const {buildContext}=await import(moduleURL);const f=fixture();try{
  const file=path.join(f.root,'approval.json');fs.writeFileSync(file,JSON.stringify({schema:'run-send-authorization/v1',root_task_id:'foreign-task'}),{mode:0o600});
  f.config.bindings.customer.context.authorization_asset={path:file,sha256:hash(fs.readFileSync(file))};fs.writeFileSync(f.configFile,JSON.stringify(f.config));f.environment.LEADGEN_HOST_CONFIG_SHA256=hash(fs.readFileSync(f.configFile));
  f.run.input.business={scope:{record_id:'order'}};
  assert.throws(()=>buildContext({workflow:'104',run:f.run,environment:f.environment,hostRoot:path.join(f.root,'a')}),/LEADGEN_AUTHORIZATION_TASK/);
 }finally{f.close();}
});
test('foundation recovery preserves original source and rejects missing files or changed binding',async()=>{
 const {freezeHost}=await import(new URL('../leadgen-foundation/freeze.mjs',import.meta.url));const f=fixture();try{
  const directory=path.join(f.root,'host'),identity={task_id:task,run_id:runId,configuration_sha256:'a'.repeat(64),binding_sha256:'b'.repeat(64)};
  const first=freezeHost({directory,identity,files:{'context.json':'{"task":"first"}\n','worker.mjs':'export {};\n'}});
  const time=fs.statSync(path.join(directory,'context.json')).mtimeMs;
  assert.equal(freezeHost({directory,identity,files:{'context.json':'{"task":"first"}\n','worker.mjs':'export {};\n'}}).recovered,true);
  assert.equal(fs.statSync(path.join(directory,'context.json')).mtimeMs,time);assert.equal(first.recovered,false);
  assert.throws(()=>freezeHost({directory,identity:{...identity,binding_sha256:'c'.repeat(64)},files:{}}),/LEADGEN_RECOVERY_IDENTITY/);
  fs.unlinkSync(path.join(directory,'worker.mjs'));assert.throws(()=>freezeHost({directory,identity,files:{'worker.mjs':'replacement'}}),/LEADGEN_RECOVERY_SOURCE/);
  assert.equal(fs.readFileSync(path.join(directory,'context.json'),'utf8'),'{"task":"first"}\n');
 }finally{f.close();}
});
test('foundation cannot adopt a preexisting unreceipted directory or symlink source',async()=>{
 const {freezeHost}=await import(new URL('../leadgen-foundation/freeze.mjs',import.meta.url));const f=fixture();try{
  const directory=path.join(f.root,'host');fs.mkdirSync(directory,{mode:0o700});fs.writeFileSync(path.join(directory,'foreign'),'old');
  assert.throws(()=>freezeHost({directory,identity:{},files:{'worker.mjs':'new'}}),/LEADGEN_RECOVERY_RECEIPT/);
  assert.equal(fs.readFileSync(path.join(directory,'foreign'),'utf8'),'old');
 }finally{f.close();}
});
