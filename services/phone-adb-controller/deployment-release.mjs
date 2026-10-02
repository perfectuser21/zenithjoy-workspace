#!/usr/bin/env node
// 实际部署读回是观测来源；release声明只用于核对，不能替代文件采集。
import {existsSync,readFileSync,realpathSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {digest} from './runtime-definition.mjs';
import {atomic} from './runtime-outbox.mjs';
import {deploymentTarget} from './runtime-host.mjs';
export {deploymentTarget} from './runtime-host.mjs';
function actualComponents(release,observed,manifest){
 if(observed.source_repo!==manifest.source_repo||observed.source_commit!==manifest.source_commit)throw Error('实际来源与部署commit不符');
 if(digest(observed.files)!==digest(manifest.files))throw Error('实际文件组件与部署manifest不符');
 return (release.payload.components||[]).map(component=>{
  if(component.repo!==observed.source_repo||component.revision!==observed.source_commit)throw Error('组件来源无实机证据');
  if(component.kind==='repo')return {kind:'repo',repo:observed.source_repo,revision:observed.source_commit};
  const entry=observed.files.find(f=>f.path===component.path);
  if(!['code','skill'].includes(component.kind)||!entry)throw Error('组件缺少实际文件采集');
  const actual={kind:component.kind,repo:observed.source_repo,path:entry.path,revision:observed.source_commit,digest:`sha256:${entry.content_sha256}`};
  if(digest(actual)!==digest(component))throw Error('组件实际digest与release不符');return actual;
 });
}
export async function observeDeployment(o){
 if(!o.releaseId||!o.environment||!o.collector||!o.attemptKey||!o.brainUrl)throw Error('部署必须配置release/environment/collector/attempt及BRAIN_URL');
 if(!/^[a-zA-Z0-9._-]+$/.test(o.host))throw Error('非法部署机器');
 const endpoint=`${o.brainUrl.replace(/\/$/,'')}/api/brain/releases/${encodeURIComponent(o.releaseId)}`;
 const release=(await o.request(endpoint))?.release;
 if(!release||release.id!==o.releaseId||release.environment!==o.environment||release.target!==o.host)throw Error('release部署目标不匹配');
 if(release.manifest_sha256!==digest({environment:release.environment,target:release.target,payload:release.payload}))throw Error('release摘要不符');
 const observed=await o.collect(o.manifest);
 if(!observed.observed_hostname||deploymentTarget(observed.observed_hostname)!==o.host)throw Error('实际机器身份与部署目标不匹配');
 const components=actualComponents(release,observed,o.manifest);
 if(!components.length)throw Error('release组件不能为空');
 mkdirSync(o.stateDir,{recursive:true,mode:0o700});
 const key=digest({release_id:o.releaseId,host:o.host,attempt_key:o.attemptKey});
 const file=join(o.stateDir,`${key}.request.json`),blocked=join(o.stateDir,`${key}.blocked.json`);
 if(existsSync(blocked))throw Error('部署观测冲突blocked');
 let record={endpoint:`${endpoint}/observations`,body:{event_key:`${o.attemptKey}:${o.host}`,attempt_key:o.attemptKey,environment:o.environment,target:o.host,components,collector:o.collector,observed_at:new Date().toISOString(),evidence_ref:`deployment-sha256:${digest(observed)}`}};
 if(existsSync(file)){
  const previous=JSON.parse(readFileSync(file,'utf8'));
  if(previous.endpoint!==record.endpoint||digest({...previous.body,observed_at:null})!==digest({...record.body,observed_at:null}))throw Error('部署观测请求已固定，内容冲突');
  record=previous;
 }else {atomic(join(o.stateDir,`${key}.evidence.json`),observed);atomic(file,record);}
 let posted;
 try{posted=await o.request(record.endpoint,record.body);}catch(error){if(error.status===409)atomic(blocked,{state:'blocked',http_status:409});throw error;}
 const id=posted?.observation?.id;if(!id)throw Error('部署观测ACK缺少身份');
 const observation=(await o.request(`${endpoint}/observations/${encodeURIComponent(id)}`))?.observation;
 if(!observation||observation.id!==id||observation.release_id!==o.releaseId)throw Error('部署观测回读身份不匹配');
 if(digest(observation.payload)!==digest(record.body))throw Error('部署观测回读内容不匹配');
 const gate=await o.request(`${endpoint}/gate`);
 if(!gate.deployed||!gate.actual_matches||gate.current_observation_id!==id)throw Error('部署观测未通过当前release门禁');
 atomic(join(o.stateDir,`${key}.ack.json`),{observation,gate});
 return {...o.manifest,release_id:o.releaseId,observation_id:id,environment:o.environment,target:o.host};
}
async function request(url,body){
 const headers={'Content-Type':'application/json'};
 if(process.env.BRAIN_INTERNAL_TOKEN)headers.Authorization=`Bearer ${process.env.BRAIN_INTERNAL_TOKEN}`;
 const response=await fetch(url,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Object.assign(Error(`Brain部署观测HTTP ${response.status}`),{status:response.status});return response.json();
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 try{
  const host=process.argv[2],manifest=JSON.parse(readFileSync(process.argv[3],'utf8')),env=process.env;
  const releaseId=JSON.parse(env.WF_RELEASE_IDS||'{}')[host];
  const result=await observeDeployment({host,manifest,releaseId,environment:env.WF_DEPLOY_ENVIRONMENT,collector:env.WF_DEPLOY_COLLECTOR,attemptKey:env.WF_DEPLOY_ATTEMPT_KEY,brainUrl:env.BRAIN_URL,stateDir:env.WF_DEPLOY_STATE_DIR||join(homedir(),'.config/zenithjoy/deployments'),request,
   collect:async input=>JSON.parse(execFileSync('ssh',[host,'node ~/bin-harvest/deployment-manifest.mjs collect ~/bin-harvest -'],{input:JSON.stringify(input),encoding:'utf8',timeout:30000}))});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
