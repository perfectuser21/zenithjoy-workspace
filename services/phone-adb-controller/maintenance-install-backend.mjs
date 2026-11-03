#!/usr/bin/env node
// 独立安全围栏入口，不进入 production release 或整包部署子进程。
import {execFileSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stageTools,deploymentTransport,TOOLS} from './deployment-transport.mjs';
import {readDeploymentSource} from './deployment-fixed-source.mjs';
import {inheritedDeploymentStdio} from './deployment-protocol.mjs';
import {digest} from './runtime-definition.mjs';
const HERE=dirname(fileURLToPath(import.meta.url));
const need=(value,message)=>{if(!value)throw Error('安全安装: '+message);};
const RECOVERY_SOURCE='3fe8783b021fd9fa1a8cd4242d79a3c703c6c21b';
// A reviewed byte-exact recovery profile, not an extensible helper allowlist.
// Reapproving changed source requires reviewing and updating these digests.
const REVIEW_GUARD_PROFILE={
 'maintenance-install-host.py':{after:'e9db70745b8fe3dd645f8a924e29e5d59375f42a93892757d6ef40cdeb1ff7a9'},
 'deployment-maintenance.py':{before:'e5faeea7ea13ac09b45fbaa3e5ab2787ff99650243d8e4a1ca6f21257da88217',after:'4a1fc295595f16e2e5a8257878e5ee731d8f159d728407205fd4c22d5940f466'},
 'input-runtime-release.py':{before:'6d9dd3418de2c037e293284958eb822650fdb7c7895075d5c66b6c38da461939',after:'e99868e255a316af227e7411e930925aa467f20c3977fda2e0e0e133899a7483'},
};
export const guardChannel=(action,{env=process.env,exec=execFileSync}={})=>
 exec('python3',[join(HERE,'deployment-guard.py'),action],
  {stdio:inheritedDeploymentStdio(env),timeout:120000});

export async function runMaintenanceInstall({root,sha,attemptKey,request,candidate,action='install',transaction,
 toolRoot=root,toolSha=sha,readSourceFn=readDeploymentSource,
 guardFn=guardChannel,stageToolsFn=stageTools,transportFn=deploymentTransport}){
 need(/^[a-f0-9]{40}$/.test(sha)&&['install','recover'].includes(action),'固定来源或操作无效');
 need(/^[a-f0-9]{40}$/.test(toolSha),'工具来源无效');
 let recoveryCompatibility;
 if(toolSha!==sha){
  need(action==='recover'&&sha===RECOVERY_SOURCE,'跨来源工具仅限原3fe事务恢复');
  const files=TOOLS.map(name=>{
   const path='services/phone-adb-controller/'+name;
   return{name,before:readSourceFn(root,sha,path),after:readSourceFn(toolRoot,toolSha,path)};
  });
  const changed=files.filter(file=>!file.before.equals(file.after));
  if(changed.length===1&&changed[0].name==='maintenance-install-host.py'){
   recoveryCompatibility='adb-host-only';
  }else{
   need(changed.length===Object.keys(REVIEW_GUARD_PROFILE).length&&changed.every(file=>{
    const expected=REVIEW_GUARD_PROFILE[file.name];
    return expected&&(!expected.before||digest(file.before)===expected.before)&&digest(file.after)===expected.after;
   }),'恢复工具闭包/profile摘要不符');
   recoveryCompatibility='review-guard-snapshot-v1';
  }
 }
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
 stageToolsFn(toolRoot,toolSha);
 const transport=transportFn(toolSha);
 guardFn('admit');
 let began=false;
 try{
  began=true;
  const result=transport.call('xian-m4','maintenance-install-host.py',action,transaction,{source_commit:sha});
  need(result?.transaction===transaction&&result.source_commit===sha&&result.secured===true,
   'M4安全围栏未完整读回');
  guardFn('complete');
  return {mode:'maintenance-install',transaction,source_commit:sha,secured:true,
   production_release_unchanged:true,business_runtime_status:'not_evaluated',
   ...(recoveryCompatibility?{recovery_compatibility:recoveryCompatibility}:{}),evidence_digest:digest(result)};
 }catch(error){
  // M4已开始后的未知结果保持同事务和Commander屏障，原事务可精确恢复。
  if(!began)guardFn('complete');
  throw error;
 }
}
