#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync,realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeDefinition,readFrozen } from './runtime-definition.mjs';
import { enqueue,flush,occurrence } from './runtime-outbox.mjs';
const e=process.env;
function request(path){
  if(!e.BRAIN_URL)throw Error('BRAIN_URL缺失，不能固定运行版本');
  return JSON.parse(execFileSync('curl',['-fsS','--connect-timeout','3','-m','8',`${e.BRAIN_URL.replace(/\/$/,'')}${path}`,'-H',`Authorization: Bearer ${e.BRAIN_INTERNAL_TOKEN||''}`],{encoding:'utf8',maxBuffer:10*1024*1024}));
}
export function send(event){
  if(!e.BRAIN_INTERNAL_TOKEN)return 0;
  const output=execFileSync('curl',['-s','--connect-timeout','3','-m','8','-w','\n%{http_code}','-X','POST',event.endpoint,'-H',`Authorization: Bearer ${e.BRAIN_INTERNAL_TOKEN}`,'-H','Content-Type: application/json','-d',JSON.stringify(event.body)],{encoding:'utf8'});
  return Number(output.trim().split('\n').at(-1));
}
async function flushReceipts(dir){const status=await flush(dir,{send,limit:Math.max(1,Math.min(20,Number(e.WFR_OUTBOX_LIMIT)||3))});if(status.pending||status.blocked)process.stderr.write(`WFR_WARN span/callback evidence pending=${status.pending} blocked=${status.blocked}\n`);return status;}
export async function run(args){
  const [cmd,...rest]=args; const dir=e.WFR_RUN_DIR;
  if(cmd==='prepare'){
    const root=e.WF_DEPLOYMENT_ROOT||e.WF_HOME;
    await freezeDefinition({runDir:dir,deploymentRoot:root,manifestPath:e.WF_DEPLOYMENT_MANIFEST,workflowKey:e.WF_BRAIN_WORKFLOW,rawContractSha256:e.WF_CONTRACT_RAW_SHA256,activityRefs:e.WF_ACTIVITY_REFS?JSON.parse(e.WF_ACTIVITY_REFS):null,planPath:e.WF_PLAN_PATH,stepSpecPath:resolve(root,e.WF_STEP_SPEC||''),get:request});return;
  }
  if(cmd==='flush'){const status=await flushReceipts(dir);process.stdout.write(`WFR_EVIDENCE_STATUS=${status.blocked?'blocked':status.pending?'pending':'sent'}\n`);return;}
  if(cmd==='mark-start'){
    const started=occurrence(dir,`${e.WFR_ATTEMPT||'a0'}.${rest[0]}.${rest[1]||1}`,true);
    writeFileSync(resolve(dir,`span-start.${e.WFR_ATTEMPT||'a0'}.${rest[0]}.${rest[1]||1}`),started.started_at);return;
  }
  if(cmd==='callback'){
    const body=JSON.parse(readFileSync(0,'utf8'));
    enqueue(dir,{key:body.run_id,endpoint:`${e.BRAIN_URL?.replace(/\/$/,'')}/api/brain/execution-callback`,body});await flushReceipts(dir);return;
  }
  if(cmd==='span'){
    const [stage,status,n,file,word='']=rest;const frozen=readFrozen(dir);
    const a=frozen.activities.find(a=>a.reference.slot_key===stage);
    if(!a)throw Error(`冻结定义无活动: ${stage}`);
    const artifact=JSON.parse(readFileSync(file,'utf8'));const oc=occurrence(dir,`${e.WFR_ATTEMPT||'a0'}.${stage}.${n}`,false,artifact.observed_at);
    const rescan=stage==='collection'?Math.max(0,Number(artifact.metrics?.rescan_count||0)):0;
    const body=[{run_id:`${e.WFR_RUN_ID}__${e.WFR_ATTEMPT||'a0'}`,occurrence_key:oc.key,workflow_id:frozen.workflow_version.payload.workflow_id,activity_id:a.reference.activity_id,step_id:null,enabler_id:null,started_at:oc.started_at,ended_at:artifact.observed_at||new Date().toISOString(),executor_kind:['qualification','scoring'].includes(stage)?'agent':'code',executor_id:e.WFR_HOSTKEY||'unknown',attempts:rescan+1,fallback:rescan>0,outcome:({completed:'pass',failed:'fail',blocked:'skipped'})[status]||'unknown',evidence:{activity_key:stage,stage_attempt:Number(n),word,artifact:file.split('/').at(-1),rescan_count:rescan,rescan_rate:Number(artifact.metrics?.rescan_rate||0),workflow_definition_version_id:frozen.workflow_version.id,activity_definition_version_id:a.version.id,reference_id:a.reference.reference_id,slot_key:a.reference.slot_key,sequence_no:a.reference.sequence_no,implementation_bindings:a.implementations,steps:a.version.payload.steps,snapshot_sha256:frozen.snapshot_sha256}}];
    enqueue(dir,{key:oc.key,endpoint:`${e.BRAIN_URL?.replace(/\/$/,'')}/api/brain/spans`,body});await flushReceipts(dir);return;
  }
  throw Error(`未知runtime命令: ${cmd}`);
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))run(process.argv.slice(2)).catch(err=>{process.stderr.write(`WFR_RUNTIME_ERROR ${err.message}\n`);process.exitCode=1;});
