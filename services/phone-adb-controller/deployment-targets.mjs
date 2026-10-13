// 同一目标只有一个完整release；不同安装根是同一个ACK的本机视图。
import {readFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {digest} from './runtime-definition.mjs';
import {DEPLOY_REPO,WORKFLOWS,validateDeploymentEvidence,brainRequest} from './deployment-preflight.mjs';
const extraKeys=['workflow_report.internal','workflow_commander.internal','douyin_video_publish.android'];
const need=(v,m)=>{if(!v)throw Error('统一部署: '+m);};
const same=(a,b)=>digest(a)===digest(b);
const rowHash=r=>digest({source:{repo:r.source_repo,path:r.source_path,commit:r.source_commit},payload:r.payload});
export function bindingComponents(definitions,sha){
 const entries=new Map([['repo',{kind:'repo',repo:DEPLOY_REPO,revision:sha}]]);
 for(const a of definitions.activities){
  need(a.payload.implementation_bindings?.some(b=>b.scope==='activity'&&['code','skill'].includes(b.kind)&&b.status==='verified'),'缺Activity固定入口');
  for(const b of a.payload.implementation_bindings){
   if(b.kind==='raw'&&b.status==='unresolved')continue;
   need(['code','skill'].includes(b.kind)&&b.status==='verified'&&b.repo===DEPLOY_REPO&&b.revision===sha&&/^sha256:[0-9a-f]{64}$/.test(b.digest||'')&&typeof b.path==='string'&&!b.path.startsWith('/')&&!b.path.includes('\\')&&!b.path.split('/').some(x=>['.','..',''].includes(x)),'固定binding无效');
   const value={kind:b.kind,repo:b.repo,path:b.path,revision:b.revision,digest:b.digest},key=b.kind+':'+b.path;
   need(!entries.has(key)||same(entries.get(key),value),'binding同路径冲突');entries.set(key,value);
  }
 }
 return [...entries.values()].sort((a,b)=>`${a.kind}:${a.path||''}`.localeCompare(`${b.kind}:${b.path||''}`));
}
function checkScope(e,scope,sha){
 const {snapshot:s,report:r,receipt:c}=e||{};
 need(s?.scope===scope&&s.repo===DEPLOY_REPO&&s.revision===sha&&s.status==='verified'&&Array.isArray(s.gaps)&&!s.gaps.length,'缺同SHA完整'+scope+'快照');
 const {snapshot_sha256,...body}=s;need(snapshot_sha256===digest(body),'快照摘要不符');
 const defs=s.definitions;need(defs?.workflows?.length&&defs.activities?.length,'空定义');
 for(const kind of ['workflows','activities']){need(new Set(defs[kind].map(x=>x.id)).size===defs[kind].length,'重复定义');for(const row of defs[kind])need(row.source_repo===DEPLOY_REPO&&row.source_commit===sha&&row.payload_sha256===rowHash(row),'定义来源漂移');}
 need(r?.protocol==='pilot_release_verification_v1'&&r.purpose==='release_verification'&&r.scope===scope&&same(r.source,{repo:DEPLOY_REPO,head_revision:sha})&&r.verification_status==='verified'&&Array.isArray(r.gaps)&&!r.gaps.length&&r.snapshot_sha256===snapshot_sha256&&r.assertion_source==='current_registration','完整CI来源不符');
 const plan=Object.fromEntries(['scope','source','definition_versions','expected_usages','required_assertions','assertion_source'].map(k=>[k,r[k]]));
 need(r.expected_usages?.length&&r.assertion_plan_sha256===digest(plan),'CI计划摘要不符');
 for(const kind of ['workflows','activities'])need(Array.isArray(r.definition_versions?.[kind])&&new Set(r.definition_versions[kind].map(x=>x.id)).size===r.definition_versions[kind].length&&defs[kind].every(w=>r.definition_versions[kind].some(v=>v.id===w.id&&v.payload_sha256===w.payload_sha256&&v.source_repo===w.source_repo&&v.source_commit===w.source_commit)),'报告缺冻结定义');
 need(c?.purpose==='release_verification'&&c.actor==='pilot_release_verification'&&c.scope==='declared_pilot_regressions'&&c.business_runtime_status==='not_evaluated'&&c.verdict==='PASS'&&same(c.source,r.source)&&c.snapshot_sha256===snapshot_sha256&&c.assertion_plan_sha256===r.assertion_plan_sha256&&c.report_sha256===digest(Buffer.from(JSON.stringify(r))),'CI receipt不符');
 need(r.required_assertions?.length&&c.assertions?.length===r.required_assertions.length&&new Set(c.assertions.map(x=>x.assertion_ref)).size===c.assertions.length,'完整receipt断言缺失/重复');
 for(const a of r.required_assertions)need(c.assertions.some(v=>v.assertion_ref===a.assertion_ref&&v.source_repo===DEPLOY_REPO&&v.source_revision===sha&&v.exit_code===0&&!v.error&&!v.signal&&/^[a-f0-9]{64}$/.test(v.test_sha256||'')&&same(v.source_bindings,a.source_bindings)),'完整receipt断言失败');
 return defs;
}
function subset(definitions,workflows){
 const refs=workflows.flatMap(w=>w.payload.activities||[]),ids=new Set(refs.map(r=>r.activity_version_id));
 const activities=definitions.activities.filter(a=>ids.has(a.id));
 need(ids.size&&activities.length===ids.size&&refs.every(r=>activities.some(a=>a.id===r.activity_version_id&&a.activity_id===r.activity_id&&a.payload.activity_id===r.activity_id)),'活动依赖闭包缺失');return{workflows,activities};
}
export function targetDefinitions(bundle,sha,readFile){
 validateDeploymentEvidence(bundle,sha,readFile);
 const scopes=[checkScope(bundle,'zenithjoy',sha),checkScope(bundle.commander,'commander-generic',sha)],all={workflows:[],activities:[]};
 for(const kind of ['workflows','activities']){const rows=new Map();for(const defs of scopes)for(const row of defs[kind]){need(!rows.has(row.id)||same(rows.get(row.id),row),'同ID跨scope冻结冲突');rows.set(row.id,row);}all[kind]=[...rows.values()];}
 const legacy=all.workflows.filter(w=>WORKFLOWS.includes(w.workflow_id));need(legacy.length===4,'缺旧四流程');
 const extras=extraKeys.map(key=>{const found=all.workflows.filter(w=>w.payload.key===key);need(found.length===1,'缺或重复Commander workflow: '+key);return found[0];});
 const mmv=subset(all,[...legacy,...extras]);need(new Set(mmv.workflows.map(w=>w.workflow_id)).size===7,'MMV七流程身份冲突');
 const result={};for(const [target,definitions]of [['xian-m4',subset(all,legacy)],['mmv',mmv]]){
  const components=bindingComponents(definitions,sha);for(const c of components.filter(c=>c.kind!=='repo'))need('sha256:'+digest(readFile(c.path))===c.digest,'实际源码binding漂移');result[target]={definitions,components};
 }return result;
}
export function commanderMap(release){
 const workflows={};for(const w of release.payload.workflows){const key=w.payload.key;need(key&&!workflows[key],'冻结workflow key为空/重复');workflows[key]={snapshot_sha256:w.payload_sha256};}return{[release.id]:{workflows}};
}
export function verifyTargetRelease(release,target,sha,expected){
 need(release?.target===target&&release.environment==='production'&&release.payload?.verification?.status==='verified'&&release.manifest_sha256===digest({environment:release.environment,target:release.target,payload:release.payload}),'正式release目标/摘要/状态错误');
 need(same(release.payload.components,bindingComponents(release.payload,sha)),'release组件不等于完整bindings');
 for(const r of [...release.payload.workflows,...release.payload.activities])need(r.source_repo===DEPLOY_REPO&&r.source_commit===sha&&r.payload_sha256===rowHash(r),'正式release冻结摘要/来源不符');
 const rows=release.payload.workflows;need(rows.filter(w=>WORKFLOWS.includes(w.workflow_id)).length===4&&rows.length===(target==='mmv'?7:4),'release缺完整目标闭包');
 if(target==='mmv')for(const key of extraKeys)need(rows.filter(w=>w.payload.key===key).length===1,'release缺Commander身份');
 if(expected)need(same([...rows].sort((a,b)=>a.id.localeCompare(b.id)),[...expected.definitions.workflows].sort((a,b)=>a.id.localeCompare(b.id)))&&same([...release.payload.activities].sort((a,b)=>a.id.localeCompare(b.id)),[...expected.definitions.activities].sort((a,b)=>a.id.localeCompare(b.id))),'Brain回了其它冻结版本');return release;
}
export async function prepareTargetReleases({bundle,sha,attemptKey,readFile,request}){
 need(/^github:\d+:[\w:.-]+$/.test(attemptKey),'固定attempt无效');const targets=targetDefinitions(bundle,sha,readFile),releases={};
 for(const target of ['xian-m4','mmv']){
  const {definitions,components}=targets[target],evidence=target==='mmv'?[bundle,bundle.commander]:[bundle];
  const input={release_key:`phone-adb-unified:${sha}:${target}:${attemptKey.split(':')[1]}:${digest(evidence.map(e=>e.report))}`,environment:'production',target,actor:'phone-adb-deployer',workflows:definitions.workflows.map(w=>({workflow_definition_version_id:w.id,payload_sha256:w.payload_sha256})),components,ci_evidence:evidence.map(e=>({report:e.report,receipt:e.receipt,evidence_ref:`https://github.com/${DEPLOY_REPO}/actions/runs/${attemptKey.split(':')[1]}`}))};
  const release=(await request('/api/brain/releases',input)).release;verifyTargetRelease(release,target,sha,targets[target]);releases[target]=release;
 }
 for(const target of Object.keys(releases)){const row=(await request('/api/brain/releases/'+releases[target].id)).release;need(same(row,releases[target]),'正式release回读变化');}
 return{source_repo:DEPLOY_REPO,source_commit:sha,release_ids:Object.fromEntries(Object.entries(releases).map(([k,r])=>[k,r.id])),releases,commander_releases:commanderMap(releases.mmv)};
}
export function localManifestView(local,ack){
 need(local.source_repo===ack.source_repo&&local.source_commit===ack.source_commit&&ack.release_id&&ack.observation_id,'安装视图与唯一ACK来源不符');
 return{...local,release_id:ack.release_id,observation_id:ack.observation_id,environment:ack.environment,target:ack.target};
}
export async function verifyDeploymentPlan(plan,request){
 need(/^[0-9a-f]{40}$/.test(plan?.source_commit||'')&&plan.source_repo===DEPLOY_REPO&&same(Object.keys(plan.release_ids||{}).sort(),['mmv','xian-m4']),'部署计划身份无效');
 for(const target of ['xian-m4','mmv']){const row=(await request('/api/brain/releases/'+plan.release_ids[target])).release;verifyTargetRelease(row,target,plan.source_commit);need(same(row,plan.releases[target]),'部署计划不是正式release原件');}
 need(same(plan.commander_releases,commanderMap(plan.releases.mmv)),'Commander map不是完整MMV release');return plan;
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 try{const plan=JSON.parse(readFileSync(process.argv[2]));need(process.argv[3]===plan.source_commit,'部署源码HEAD与计划不同');await verifyDeploymentPlan(plan,brainRequest(process.env.BRAIN_URL,process.env.BRAIN_INTERNAL_TOKEN));need(same(JSON.parse(readFileSync(process.env.WF_COMMANDER_RELEASES_FILE)),plan.commander_releases),'实际map文件与计划不同');}
 catch(e){console.error(e.message);process.exitCode=1;}
}
