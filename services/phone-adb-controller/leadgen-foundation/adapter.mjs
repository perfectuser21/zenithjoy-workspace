import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildContext,hash,canonical,need,readHostConfiguration} from './context.mjs';
import {freezeHost,recoverHost} from './freeze.mjs';
import {assembleSources,prepareProof,EXACT_ENV_KEYS} from './assembly.mjs';
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
 await verifySource();verifyProfile(profile);
 const workflow=profile.leadgen?.workflow;need(['101','102','103','104'].includes(workflow),'PROFILE_WORKFLOW');
 const state=path.join(profile.cwd,'.leadgen-run');
 if(!fs.existsSync(state))fs.mkdirSync(state,{mode:0o700});
 need(fs.realpathSync(state)===state&&!(fs.statSync(state).mode&0o022),'STATE_DIRECTORY');
 const hostRoot=path.join(state,'host'),built=buildContext({workflow,run,environment,hostRoot,runRoot:path.basename(path.dirname(profile.cwd))===run.run_id?path.dirname(profile.cwd):profile.cwd});
 const identity={task_id:run.task_id,run_id:run.run_id,workflow,configuration_sha256:built.configuration_sha256,binding_sha256:built.binding_sha256,
  input_sha256:built.input_sha256,profile_sha256:hash(canonical(profile.files))};
 let receipt,context=built.context,expectedFiles;verifyRuntime(context);
 if(fs.existsSync(hostRoot)){
  // Reconstruct only in a new temporary directory. Never trust an editable receipt
  // to nominate replacement source hashes or repair missing executed evidence.
  prepareProof(context);
  const files=await assembleSources({context,profile,hostRoot,initializeProof:false});expectedFiles=Object.fromEntries(Object.entries(files).map(([n,b])=>[n,hash(b)]));
  receipt=recoverHost({directory:hostRoot,identity,expectedFiles});
 }else{
  const files=await assembleSources({context,profile,hostRoot});
  receipt=freezeHost({directory:hostRoot,identity,files,executableFiles:workflow==='104'?['codex-exact']:[]});expectedFiles=Object.fromEntries(Object.entries(files).map(([n,b])=>[n,hash(b)]));
 }
 const verify=async()=>{
  await verifySource();verifyProfile(profile);
  need(readHostConfiguration(environment).configuration_sha256===identity.configuration_sha256,'RECOVERY_IDENTITY');
  recoverHost({directory:hostRoot,identity,expectedFiles});prepareProof(context);verifyRuntime(context);
 };
 const skill_runtime=structuredClone(profile.skill_runtime);
 if(workflow==='104'){const command=path.join(hostRoot,'codex-exact');need(!!(fs.statSync(command).mode&0o100),'CODEX_EXECUTABLE');skill_runtime.codex={...skill_runtime.codex,env_keys:[...new Set([...(skill_runtime.codex?.env_keys??[]),...EXACT_ENV_KEYS])],command,command_sha256:hash(fs.readFileSync(command))};}
 skill_runtime.host_tools={...skill_runtime.host_tools,command:process.execPath,command_sha256:hash(fs.readFileSync(process.execPath)),entry:'invoke.mjs'};
 const generated={...profile,cwd:hostRoot,files:receipt.files,skill_runtime};
 return {profile:generated,context,receipt,verifySource:verify,run:{...run,input:{...context,run_tag:run.run_id}}};
}
export async function createRuntime(options){
 const prepared=await prepareLeadgenHost(options);
 const entry=path.join(options.profile.runtimeRoot,'scripts/commander-workflow/skill-adapter.mjs');
 const kernel=await import(pathToFileURL(entry));
 return kernel.createRuntime({...options,...prepared});
}
