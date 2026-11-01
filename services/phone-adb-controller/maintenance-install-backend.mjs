#!/usr/bin/env node
// 独立安全围栏入口，不进入 production release 或整包部署子进程。
import {execFileSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stageTools,deploymentTransport} from './deployment-transport.mjs';
import {inheritedDeploymentStdio} from './deployment-protocol.mjs';
import {digest} from './runtime-definition.mjs';
const HERE=dirname(fileURLToPath(import.meta.url));
const need=(value,message)=>{if(!value)throw Error('安全安装: '+message);};
export const guardChannel=(action,{env=process.env,exec=execFileSync}={})=>
 exec('python3',[join(HERE,'deployment-guard.py'),action],
  {stdio:inheritedDeploymentStdio(env),timeout:120000});

export async function runMaintenanceInstall({root,sha,attemptKey,request,candidate,action='install',transaction,
 guardFn=guardChannel,stageToolsFn=stageTools,transportFn=deploymentTransport}){
 need(/^[a-f0-9]{40}$/.test(sha)&&['install','recover'].includes(action),'固定来源或操作无效');
 if(action==='install'){
  need(candidate?.source_commit===sha&&candidate.environment===`staging:${sha}`&&candidate.business_runtime_status==='not_evaluated',
   '候选来源不符');
  for(const host of ['mmv','xian-m4']){
   const id=candidate.release_ids?.[host],obs=candidate.observation_ids?.[host];
   need(/^[a-f0-9-]{36}$/.test(id||'')&&/^[a-f0-9-]{36}$/.test(obs||''),'双机候选ID缺失');
   const gate=await request('/api/brain/releases/'+id+'/gate');
   need(gate.deployed===true&&gate.actual_matches===true&&Array.isArray(gate.gaps)&&gate.gaps.length===0&&gate.current_observation_id===obs,
    '双机候选Brain gate未通过');
  }
 }
 transaction=transaction||'phone-safety-'+sha.slice(0,24);
 need(transaction==='phone-safety-'+sha.slice(0,24),'安全事务ID与来源不符');
 guardFn('check');
 stageToolsFn(root,sha);
 const transport=transportFn(sha);
 guardFn('admit');
 let began=false;
 try{
  began=true;
  const result=transport.call('xian-m4','maintenance-install-host.py',action,transaction,{source_commit:sha});
  need(result?.transaction===transaction&&result.source_commit===sha&&result.secured===true,
   'M4安全围栏未完整读回');
  guardFn('complete');
  return {mode:'maintenance-install',transaction,source_commit:sha,secured:true,
   production_release_unchanged:true,business_runtime_status:'not_evaluated',evidence_digest:digest(result)};
 }catch(error){
  // M4已开始后的未知结果保持同事务和Commander屏障，原事务可精确恢复。
  if(!began)guardFn('complete');
  throw error;
 }
}
