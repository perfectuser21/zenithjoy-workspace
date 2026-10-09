// 部署前证据核验；HTTP只创建不可变发布声明，不触及目标机器。
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {digest} from './runtime-definition.mjs';
export const DEPLOY_REPO='perfectuser21/zenithjoy-workspace';
export const DEPLOY_HOSTS=['xian-m4','mmv'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{40}$/;
export const WORKFLOWS=[101,102,103,104].map(n=>`b1000000-0000-4000-8000-${String(n).padStart(12,'0')}`);
const requireThat=(ok,message)=>{if(!ok)throw Error(`部署预检: ${message}`);};
const equal=(a,b)=>digest(a)===digest(b);
const key=c=>`${c.kind}:${c.repo}:${c.path||''}`;
function componentsFor(definitions,sha){
 requireThat(Array.isArray(definitions?.workflows)&&Array.isArray(definitions?.activities),'缺固定定义');
 requireThat(definitions.workflows.length===WORKFLOWS.length&&WORKFLOWS.every(id=>definitions.workflows.filter(w=>w.workflow_id===id&&w.payload?.workflow_id===id).length===1),'缺四流程唯一Workflow');
 const all=[...definitions.workflows,...definitions.activities],components=new Map();
 const add=c=>{const old=components.get(key(c));requireThat(!old||equal(old,c),'组件身份冲突');components.set(key(c),c);};
 for(const row of all){
  requireThat(UUID.test(row.id)&&row.source_repo===DEPLOY_REPO&&row.source_commit===sha,'定义来源SHA不符');
  requireThat(row.payload_sha256===digest({source:{repo:row.source_repo,path:row.source_path,commit:row.source_commit},payload:row.payload}),'定义摘要不符');
  add({kind:'repo',repo:row.source_repo,revision:row.source_commit});
 }
 const refs=definitions.workflows.flatMap(w=>w.payload.activities||[]),referenced=new Set(refs.map(r=>r.activity_version_id));
 requireThat(referenced.size>0&&definitions.activities.length===referenced.size&&new Set(definitions.activities.map(a=>a.id)).size===referenced.size,'Activity版本集合不完整');
 for(const ref of refs)requireThat(definitions.activities.some(a=>a.id===ref.activity_version_id&&a.activity_id===ref.activity_id&&a.payload.activity_id===ref.activity_id),'Activity引用身份不符');
 for(const a of definitions.activities){
  requireThat(Array.isArray(a.payload.implementation_bindings)&&a.payload.implementation_bindings.length>0,'缺实现绑定');
  for(const b of a.payload.implementation_bindings){
   // raw是规范化保留的来源描述，不是可执行组件，不能被伪标为已核验。
   if(b.kind==='raw'&&b.status==='unresolved')continue;
   requireThat(['code','skill'].includes(b.kind)&&b.status==='verified'&&b.repo===DEPLOY_REPO&&b.revision===sha&&/^sha256:[0-9a-f]{64}$/.test(b.digest||''),'实现绑定未核验');
   requireThat(typeof b.path==='string'&&!b.path.startsWith('/')&&!b.path.includes('\\')&&!b.path.split('/').some(p=>['.','..',''].includes(p)),'组件路径无效');
   add({kind:b.kind,repo:b.repo,path:b.path,revision:b.revision,digest:b.digest});
  }
  requireThat(a.payload.implementation_bindings.some(b=>b.scope==='activity'&&['code','skill'].includes(b.kind)&&b.status==='verified'),'缺Activity固定实现');
 }
 return [...components.values()].sort((a,b)=>key(a).localeCompare(key(b)));
}
export function validateDeploymentEvidence(bundle,sha,readFile){
 requireThat(SHA.test(sha),'DEPLOY_SHA必须固定');
 const {snapshot,report,receipt}=bundle||{};
 requireThat(snapshot?.schema_version===1&&snapshot.scope==='zenithjoy'&&snapshot.repo===DEPLOY_REPO&&snapshot.revision===sha&&snapshot.status==='verified'&&Array.isArray(snapshot.gaps)&&snapshot.gaps.length===0,'快照来源/状态不符');
 const {snapshot_sha256,...body}=snapshot;requireThat(snapshot_sha256===digest(body),'快照摘要不符');
 const components=componentsFor(snapshot.definitions,sha);
 requireThat(report?.protocol==='pilot_release_verification_v1'&&report.purpose==='release_verification'&&report.scope==='zenithjoy'&&report.source?.repo===DEPLOY_REPO&&report.source.head_revision===sha&&report.verification_status==='verified'&&Array.isArray(report.gaps)&&report.gaps.length===0,'CI来源或状态未核验');
 requireThat(equal(Object.keys(report.source).sort(),['head_revision','repo'])&&report.snapshot_sha256===snapshot_sha256&&report.assertion_source==='current_registration','CI不是本次完整试点发布证据');
 const plan=Object.fromEntries(['scope','source','definition_versions','expected_usages','required_assertions','assertion_source'].map(k=>[k,report[k]]));
 requireThat(Array.isArray(report.expected_usages)&&report.expected_usages.length>0&&report.assertion_plan_sha256===digest(plan),'完整回归计划摘要不符');
 requireThat(receipt?.purpose==='release_verification'&&receipt.actor==='pilot_release_verification'&&receipt.verdict==='PASS'&&receipt.scope==='declared_pilot_regressions'&&receipt.business_runtime_status==='not_evaluated'&&receipt.snapshot_sha256===snapshot_sha256&&receipt.assertion_plan_sha256===report.assertion_plan_sha256&&equal(receipt.source,report.source)&&receipt.report_sha256===digest(Buffer.from(JSON.stringify(report))),'CI回执未核验');
 requireThat(Array.isArray(report.required_assertions)&&report.required_assertions.length>0&&Array.isArray(receipt.assertions)&&receipt.assertions.length>0,'缺真实回归断言');
 requireThat(receipt.assertions.every(a=>a.source_repo===DEPLOY_REPO&&a.source_revision===sha&&a.exit_code===0&&!a.error&&!a.signal&&/^[0-9a-f]{64}$/.test(a.test_sha256||'')),'回归执行证据不符');
 for(const kind of ['workflows','activities'])requireThat(Array.isArray(report.definition_versions?.[kind])&&snapshot.definitions[kind].every(row=>report.definition_versions[kind].some(r=>r.id===row.id&&r.payload_sha256===row.payload_sha256&&r.source_repo===row.source_repo&&r.source_commit===row.source_commit)),'CI不覆盖完整固定定义');
 for(const c of components.filter(c=>c.kind!=='repo'))requireThat('sha256:'+digest(readFile(c.path))===c.digest,'本机部署组件字节不符');
 return {definitions:snapshot.definitions,components};
}
function verifyRelease(release,{id,environment,target,manifest}){
 requireThat(release&&release.id===id&&UUID.test(id),'release不存在或ID不符');
 requireThat(release.environment===environment&&release.target===target,'release目标或环境不符');
 requireThat(release.manifest_sha256===digest({environment:release.environment,target:release.target,payload:release.payload}),'release摘要不符');
 requireThat(release.payload?.verification?.status==='verified','release定义或CI仍unknown');
 requireThat(manifest.source_repo===DEPLOY_REPO&&SHA.test(manifest.source_commit),'部署manifest来源无效');
 const components=componentsFor(release.payload,manifest.source_commit);
 requireThat(Array.isArray(release.payload.components)&&equal([...release.payload.components].sort((a,b)=>key(a).localeCompare(key(b))),components),'release组件与冻结定义不符');
 for(const c of components.filter(c=>c.kind!=='repo'))requireThat(manifest.files.some(f=>f.path===c.path&&`sha256:${f.content_sha256}`===c.digest),'release组件无本机固定字节');
 return release;
}
export async function preflightDeploymentReleases({manifest,environment,releaseIds,request}){
 requireThat(typeof environment==='string'&&environment.length>0,'缺部署环境');
 requireThat(releaseIds&&equal(Object.keys(releaseIds).sort(),[...DEPLOY_HOSTS].sort())&&DEPLOY_HOSTS.every(h=>UUID.test(releaseIds[h])),`必须明确全部${DEPLOY_HOSTS.length}目标release`);
 const releases=[];
 for(const target of DEPLOY_HOSTS){const id=releaseIds[target],response=await request(`/api/brain/releases/${id}`);releases.push(verifyRelease(response?.release,{id,environment,target,manifest}));}
 return releases;
}
export async function prepareDeploymentReleases({bundle,sha,environment,attemptKey,readFile,request}){
 const {definitions,components}=validateDeploymentEvidence(bundle,sha,readFile);
 requireThat(environment==='production'&&typeof attemptKey==='string'&&/^github:\d+:[\w:.-]+$/.test(attemptKey),'部署环境/attempt无效');
 const releaseIds={};
 const manifest={source_repo:DEPLOY_REPO,source_commit:sha,files:components.filter(c=>c.kind!=='repo').map(c=>({path:c.path,content_sha256:c.digest.slice(7)}))};
 for(const target of DEPLOY_HOSTS){
  const input={release_key:`phone-adb:${sha}:${target}:${attemptKey.split(':')[1]}:${digest(bundle.report)}`,environment,target,actor:'phone-adb-deployer',
   workflows:definitions.workflows.map(w=>({workflow_definition_version_id:w.id,payload_sha256:w.payload_sha256})),components,
   ci_evidence:[{report:bundle.report,receipt:bundle.receipt,evidence_ref:`https://github.com/${DEPLOY_REPO}/actions/runs/${attemptKey.split(':')[1]}`}]};
  const response=await request('/api/brain/releases',input),release=response?.release;
  verifyRelease(release,{id:release?.id,environment,target,manifest});
  requireThat(equal(release.payload.workflows.map(w=>[w.id,w.payload_sha256]).sort(),definitions.workflows.map(w=>[w.id,w.payload_sha256]).sort()),'Brain返回其他固定版本');
  releaseIds[target]=release.id;
 }
 await preflightDeploymentReleases({manifest,environment,releaseIds,request});return releaseIds;
}
export function readDeploymentToken(path){
 const stat=lstatSync(path);requireThat(stat.isFile()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0,'凭据镜像权限无效');
 const lines=readFileSync(path,'utf8').split(/\r?\n/).filter(l=>/^\s*(?:export\s+)?CECELIA_INTERNAL_TOKEN\s*=/.test(l));
 requireThat(lines.length===1,'缺唯一CECELIA_INTERNAL_TOKEN');
 const raw=lines[0].replace(/^\s*(?:export\s+)?CECELIA_INTERNAL_TOKEN\s*=\s*/,'').trim();
 const token=/^(['"])(.*)\1$/.exec(raw)?.[2]??raw;
 requireThat(/^[A-Za-z0-9_.~+/=-]{8,}$/.test(token),'凭据镜像格式无效');return token;
}
export function brainRequest(base,token){
 const url=new URL(base);requireThat(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&token,'Brain地址/凭据未配置');
 return async(path,body)=>{const response=await fetch(new URL(path,url),{method:body?'POST':'GET',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});requireThat(response.ok,`Brain HTTP ${response.status}`);return response.json();};
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 try{await preflightDeploymentReleases({manifest:JSON.parse(readFileSync(process.argv[2],'utf8')),environment:process.env.WF_DEPLOY_ENVIRONMENT,releaseIds:JSON.parse(process.env.WF_RELEASE_IDS||'{}'),request:brainRequest(process.env.BRAIN_URL,process.env.BRAIN_INTERNAL_TOKEN)});}
 catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}
}
