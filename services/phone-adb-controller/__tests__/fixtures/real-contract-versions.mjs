// 测试身份明确为确定性fixture UUID；正式登记必须由Brain读取真实UUID。
// 契约/plan/entry直接读取当前固定git提交，不执行entry，不调用设备或业务网络。
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir,hostname} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';
import {digest,freezeDefinition} from '../../runtime-definition.mjs';
import {deploymentTarget} from '../../runtime-host.mjs';
export const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
export const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const sourceRepo='perfectuser21/zenithjoy-workspace';
const file=path=>execFileSync('git',['show',`${sha}:${path}`],{cwd:root,encoding:'utf8'});
const uuid=key=>{const h=digest(`fixture-only:${key}`);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const docs=new Map();
function document(cap){if(!docs.has(cap))docs.set(cap,parse(file(`product-map/contracts/${cap}.yaml`)));return docs.get(cap);}
export function sourceSteps(cap){
 return document(cap).activities.flatMap((usage,index)=>{
  const [owner,key]=usage.ref?usage.ref.split('.'):[cap,usage.key];
  const activity=document(owner).activities.find(a=>a.key===key&&!a.ref);
  if(!activity)throw Error(`真实契约ref无法解析: ${owner}.${key}`);
  return activity.steps.map(step=>({workflow:cap,owner,slot:key,sequence:index+1,activity,step,key:`${owner}.${key}.${step.key}`}));
 });
}
function version(id,payload,cap){
 const source={repo:sourceRepo,path:`product-map/contracts/${cap}.yaml`,commit:sha};
 return {id,source_repo:source.repo,source_path:source.path,source_commit:sha,payload,
  contract_sha256:digest(payload.contract),payload_sha256:digest({source,payload})};
}
export async function realContractFixture(cap){
 const directory=mkdtempSync(join(tmpdir(),'real-contract-protocol-'));
 const doc=document(cap),expected=sourceSteps(cap),files=new Map(),versions=[];
 const put=(path,bytes)=>{
  const deployed=path.replace(/^services\/phone-adb-controller\//,'');
  const target=join(directory,deployed);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);
  files.set(path,{path,deployed_path:deployed,content_sha256:digest(bytes)});
 };
 const activities=doc.activities.map((usage,index)=>{
  const [owner,key]=usage.ref?usage.ref.split('.'):[cap,usage.key];
  const contract=document(owner).activities.find(a=>a.key===key&&!a.ref);
  const id=uuid(`activity:${owner}.${key}`),versionId=uuid(`av:${sha}:${owner}.${key}`);
  const bindingPath=`services/phone-adb-controller/${contract.runtime.entry}`;
  put(bindingPath,file(bindingPath));
  const payload={activity_id:id,definition_key:`${owner}.${key}`,contract,
   steps:contract.steps.map(step=>({step_id:uuid(`step:${owner}.${key}.${step.key}`),locator:{activity_id:id,step_key:step.key},contract:step})),
   implementation_bindings:[{kind:'code',scope:'activity',status:'verified',validation_scope:'reference_only',repo:sourceRepo,path:bindingPath,revision:sha,content_sha256:files.get(bindingPath).content_sha256}]};
  versions.push(version(versionId,payload,owner));
  return {reference_id:uuid(`ref:${cap}:${key}`),slot_key:key,sequence_no:index+1,activity_id:id,activity_version_id:versionId};
 });
 const workflow=version(uuid(`wv:${sha}:${cap}`),{workflow_id:uuid(`workflow:${cap}`),key:doc.brain_workflow_key,contract:doc,activities},cap);
 const stepsPath=`services/phone-adb-controller/plans/${cap}.steps.json`,planPath=`services/phone-adb-controller/plans/${cap}.plan`;
 put(stepsPath,file(stepsPath));put(planPath,file(planPath));
 const spec=JSON.parse(file(stepsPath));
 const release={id:uuid(`release:${sha}:${cap}`),environment:'fixture-only',target:deploymentTarget(hostname()),payload:{schema_version:1,workflows:[workflow],activities:versions}};
 release.manifest_sha256=digest({environment:release.environment,target:release.target,payload:release.payload});
 const manifest={source_repo:sourceRepo,source_commit:sha,release_id:release.id,observation_id:uuid(`fixture-observation:${cap}`),environment:release.environment,target:release.target,files:[...files.values()]};
 writeFileSync(join(directory,'deployment-manifest.json'),JSON.stringify(manifest));
 const requests=[];
 const options={requireRelease:true,runDir:join(directory,'run'),deploymentRoot:directory,workflowKey:doc.brain_workflow_key,rawContractSha256:workflow.contract_sha256,
  planPath:join(directory,'plans',`${cap}.plan`),stepSpecPath:join(directory,'plans',`${cap}.steps.json`),
  get:async path=>{requests.push(path);if(path!==`/api/brain/releases/${release.id}`)throw Error('禁止current/latest补全');return {release:structuredClone(release)};}};
 const frozen=await freezeDefinition(options);
 return {directory,expected,release,workflow,frozen,spec,options,requests,close:()=>rmSync(directory,{recursive:true,force:true})};
}
