#!/usr/bin/env node
// 固定候选的完整部署事务；任何恢复都来自原始journal和Brain原生release。
import {readFileSync,statSync,realpathSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {runDriftCheck} from './deployment-drift.mjs';
import {coordinateDeployment} from './deployment-coordinator.mjs';
import {readDeploymentSource,fixedSourceEnvironment} from './deployment-fixed-source.mjs';
import {buildWriteSet,parseDeployArrays} from './deployment-write-set.mjs';
import {stageTools,deploymentTransport,quote} from './deployment-transport.mjs';
import {inheritedDeploymentStdio,verifyTransactionProtocol,restorationPlan} from './deployment-protocol.mjs';
import {brainRequest} from './deployment-preflight.mjs';
import {verifyDeploymentPlan} from './deployment-targets.mjs';
import {digest} from './runtime-definition.mjs';
import {aggregateManifest,collectMmv,runtimeFiles,observeUnified,atomicManifest,manifestHash} from './deployment-unified-observe.mjs';
const HERE=dirname(fileURLToPath(import.meta.url)),HOSTS=['xian-m4','mmv'];
const need=(v,m)=>{if(!v)throw Error('手机整包事务: '+m);};
const command=(file,args,extra={})=>execFileSync(file,args,{encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024,...extra});
const guard=(action)=>command('python3',[join(HERE,'deployment-guard.py'),action],{stdio:inheritedDeploymentStdio(process.env)});
const ownSource=(root,sha,path)=>readDeploymentSource(root,sha,'services/phone-adb-controller/'+path);
function verifyBackendSource(root,sha){
 verifyTransactionProtocol(ownSource(root,sha,'deployment-protocol.json'));
 // 包含传递import、动态Python采集器与实际子进程；必须在guard/SSH之前核验。
 for(const file of ['deployment-backend.mjs','deployment-drift.mjs','deployment-protocol.mjs','deployment-transport.mjs',
  'deployment-coordinator.mjs','deployment-write-set.mjs','deployment-unified-observe.mjs','deployment-fixed-source.mjs',
  'deployment-preflight.mjs','deployment-targets.mjs','deployment-release.mjs','deployment-business-admission.mjs',
  'company-config-readiness.mjs','company-config-lib.js','line-routes.js','runtime-definition.mjs','runtime-host.mjs',
  'runtime-release.mjs','runtime-outbox.mjs','deployment-guard.py','deployment-installed.py','commander/wf-v2-io.py',
  'drift-check.sh','deploy.sh'])ownSource(root,sha,file);
}

function transactionId(sha,attempt){return 'phone-'+sha.slice(0,12)+'-'+digest(attempt).slice(0,16);}
export function verifyRecoveryDescriptor(value,sha,transaction){
 need(value?.schema_version===1&&value.source_commit===sha&&value.transaction===transaction&&
  value.plan?.source_commit===sha&&/^[a-f0-9]{40}$/.test(value.previous_plan?.source_commit||'')&&
  HOSTS.every(host=>value.plan?.release_ids?.[host]&&value.previous_plan?.release_ids?.[host]),'原始事务身份缺失或不符');
 return value;
}
export function verifyRecoveryJournal(descriptor,host,record,started=false){
 // 首台准备失败时另一台可以尚无journal；已有journal绝不能借用其它事务。
 if(record===null){need(!started,'已开始安装但journal缺失，保留屏障');return null;}
 const identity=record?.identity;
 need(HOSTS.includes(host)&&record?.transaction===descriptor.transaction&&identity?.target===host&&
  identity.source_commit===descriptor.source_commit&&identity.previous_source_commit===descriptor.previous_plan.source_commit&&
  identity.release_id===descriptor.plan.release_ids[host]&&identity.previous_release_id===descriptor.previous_plan.release_ids[host],'journal身份不符');
 return record;
}
async function childDeployment(root,transaction){
 const child=spawn('bash',[join(root,'services/phone-adb-controller/deploy.sh')],{
  env:{...process.env,WF_PHONE_TRANSACTION:transaction},stdio:inheritedDeploymentStdio(process.env)});
 const code=await new Promise((yes,no)=>{child.on('error',no);child.on('close',yes);});
 need(code===0,'安装或原生观测失败');
}
function fixedMode(root,sha){
 const entries=new Map(command('git',['-C',root,'ls-tree','-r',sha],{env:fixedSourceEnvironment()}).trim().split('\n').map(line=>{
  const match=line.match(/^(100644|100755) blob [a-f0-9]+\t(.+)$/);return match?[match[2],match[1]==='100755'?0o755:0o644]:['',0];
 }));
 return path=>{const mode=entries.get(path)??0o644;need((statSync(join(root,path)).mode&0o777)===mode,'源文件权限与固定源码不同: '+path);return mode;};
}
async function gate(request,releaseId,observationId){
 const value=await request('/api/brain/releases/'+releaseId+'/gate');
 need(value.deployed&&value.actual_matches&&Array.isArray(value.gaps)&&!value.gaps.length&&(!observationId||value.current_observation_id===observationId),'正式当前观测不符');
 return value;
}
export function verifyChildTransaction(sha,transaction){
 verifyBackendSource(resolve(HERE,'../..'),sha);
 guard('check');
 need(/^[a-f0-9]{40}$/.test(sha)&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(transaction),'非法child事务身份');
 const transport=deploymentTransport(sha);
 const hostCall=(host,operation,data={})=>transport.call(host,'deployment-host.py',operation,null,{transaction,...data});
 need(hostCall('mmv','record',{name:'decision'})==='install'&&hostCall('mmv','record',{name:'started'})===true,'没有正式安装决定');
 const descriptor=hostCall('mmv','record',{name:'coordinator'});
 need(descriptor?.source_commit===sha&&descriptor.transaction===transaction,'安装事务来源不符');
 for(const host of HOSTS){
  const record=hostCall(host,'inspect');
  need(record?.phase==='prepared'&&record.identity.source_commit===sha&&record.identity.release_id===descriptor.plan.release_ids[host],'安装journal身份不符');
 }
 transport.call('xian-m4','deployment-maintenance.py','verify',transaction);
 return {verified:true,transaction};
}
export async function runPackageTransaction({root,sha,planFile,xianFile,mmvFile,action='deploy',transaction}){
 need(['deploy','recover','rollback'].includes(action)&&/^[a-f0-9]{40}$/.test(sha),'非法操作或SHA');
 verifyBackendSource(root,sha);
 guard('check');
 guard('admit');
 let began=false,initialPending;
 try {
 const pendingCode="from pathlib import Path;import os,pwd,json;h=Path(pwd.getpwuid(os.getuid()).pw_dir).resolve();p=h/'.local/share/zenithjoy/phone-transactions/active.json';print(json.dumps(p.exists() or p.is_symlink()))";
 initialPending=HOSTS.map(host=>JSON.parse(command('ssh',['-T',host,'python3 -c '+quote(pendingCode)]))).some(Boolean);
 if(action==='deploy')need(!initialPending,'存在未收尾事务，必须指定原事务恢复');
 const request=brainRequest(process.env.BRAIN_URL,process.env.BRAIN_INTERNAL_TOKEN);
 const provisioned=stageTools(root,sha),transport=deploymentTransport(sha);
 transaction=transaction||transactionId(sha,process.env.WF_DEPLOY_ATTEMPT_KEY||'');
 need(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(transaction),'非法事务ID');
 const hostCall=(host,operation,data={})=>transport.call(host,'deployment-host.py',operation,null,{transaction,...data});
 const tool=(host,name,operation,data)=>transport.call(host,'deployment-'+name+'.py',operation,transaction,data);
 process.stdout.write('PHONE_PACKAGE_TRANSACTION '+transaction+'\n');
 const readRecord=name=>hostCall('mmv','record',{name});
 const writeRecord=(name,value,expected)=>hostCall('mmv','record',{name,value,expected});
 let descriptor=readRecord('coordinator');
 if(action==='deploy'){
  need(!descriptor,'已有事务必须显式recover或rollback');
  const plan=JSON.parse(readFileSync(planFile)),xian=JSON.parse(readFileSync(xianFile)),mmv=JSON.parse(readFileSync(mmvFile));
  need(plan.source_commit===sha,'部署计划版本不同');await verifyDeploymentPlan(plan,request);
  const previous={},releases={};
  for(const host of HOSTS){
   previous[host]=hostCall(host,'current',{target:host});
   const m=previous[host].manifest;releases[host]=(await request('/api/brain/releases/'+m.release_id)).release;
   await gate(request,m.release_id,m.observation_id);
  }
  const oldPlan=restorationPlan(releases,Object.fromEntries(HOSTS.map(h=>[h,previous[h].manifest])));
  await verifyDeploymentPlan(oldPlan,request);
  const oldMmv=previous.mmv.manifest,oldXian=previous['xian-m4'].manifest;
  await collectMmv(oldPlan,oldMmv,aggregateManifest(oldPlan,oldMmv),oldXian,request,previous.mmv.commander_manifest.files);
  const commanderFiles=runtimeFiles();
  // 使用同一个既有Python序列化器，完整匹配deploy_commander真正发布的字节。
  const manifestCode="import importlib.util,json,sys;from pathlib import Path;p=Path(sys.argv[1]);s=importlib.util.spec_from_file_location('io',p/'wf-v2-io.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);f=m.components(p);print(json.dumps(dict(protocol=m.PROTOCOL,files=f,runtime_snapshot_sha256=m.digest(f),releases=json.load(sys.stdin)),ensure_ascii=False),end='')";
  const commanderManifest=Buffer.from(command('python3',['-c',manifestCode,join(HERE,'commander')],{input:JSON.stringify(plan.commander_releases)}));
  const entries=buildWriteSet({groups:parseDeployArrays(ownSource(root,sha,'deploy.sh').toString()),sha,
   homes:Object.fromEntries(HOSTS.map(h=>[h,provisioned[h].home])),read:path=>readDeploymentSource(root,sha,path),mode:fixedMode(root,sha),
   commanderFiles:Object.keys(commanderFiles),commanderManifest});
  descriptor={schema_version:1,transaction,source_commit:sha,plan,xianManifest:xian,mmvManifest:mmv,previous,previous_plan:oldPlan,entries,
   commanderFiles,skills:Object.keys(commanderFiles).filter(p=>p.startsWith('skills/')&&p.endsWith('/SKILL.md')).map(p=>p.split('/')[1])};
  writeRecord('coordinator',descriptor,null);
 }else{
  verifyRecoveryDescriptor(descriptor,sha,transaction);
  await verifyDeploymentPlan(descriptor.plan,request);await verifyDeploymentPlan(descriptor.previous_plan,request);
 }
 let observation=null;
 const barrier=host=>host==='xian-m4'?tool(host,'maintenance','acquire'):null;
 async function observe(direction){
  if(observation?.direction===direction)return;
  const restored=direction==='restored',plan=restored?descriptor.previous_plan:descriptor.plan;
  const xian=restored?descriptor.previous['xian-m4'].manifest:descriptor.xianManifest;
  const mmv=restored?descriptor.previous.mmv.manifest:descriptor.mmvManifest;
  const files=restored?descriptor.previous.mmv.commander_manifest.files:descriptor.commanderFiles;
  // 不覆盖外部发布的真身：当前必须属于本事务两个原生release之一。
  for(const host of HOSTS){
   const old=await request('/api/brain/releases/'+descriptor.previous_plan.release_ids[host]+'/gate');
   const next=await request('/api/brain/releases/'+descriptor.plan.release_ids[host]+'/gate');
   need(old.deployed&&old.actual_matches||next.deployed&&next.actual_matches,'当前发布已被其他操作改变，保留屏障');
  }
  const previous=new Map();for(const [host,path]of [['xian-m4','bin-harvest/deployment-manifest.json'],['mmv','.openclaw/leadgen-scripts/deployment-manifest.json'],['mmv','bin-harvest/deployment-manifest.json']])previous.set(host+':'+path,manifestHash(host,path));
  const result=await observeUnified({plan,xianManifest:xian,mmvManifest:mmv,
   options:{environment:'production',collector:'phone-adb-deployer',attemptKey:`phone-transaction:${transaction}:${direction}`,brainUrl:process.env.BRAIN_URL,stateDir:join(homedir(),'.config/zenithjoy/deployments'),request},
   collectXian:async m=>JSON.parse(command('ssh',['-T','xian-m4','node ~/bin-harvest/deployment-manifest.mjs collect ~/bin-harvest -'],{input:JSON.stringify(m)})),
   collectMmv:(manifest,ack)=>collectMmv(plan,mmv,manifest,ack,request,files),
   publish:async(host,path,value)=>atomicManifest(host,path,value,previous.get(host+':'+path),{id:transaction,sha,direction})});
  observation={direction,result};
 }
 const callbacks={
  readDecision:async()=>readRecord('decision'),
  writeDecision:async value=>writeRecord('decision',value,readRecord('decision')),
  inspect:async host=>verifyRecoveryJournal(descriptor,host,hostCall(host,'inspect'),readRecord('started')),
  prepare:async host=>{
   hostCall(host,'prepare',{entries:descriptor.entries[host],identity:{target:host,source_commit:sha,previous_source_commit:descriptor.previous_plan.source_commit,
    release_id:descriptor.plan.release_ids[host],previous_release_id:descriptor.previous_plan.release_ids[host]}});
   barrier(host);
   if(host==='mmv')tool(host,'effects','prepare',{skills:descriptor.skills});
   else tool(host,'service','prepare',{file:{kind:'file',bytes:Buffer.from(transport.renderService()).toString('base64'),mode:0o644,uid:0,gid:0}});
  },
  reacquire:async host=>{
   const current=hostCall(host,'inspect');
   if(current.phase==='released')hostCall(host,'reopen',{source_commit:current.released_direction==='restored'?descriptor.previous_plan.source_commit:sha});
   barrier(host);
  },
  install:async()=>{
   writeRecord('started',true,null);
   for(const host of HOSTS){hostCall(host,'census');hostCall(host,'current',{target:host});}
   await childDeployment(root,transaction);
   for(const host of HOSTS)hostCall(host,'reload-gui',{target:host,expected:descriptor.previous[host].gui});
   // drift证据在提交决定前验证，不能先释放再报假绿。
   runDriftCheck('bash',[join(HERE,'drift-check.sh')],{...process.env,DRIFT_REPO:root,DRIFT_REF:sha,DRIFT_SKIP_FETCH:'1'});
  },
  verifyInstalled:async host=>{
   // 正式安装已由child统一观察；recover只读现有ACK，不重发不同evidence。
   const current=hostCall(host,'current',{target:host});
   need(current.manifest.source_commit===sha&&current.manifest.release_id===descriptor.plan.release_ids[host],'当前安装身份不符');
   await gate(request,current.manifest.release_id,current.manifest.observation_id);
   tool(host,host==='mmv'?'effects':'service','verify-installed');
   hostCall(host,'verify',{direction:'after'});
  },
  commit:async host=>hostCall(host,'commit'),
  restore:async host=>{
   hostCall(host,'restore',{explicit:action==='rollback'||readRecord('decision')==='restore'});
   const effect=host==='mmv'?'effects':'service';
   if(hostCall(host,'effect-exists',{effect}))tool(host,effect,'restore');
   else need(!readRecord('started'),'安装已开始但副作用快照缺失');
   hostCall(host,'reload-gui',{target:host,expected:descriptor.previous[host].gui});
  },
  verifyRestored:async host=>{
   if(readRecord('started'))await observe('restored');
   const effect=host==='mmv'?'effects':'service';
   if(hostCall(host,'effect-exists',{effect}))tool(host,effect,'verify-restored');
   else need(!readRecord('started'),'安装已开始但副作用快照缺失');
   hostCall(host,'verify',{direction:'before'});
   const current=hostCall(host,'current',{target:host});await gate(request,current.manifest.release_id,current.manifest.observation_id);
  },
  release:async host=>{
   const state=hostCall(host,'inspect'),restored=state.phase==='restored'||state.released_direction==='restored';
   if(host==='xian-m4')tool(host,'maintenance','release');
   hostCall(host,'release',{release_id:(restored?descriptor.previous_plan:descriptor.plan).release_ids[host]});
  },recover:action==='recover',rollback:action==='rollback'
 };
 try{
  began=true;
  const result=await coordinateDeployment(callbacks);guard('complete');return {transaction,source_commit:sha,...result};
 }catch(error){
  // 只有完整恢复并完成两机最终读回才释放Commander admission；失败原样向上报告。
  const records=HOSTS.map(h=>verifyRecoveryJournal(descriptor,h,hostCall(h,'inspect'),readRecord('started')));
  if(records.every(r=>r?.phase==='released'&&r.released_direction==='restored'||!r&&!readRecord('started')))guard('complete');
  throw error;
 }
 }catch(error){
  if(!began&&action==='deploy'&&initialPending===false)guard('complete');
  throw error;
 }
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 try{
  const [action,sha,transaction,planFile,xianFile,mmvFile]=process.argv.slice(2);
  const result=action==='check-child'?verifyChildTransaction(sha,transaction):await runPackageTransaction({root:resolve(HERE,'../..'),sha,transaction:transaction||undefined,action,planFile,xianFile,mmvFile});
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
