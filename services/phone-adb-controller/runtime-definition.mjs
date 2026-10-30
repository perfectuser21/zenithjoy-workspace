import {validateProducerDescriptor,assertProducerSampling} from './producer-descriptor.mjs';
import {userInfo} from 'node:os';
import { assertRuntimeHost } from './runtime-host.mjs';
import { loadRuntimeRelease } from './runtime-release.mjs';
// 运行前只读固定版本；运行目录是之后所有判定与身份解析的唯一来源。
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync, realpathSync, statSync, lstatSync } from 'node:fs';
import { resolve, dirname, sep, basename } from 'node:path';
export const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
export const digest = value => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : canonical(value)).digest('hex');
// 单视频软预算加480秒收尾不得超过collection的7200秒合同。
export function collectionBudgetSeconds(env){
 if(!Object.hasOwn(env,'QUEUED_VIDEO_COLLECTION_SECONDS'))return 480;
 const value=String(env.QUEUED_VIDEO_COLLECTION_SECONDS);
 if(!/^[1-9][0-9]{0,3}$/.test(value)||Number(value)>6720)throw Error('评论采集预算必须为1至6720整数');
 return Number(value);
}
// 本轮可选采样输入是冻结定义的一部分，续跑不许改变配额或上游来源。
export function commentSamplingInput(env){
 const collectionBudget=collectionBudgetSeconds(env);
 if(!Object.hasOwn(env,'LEADGEN_COMMENT_LIMIT'))return null;
 if(!/^(?:[1-9]|[1-4][0-9]|50)$/.test(String(env.LEADGEN_COMMENT_LIMIT)))throw Error('评论采样上限必须为1至50整数');
 if(env.WF_BRAIN_WORKFLOW!=='douyin_video_processing')throw Error('评论采样只允许102视频处理流程');
 if(!/^[A-Za-z0-9_-]+$/.test(env.LEADGEN_SOURCE_RUN||'')||!/^[A-Za-z0-9_-]+$/.test(env.WFR_TAG||'')||!env.P||!env.SERIAL||!env.LEADGEN_LINE)throw Error('评论采样缺少本run及上游来源身份');
 return {schema_version:1,workflow_key:env.WF_BRAIN_WORKFLOW,run_tag:env.WFR_TAG,profile:env.P,serial:env.SERIAL,line:env.LEADGEN_LINE,source_run:env.LEADGEN_SOURCE_RUN,comment_limit:Number(env.LEADGEN_COMMENT_LIMIT),...(Object.hasOwn(env,'QUEUED_VIDEO_COLLECTION_SECONDS')?{collection_budget_s:collectionBudget}:{})};
}
export function assertCommentSampling(snapshot,env){
 const requested=commentSamplingInput(env),fixed=snapshot.sampling_input||null;
 if(canonical(requested)!==canonical(fixed))throw Error('评论采样请求与本run冻结输入不符');
 return fixed;
}
// v1严格限制首屏候选数；v2显式限制实际尝试，二者均独立于成功入库数。
export function validateDiscoveryInput(value){
 const quotaKey=value?.schema_version===2?'max_attempts':'max_candidates';
 const keys=['schema_version','workflow_key','run_tag','profile','serial','line',quotaKey,'max_screens','source_kind','sources','source_sha256'];
 if(!value||Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k))||![1,2].includes(value.schema_version)||value.workflow_key!=='douyin_video_discovery'||!['run_tag','profile','serial','line'].every(k=>/^[A-Za-z0-9_-]+$/.test(value[k]||''))||!Number.isSafeInteger(value[quotaKey])||value[quotaKey]<1||value[quotaKey]>1000||!Number.isSafeInteger(value.max_screens)||value.max_screens<1||value.max_screens>1000||value.schema_version===1&&value.max_screens!==1||value.source_kind!=='keyword'||!Array.isArray(value.sources)||value.sources.length!==1||typeof value.sources[0]!=='string'||!value.sources[0].trim()||/[\r\n]/.test(value.sources[0])||!/^[a-f0-9]{64}$/.test(value.source_sha256||''))throw Error('DISCOVERY_INPUT_INVALID');
 return value;
}
export function discoveryInput(env){
 const candidates=Object.hasOwn(env,'LEADGEN_DISCOVERY_MAX_CANDIDATES'),attempts=Object.hasOwn(env,'LEADGEN_DISCOVERY_MAX_ATTEMPTS');
 if(!candidates&&!attempts)return null;
 const quota=attempts?env.LEADGEN_DISCOVERY_MAX_ATTEMPTS:env.LEADGEN_DISCOVERY_MAX_CANDIDATES;
 const maxScreens=String(env.LEADGEN_MAX_SCREENS);
 if(candidates&&attempts||!/^[1-9][0-9]{0,3}$/.test(String(quota))||!/^[1-9][0-9]{0,3}$/.test(maxScreens)||Number(maxScreens)>1000||candidates&&maxScreens!=='1'||env.LEADGEN_SOURCE_KIND!=='keyword'||!env.LEADGEN_SOURCES_FILE)throw Error('DISCOVERY_INPUT_INVALID');
 const bytes=readFileSync(env.LEADGEN_SOURCES_FILE);if(bytes.length>10000)throw Error('DISCOVERY_INPUT_INVALID');
 return validateDiscoveryInput({schema_version:attempts?2:1,workflow_key:env.WF_BRAIN_WORKFLOW,run_tag:env.WFR_TAG,profile:env.P,serial:env.SERIAL,line:env.LEADGEN_LINE,[attempts?'max_attempts':'max_candidates']:Number(quota),max_screens:Number(maxScreens),source_kind:'keyword',sources:bytes.toString('utf8').split('\n').filter(Boolean),source_sha256:digest(bytes)});
}
export function assertDiscoveryInput(snapshot,env){
 const requested=discoveryInput(env),fixed=snapshot.discovery_input||null;
 if(fixed)validateDiscoveryInput(fixed);
 if(canonical(requested)!==canonical(fixed))throw Error('DISCOVERY_INPUT_MISMATCH');
 return fixed;
}
export function localPath(root, relative) {
  if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) throw Error('非法部署路径');
  const p=realpathSync(resolve(root,relative)); const base=realpathSync(root);
  if (!p.startsWith(base+sep)) throw Error('部署路径越界'); return p;
}
function verifyVersion(v, type, id, versionId) {
  if (!v || v.id!==versionId || v.payload?.[`${type}_id`]!==id || !/^[a-f0-9]{40}$/.test(v.source_commit)) throw Error('版本规范身份或固定来源无效');
  const source={repo:v.source_repo,path:v.source_path,commit:v.source_commit};
  if (digest({source,payload:v.payload})!==v.payload_sha256 || digest(v.payload.contract)!==v.contract_sha256) throw Error('版本digest摘要不符');
}
export function readFrozen(runDir) {
  const snapshot=JSON.parse(readFileSync(resolve(runDir,'run-definition.json'),'utf8'));
  const {snapshot_sha256,...body}=snapshot;
  if (digest(body)!==snapshot_sha256) throw Error('运行快照digest不符');
  for (const [file,hash] of Object.entries(snapshot.files)) if (digest(readFileSync(resolve(runDir,file)))!==hash) throw Error(`冻结文件digest不符: ${file}`);
  return snapshot;
}
function assertRunIdentity(snapshot,identity,runDir){
  const recorded=snapshot.run_identity;
  if(recorded && (!['capability','tag','profile','serial','run_id'].every(key=>typeof recorded[key]==='string' && recorded[key].length) || (runDir && basename(resolve(runDir))!==recorded.run_id))) throw Error('运行身份或目录不匹配');
  const contract=snapshot.workflow_version.payload.contract;
  if(!recorded || (contract?.contract_key??contract?.capability)!==identity.capability) throw Error('运行快照capability身份不匹配');
  for(const key of ['capability','tag','profile','serial','run_id']) if(identity[key]!==undefined && identity[key]!==recorded[key]) throw Error(`运行身份不匹配: ${key}`);
}
export function registerRun(indexRoot,runDir,identity){
  assertRunIdentity(readFrozen(runDir),identity,runDir);
  mkdirSync(indexRoot,{recursive:true,mode:0o700});
  const file=resolve(indexRoot,`${digest([identity.capability,identity.tag])}.json`);
  const temp=`${file}.${randomUUID()}.tmp`;writeFileSync(temp,JSON.stringify({run_dir:resolve(runDir)}),{mode:0o600});renameSync(temp,file);
}
export function locateRun(indexRoot,identity){
  const file=resolve(indexRoot,`${digest([identity.capability,identity.tag])}.json`);
  if(!existsSync(file))return null;
  const record=JSON.parse(readFileSync(file,'utf8'));assertRunIdentity(readFrozen(record.run_dir),identity,record.run_dir);return record.run_dir;
}
export function assertDeploymentAdmission(deploymentRoot,home=userInfo().homedir){
 const actual=realpathSync(deploymentRoot),base=realpathSync(home);
 if(![resolve(base,'bin-harvest'),resolve(base,'.openclaw/leadgen-scripts')].includes(actual))return;
 const marker=resolve(base,'.local/share/zenithjoy/phone-transactions/active.json');
 for(let path=dirname(marker);path!==base;path=dirname(path)){
  try{if(lstatSync(path).isSymbolicLink())throw Error('整包部署状态路径异常');}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 try{lstatSync(marker);throw Error('整包部署或恢复未完成，拒绝新运行冻结');}catch(error){if(error.code!=='ENOENT')throw error;}
}
export async function freezeDefinition(o) {
  if(o.discoveryInput){const d=validateDiscoveryInput(o.discoveryInput);if(d.workflow_key!==o.workflowKey||o.runIdentity&&['tag','profile','serial'].some(k=>o.runIdentity[k]!==d[k==='tag'?'run_tag':k]))throw Error('DISCOVERY_INPUT_FREEZE_SCOPE_INVALID');}
  if(existsSync(resolve(o.runDir,'run-definition.json'))&&canonical(readFrozen(o.runDir).discovery_input||null)!==canonical(o.discoveryInput||null))throw Error('DISCOVERY_INPUT_RESUME_MISMATCH');
  if(o.producerDescriptor){const d=validateProducerDescriptor(o.producerDescriptor);assertProducerSampling(d,o.samplingInput);if(o.workflowKey!=='douyin_video_processing'||o.runIdentity?.profile!==d.profile||o.runIdentity?.serial!==d.serial||o.samplingInput?.source_run!==d.run_tag)throw Error('PRODUCER_DESCRIPTOR_FREEZE_SCOPE_INVALID');}
  if(existsSync(resolve(o.runDir,'run-definition.json'))&&canonical(readFrozen(o.runDir).producer_descriptor||null)!==canonical(o.producerDescriptor||null))throw Error('PRODUCER_DESCRIPTOR_RESUME_MISMATCH');
  if(existsSync(resolve(o.runDir,'run-definition.json'))&&canonical(readFrozen(o.runDir).discovery_phone_scope||null)!==canonical(o.discoveryPhoneScope||null))throw Error('discovery phone scope续跑输入与冻结请求不符');
  if(o.samplingInput){
    const q=o.samplingInput;
    const checked=commentSamplingInput({LEADGEN_COMMENT_LIMIT:String(q.comment_limit),WF_BRAIN_WORKFLOW:q.workflow_key,WFR_TAG:q.run_tag,P:q.profile,SERIAL:q.serial,LEADGEN_LINE:q.line,LEADGEN_SOURCE_RUN:q.source_run,...(Object.hasOwn(q,'collection_budget_s')?{QUEUED_VIDEO_COLLECTION_SECONDS:String(q.collection_budget_s)}:{})});
    if(canonical(checked)!==canonical(q)||q.workflow_key!==o.workflowKey)throw Error('冻结采样输入scope/schema非法');
    if(o.runIdentity&&['tag','profile','serial'].some(k=>o.runIdentity[k]!==q[k==='tag'?'run_tag':k]))throw Error('冻结采样输入运行身份不符');
  }
  if (existsSync(resolve(o.runDir,'run-definition.json'))) {const frozen=readFrozen(o.runDir);if(canonical(frozen.sampling_input||null)!==canonical(o.samplingInput||null))throw Error('评论采样续跑输入与冻结请求不符');if(canonical(frozen.collection_phone_scope||null)!==canonical(o.collectionPhoneScope||null))throw Error('collection phone scope续跑输入与冻结请求不符');if(o.runIdentity)assertRunIdentity(frozen,o.runIdentity,o.runDir);if(frozen.release)assertRuntimeHost(frozen.release,frozen.deployment);return frozen;}
  assertDeploymentAdmission(o.deploymentRoot);
  const manifestPath=o.manifestPath||resolve(o.deploymentRoot,'deployment-manifest.json');
  const originalManifest=readFileSync(manifestPath);
  const manifest=JSON.parse(originalManifest);
  const fixed=(o.releaseId||manifest.release_id||o.requireRelease)?await loadRuntimeRelease(o,manifest,digest):null;
  let version;
  if(fixed){assertRuntimeHost(fixed.release,manifest);version=fixed.version;}
  else {
    const list=await o.get('/api/brain/workflows');const matches=(Array.isArray(list)?list:list.workflows||[]).filter(w=>w.key===o.workflowKey);
    if(matches.length!==1 || !matches[0].current_definition_version_id)throw Error('工作流必须有唯一已登记current version');
    const w=matches[0];version=(await o.get(`/api/brain/workflows/${w.id}/versions/${w.current_definition_version_id}`))?.version;
    verifyVersion(version,'workflow',w.id,w.current_definition_version_id);
  }
  verifyVersion(version,'workflow',version.payload.workflow_id,version.id);
  if(o.samplingInput&&version.payload.key!==o.samplingInput.workflow_key)throw Error('冻结采样流程版本身份不符');
  if (!o.rawContractSha256 || version.contract_sha256!==o.rawContractSha256) throw Error('部署计划contract摘要与版本不同');
  if(manifest.source_commit!==version.source_commit || manifest.source_repo!==version.source_repo) throw Error('部署来源与固定版本不同');
  const checked=new Map();
  for (const file of manifest.files||[]) {
    const sourcePath=localPath(o.deploymentRoot,file.deployed_path);
    const bytes=readFileSync(sourcePath); const mode=statSync(sourcePath).mode & 0o555;
    const actual=digest(bytes);
    if(actual!==file.content_sha256) throw Error(`实际部署文件digest不符: ${file.path}`);
    checked.set(file.path,{...file,actual_content_sha256:actual,status:'verified_local',bytes,mode,sourcePath});
  }
  if(!checked.size) throw Error('部署实现清单为空');
  const checkedBytes=path=>{
    const file=[...checked.values()].find(file=>file.sourcePath===realpathSync(path));
    if(!file)throw Error('实际plan/step文件不在部署清单manifest');
    return file.bytes;
  };
  const plan=checkedBytes(o.planPath);const steps=checkedBytes(o.stepSpecPath);JSON.parse(steps);
  const activities=[];
  for(const ref of version.payload.activities||[]) {
    if(!ref.reference_id || !ref.activity_version_id) throw Error('缺少活动使用位置或版本');
    const av=fixed?fixed.activityVersion(ref):(await o.get(`/api/brain/activities/${ref.activity_id}/versions/${ref.activity_version_id}`))?.version;
    verifyVersion(av,'activity',ref.activity_id,ref.activity_version_id);
    const implementations=(av.payload.implementation_bindings||[]).map(binding=>{
      const deployed=checked.get(binding.path);
      if(binding.status==='verified' && deployed) {
        const expected=binding.content_sha256 || binding.digest?.replace(/^sha256:/,'');
        if(binding.repo!==manifest.source_repo || binding.revision!==manifest.source_commit || expected!==deployed.actual_content_sha256) throw Error(`实现binding digest或来源不符: ${binding.path}`);
        return {...binding,execution_verification:'verified_local',actual_content_sha256:deployed.actual_content_sha256,execution_path:`runtime/${deployed.deployed_path}`};
      }
      return {...binding,execution_verification:'unknown',execution_reason:'not_verified_on_execution_host'};
    });
    const entry=av.payload.contract.runtime?.entry;
    if(entry && !implementations.some(b=>b.execution_verification==='verified_local' && b.path===`services/phone-adb-controller/${entry}`)) throw Error(`运行入口没有本机已核验binding: ${entry}`);
    activities.push({reference:ref,version:av,implementations});
  }
  if(!activities.length) throw Error('运行工作流无活动');
  if(o.activityRefs && o.activityRefs.length!==activities.length) throw Error('部署活动引用数量与版本不同');
  if(o.activityRefs) for(const expected of o.activityRefs){
    const actual=activities.find(a=>a.reference.slot_key===expected.slot_key);
    if(!actual || actual.reference.sequence_no!==expected.sequence_no || actual.version.payload.definition_key!==expected.definition_key || actual.version.contract_sha256!==expected.contract_sha256) throw Error('部署计划活动引用与版本不同');
  }
  const files={'workflow.plan':digest(plan),'step-dod.json':digest(steps)};
  for(const file of checked.values()) files[`runtime/${file.deployed_path}`]=file.actual_content_sha256;
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2));
  if(files['runtime/deployment-manifest.json'])throw Error('源码不能占用冻结部署声明路径');
  files['runtime/deployment-manifest.json']=digest(manifestBytes);
  if(o.collectionPhoneScope&&(o.collectionPhoneScope.source_commit!==manifest.source_commit||o.collectionPhoneScope.target!==manifest.target))throw Error('collection phone scope部署来源不符');
  if(o.discoveryPhoneScope&&(o.discoveryPhoneScope.source_commit!==manifest.source_commit||o.discoveryPhoneScope.target!==manifest.target||o.workflowKey!=='douyin_video_discovery'))throw Error('discovery phone scope部署来源不符');
  const body={schema_version:fixed?2:1,...(fixed?{release:fixed.release}:{}),workflow_version:version,activities,deployment:manifest,files,
    ...(o.discoveryInput?{discovery_input:structuredClone(o.discoveryInput)}:{}),...(o.discoveryPhoneScope?{discovery_phone_scope:structuredClone(o.discoveryPhoneScope)}:{}),...(o.collectionPhoneScope?{collection_phone_scope:structuredClone(o.collectionPhoneScope)}:{}),...(o.runtimeTransport?{runtime_transport:o.runtimeTransport}:{}),...(o.samplingInput?{sampling_input:o.samplingInput}:{}),...(o.producerDescriptor?{producer_descriptor:structuredClone(o.producerDescriptor)}:{}),...(o.runIdentity?{run_identity:o.runIdentity}:{})};
  if(o.runIdentity)assertRunIdentity(body,o.runIdentity);
  const snapshot={...body,snapshot_sha256:digest(body)};
  const staging=`${o.runDir}.freeze-${randomUUID()}`; mkdirSync(staging,{recursive:true,mode:0o700});
  try {
    for(const file of checked.values()){
      const target=resolve(staging,'runtime',file.deployed_path);mkdirSync(dirname(target),{recursive:true});
      writeFileSync(target,file.bytes,{mode:file.mode});
    }
    writeFileSync(resolve(staging,'runtime/deployment-manifest.json'),manifestBytes,{mode:0o600});
    writeFileSync(resolve(staging,'workflow.plan'),plan);writeFileSync(resolve(staging,'step-dod.json'),steps);
    writeFileSync(resolve(staging,'run-definition.json'),JSON.stringify(snapshot,null,2));
    assertDeploymentAdmission(o.deploymentRoot);
    if(!readFileSync(manifestPath).equals(originalManifest))throw Error('冻结期间部署声明发生变化');
    mkdirSync(dirname(o.runDir),{recursive:true}); renameSync(staging,o.runDir);
  } finally {rmSync(staging,{recursive:true,force:true});}
  return snapshot;
}
