import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildContext,hash,canonical,need,readHostConfiguration} from './context.mjs';
import {verifyBoundContract} from './profile-contract.mjs';
import {freezeHost,recoverHost} from './freeze.mjs';
import {assembleSources,prepareProof,EXACT_ENV_KEYS} from './qualification-agent-assembly.mjs';
function verifyProfile(profile){
 need(path.isAbsolute(profile.cwd)&&fs.realpathSync(profile.cwd)===profile.cwd,'PROFILE_ROOT');
 for(const [name,digest]of Object.entries(profile.files)){
  const file=path.resolve(profile.cwd,name);need(file.startsWith(profile.cwd+path.sep)&&fs.realpathSync(file)===file&&hash(fs.readFileSync(file))===digest,'PROFILE_SOURCE');
 }
}
function verifyRuntime(c){
 for(const key of ['node','python','phone_controller','phone_registry','adb_host_config']){
  const file=c[key];need(typeof file==='string'&&path.isAbsolute(file)&&fs.realpathSync(file)===file&&/^[a-f0-9]{64}$/.test(c[key+'_sha256']??'')&&hash(fs.readFileSync(file))===c[key+'_sha256'],'RUNTIME_ASSET');
 }
 need(path.isAbsolute(c.runtime_root)&&fs.realpathSync(c.runtime_root)===c.runtime_root&&c.phone_controller.startsWith(c.runtime_root+path.sep),'RUNTIME_ROOT');
 for(const [name,digest]of Object.entries(c.verification.runtime_sha256)){
  const file=path.resolve(c.runtime_root,name);need(file.startsWith(c.runtime_root+path.sep)&&fs.realpathSync(file)===file&&hash(fs.readFileSync(file))===digest,'RUNTIME_SOURCE');
 }
}
export async function prepareLeadgenHost({profile,run,verifySource=async()=>{},environment=process.env}){
 await verifySource();verifyProfile(profile);verifyBoundContract(run.contract,profile);
 const workflow=profile.leadgen?.workflow;need(['101','102','103','104'].includes(workflow),'PROFILE_WORKFLOW');
 const state=path.join(profile.cwd,'.leadgen-run');
 if(!fs.existsSync(state))fs.mkdirSync(state,{mode:0o700});
 need(fs.realpathSync(state)===state&&!(fs.statSync(state).mode&0o022),'STATE_DIRECTORY');
 const hostRoot=path.join(state,'host'),built=buildContext({workflow,run,environment,hostRoot,runRoot:path.basename(path.dirname(profile.cwd))===run.run_id?path.dirname(profile.cwd):profile.cwd});
 const identity={task_id:run.task_id,run_id:run.run_id,workflow,configuration_sha256:built.configuration_sha256,binding_sha256:built.binding_sha256,
  input_sha256:built.input_sha256,profile_sha256:hash(canonical(profile.files))};
 let receipt,context=built.context,expectedFiles;verifyRuntime(context);
 const assembly={context,profile,contract:run.contract,input:run.input,hostRoot,identity,bindingKey:run.input.binding_key};
 if(fs.existsSync(hostRoot)){
  // Reconstruct only in a new temporary directory. Never trust an editable receipt
  // to nominate replacement source hashes or repair missing executed evidence.
  prepareProof(context);
  const files=await assembleSources({...assembly,initializeProof:false});expectedFiles=Object.fromEntries(Object.entries(files).map(([n,b])=>[n,hash(b)]));
  receipt=recoverHost({directory:hostRoot,identity,expectedFiles});
 }else{
  const files=await assembleSources(assembly);
  receipt=freezeHost({directory:hostRoot,identity,files,executableFiles:workflow==='104'?['codex-exact']:[]});expectedFiles=Object.fromEntries(Object.entries(files).map(([n,b])=>[n,hash(b)]));
 }
 if(workflow==='102'){
  // The emitted SDK must satisfy its original complete lock before a worker can act.
  // This signer only verifies/loads local utilities; it has no HTTP dispatch path.
  const {officialSign}=await import(pathToFileURL(path.join(hostRoot,'asr-runtime/asr-cos-http.mjs')));
  const signature=officialSign({SecretId:'offline-readiness',SecretKey:'offline-readiness',Method:'GET',Pathname:'/offline',KeyTime:'1700000000;1700000180'});
  need(new URLSearchParams(signature).get('q-sign-algorithm')==='sha1','ASR_OFFLINE_READINESS');
 }
 const verify=async()=>{
  await verifySource();verifyProfile(profile);
  need(readHostConfiguration(environment).configuration_sha256===identity.configuration_sha256,'RECOVERY_IDENTITY');
  recoverHost({directory:hostRoot,identity,expectedFiles});prepareProof(context);verifyRuntime(context);
 };
 const skill_runtime=structuredClone(profile.skill_runtime);
 skill_runtime.tools='agent-tools.txt';
 if(workflow==='104'){const command=path.join(hostRoot,'codex-exact');need(!!(fs.statSync(command).mode&0o100),'CODEX_EXECUTABLE');skill_runtime.codex={...skill_runtime.codex,env_keys:[...new Set([...(skill_runtime.codex?.env_keys??[]),...EXACT_ENV_KEYS])],command,command_sha256:hash(fs.readFileSync(command))};}
 skill_runtime.host_tools={...skill_runtime.host_tools,command:process.execPath,command_sha256:hash(fs.readFileSync(process.execPath)),entry:'invoke.mjs'};
 for(const spec of Object.values(skill_runtime.activities)){need(spec.checker?.mode==='agent','AGENT_CHECKER_REQUIRED');spec.checker.evidence.provider={...spec.checker.evidence.provider,command:process.execPath,command_sha256:hash(fs.readFileSync(process.execPath))};}
 if(workflow==='101'){
  const provider=skill_runtime.activities.collect_videos.checker.evidence.provider;
  provider.description+=' 采集开工时用 read_file 读取 checker-input/input.json。它是本轮冻结的派单原始业务输入及绑定业务线，请从 business 中核对关键词、筛选和数量上限。';
 }
 if(workflow==='102'){
  const collection=skill_runtime.activities.collection;
  if(collection.stop_checker){
   const stop=collection.stop_checker,node=fs.realpathSync(process.execPath),nodeDigest=hash(fs.readFileSync(node));
   const trustedCommand=stop.command==='@node'&&stop.command_sha256===undefined
    ||stop.command===node&&stop.command_sha256===nodeDigest;
   need(trustedCommand&&stop.entry==='collection-stop-entry.mjs'&&stop.timeout_ms===45000&&receipt.files[stop.entry],'COLLECTION_STOP_PROFILE');
   collection.stop_checker={...stop,command:node,command_sha256:nodeDigest};
  }
  const provider=skill_runtime.activities.dedup.checker.evidence.provider;
  provider.description+=' 判重请先用 read_file 读取 checker-input/upstream.json。handoff 是本次冻结的101原交付，我方当前持久记录另外用 pg.rows 获取。claim 是已冻结的本轮普通认领输入；开工时尚无真实认领回执。历史交付的原生XML包含页面作者和评论数，PG已采评论数是另一个字段。';
 }
 const generated={...profile,cwd:hostRoot,files:receipt.files,skill_runtime};
 return {profile:generated,context,receipt,verifySource:verify,run:{...run,input:{...context,run_tag:run.run_id}}};
}
export async function createRuntime(options){
 const prepared=await prepareLeadgenHost(options);
 const entry=path.join(options.profile.runtimeRoot,'scripts/commander-workflow/skill-adapter.mjs');
 const kernel=await import(pathToFileURL(entry));
 return kernel.createRuntime({...options,...prepared});
}
