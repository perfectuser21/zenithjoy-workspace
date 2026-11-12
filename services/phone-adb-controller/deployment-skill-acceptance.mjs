// 从候选固定 Skill 原文提取验收要求；不维护第二份业务规则或接受调用方自报 PASS。
import {digest} from './runtime-definition.mjs';
const need=(ok,message)=>{if(!ok)throw Error('业务发布准入: 独立验收 Skill '+message);};
const skills={douyin_video_discovery:'101',douyin_video_processing:'102',douyin_comment_scoring:'103',douyin_lead_outreach:'104'};
const inputs=['输入与交付','输入与输出'];
const commanders=['Commander 与接手','Commander 与中断恢复','Commander 与Skill接手','Commander 接手与验收'];
const acceptance=['验收与记录','验收','Commander 接手与验收'];
const excluded=['Activity 方法配套'];
const conditional=['复用已有Skill','纯 Skill 执行选择','调用范围与当前接口','单Activity受控接手','冻结来源绑定','同run有界Agent恢复合同'];
export const requiresSkillAcceptance=key=>Object.hasOwn(skills,key);
// Workflow目录的验收真身是该固定索引和它逐项点名的Activity方法，不能只验目录。
function indexedAcceptance(key,path,bytes,text,readFile){
 const parseSections=(raw,allowed)=>{
  const body=raw.replace(/^---\n[\s\S]*?\n---\n/,'');
  const sections=[...body.matchAll(/^## ([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
  const names=sections.map(s=>s[1]);
  need(names.length===allowed.length&&new Set(names).size===names.length&&names.every(n=>allowed.includes(n)),'未知或重复规范段落');
  need(sections.every(s=>s[2].trim()&&!/^#{1,6} /m.test(s[2])),'规范段落为空或结构未知');return sections;
 };
 const checks=[];const add=(section,content)=>{
  const blocks=content.trim().split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);
  for(const block of blocks)checks.push({id:digest(section+'\n'+block),section,text:block});
 };
 for(const [,name,body]of parseSections(text,['活动组织','输入与交接','实现与状态','历史宿主兼容声明']))add('Workflow/'+name,body);
 const base=path.slice(0,path.lastIndexOf('/')),manifestPath=base+'/references/activity-methods.json',manifestBytes=readFile(manifestPath);
 let manifest;try{manifest=JSON.parse(Buffer.from(manifestBytes).toString('utf8'));}catch{need(false,'Activity清单无效');}
 need(manifest.workflow_key===key&&Array.isArray(manifest.activities)&&manifest.activities.length>0,'Activity清单身份无效');
 const declared=[...text.matchAll(/^\| `([a-z_]+)` \| \[(douyin-leadgen-activity-[a-z0-9-]+)\]\(\.\.\/\2\/SKILL\.md\) \| `(\d+\.\d+\.\d+)` \|$/gm)].map(m=>({activity:m[1],name:m[2],version:m[3]}));
 need(declared.length===manifest.activities.length&&new Set(declared.map(r=>r.name)).size===declared.length
   &&manifest.activities.every(row=>declared.some(d=>d.name===row.skill_name&&d.version===row.skill_version
     &&row.activity_ref?.split('.').at(-1)===d.activity)),'Activity清单与Workflow索引范围不一致');
 const seen=new Set(),activities=[];
 for(const row of manifest.activities){
  need(typeof row.skill_name==='string'&&/^douyin-leadgen-activity-[a-z0-9-]+$/.test(row.skill_name)
   &&row.skill_path===`services/phone-adb-controller/skills/${row.skill_name}/SKILL.md`
   &&typeof row.activity_ref==='string'&&!seen.has(row.activity_ref),'Activity来源无效或重复');seen.add(row.activity_ref);
  need(row.activity_ref.startsWith(key+'.')||key==='douyin_video_discovery'
    &&['douyin_video_processing.preflight','douyin_video_processing.cleanup'].includes(row.activity_ref),'Activity所属Workflow不符');
  const data=readFile(row.skill_path),body=Buffer.from(data).toString('utf8'),header=body.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  need(header&&new RegExp('^name: '+row.skill_name+'$','m').test(header)
   &&header.match(/^  version: (\S+)$/m)?.[1]===row.skill_version
   &&header.match(/^  activity_ref: (\S+)$/m)?.[1]===row.activity_ref
   &&/^  method_role: single-activity$/m.test(header),'Activity方法身份或版本不符');
  for(const [,name,content]of parseSections(body,['执行上下文与工具边界','输入与交付','操作',...(row.skill_name==='douyin-leadgen-activity-101-collect-videos'?['有界首屏输入']:row.skill_name==='douyin-leadgen-activity-102-dedup'?['明示producer交接']:[]),'成功条件','副作用','结果与验收','宿主恢复声明']))add(row.activity_ref+'/'+name,content);
  const supporting=[];
  for(const match of body.matchAll(/\]\((references\/[^)]+)\)/g)){
   const rel=match[1];need(/^references\/[a-z0-9-]+\.md$/.test(rel),'Activity支持文件路径无效');
   const supportPath=row.skill_path.slice(0,row.skill_path.lastIndexOf('/'))+'/'+rel;
   if(supporting.some(s=>s.path===supportPath))continue;
   const support=readFile(supportPath);need(Buffer.from(support).length>0,'Activity支持文件为空');supporting.push({path:supportPath,sha256:digest(support)});
   add(row.activity_ref+'/'+rel,Buffer.from(support).toString('utf8'));
  }
  activities.push({activity_ref:row.activity_ref,path:row.skill_path,sha256:digest(data),supporting});
 }
 need(checks.length>0&&new Set(checks.map(c=>c.id)).size===checks.length,'断言缺失或重复');
 return {schema_version:1,workflow_key:key,skill:{path,sha256:digest(bytes),manifest:{path:manifestPath,sha256:digest(manifestBytes)},activities},checks};
}
export function skillAcceptanceDefinition(key,readFile){
 need(requiresSkillAcceptance(key)&&typeof readFile==='function','缺固定原文读取器');
 const path=`services/phone-adb-controller/skills/douyin-leadgen-${skills[key]}/SKILL.md`;
 const bytes=readFile(path),text=Buffer.from(bytes).toString('utf8');
 need(text.startsWith('---\n')&&new RegExp(`^name: douyin-leadgen-${skills[key]}$`,'m').test(text),'原文身份/结构未知');
 if(/^  document_role: workflow-index$/m.test(text.match(/^---\n([\s\S]*?)\n---\n/)?.[1]||''))return indexedAcceptance(key,path,bytes,text,readFile);
 const body=text.replace(/^---\n[\s\S]*?\n---\n/,'');
 const sections=[...body.matchAll(/^## ([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
 const names=sections.map(x=>x[1]);
 need(new Set(names).size===names.length&&names.every(n=>[...inputs,'执行','原实现的数据外发与调用记录',...commanders,...acceptance,...conditional,...excluded].includes(n)),'未知或重复规范段落');
 need([inputs,['执行'],['原实现的数据外发与调用记录'],commanders,acceptance].every(group=>names.some(n=>group.includes(n))),'缺必备规范段落');
 const checks=[];
 for(const [,section,content]of sections){
  if(excluded.includes(section))continue;
  let blocks;
  if(section==='执行'){
   blocks=content.trim().split(/\n(?=\d+\. )/).map(s=>s.trim());
   need(blocks.length>0&&blocks.every((s,i)=>s.startsWith(`${i+1}. `)),'执行编号不完整');
  }else blocks=content.trim().split(/\n\s*\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('来源：'));
  need(blocks.length>0&&blocks.every(s=>!/^#{1,6} /m.test(s)),'规范段落为空或结构未知');
  for(const block of blocks)checks.push({id:digest(section+'\n'+block),section,text:block});
 }
 if(['102','103'].includes(skills[key]))need(names.includes('冻结来源绑定'),'缺冻结来源绑定授权要求');
 need(checks.length>0&&new Set(checks.map(c=>c.id)).size===checks.length,'断言缺失或重复');
 return {schema_version:1,workflow_key:key,skill:{path,sha256:digest(bytes)},checks};
}
// 只取原执行任务的请求字段；状态、result、heartbeat、lease 和进度不进入输入摘要。
export function executionTaskScope(task){
 need(typeof task?.description==='string'&&task.description.trim(),'原执行任务缺授权描述');
 const payload=task.payload||{};need(typeof payload==='object'&&!Array.isArray(payload),'原执行请求payload无效');
 const mutable=new Set(['progress','heartbeat_at','driver_heartbeat_at','lease_until','claimed_by','claimed_at']);
 return {execution_task_id:task.id,description:task.description,payload:Object.fromEntries(Object.entries(payload).filter(([key])=>!mutable.has(key)))};
}
export function verifyIndependentTask(task,{runId,expected,release,binding}){
 const control=task?.result?.workflow_control,v=control?.verification;
 need(task?.status==='completed'&&control?.phase==='final'&&v?.verdict==='PASS'
  &&v.task_id===task.id&&v.run_id===runId&&v.definition_sha256===expected.payload_sha256
  &&control.envelope?.definition?.release_id===release.id
  &&control.envelope.definition.runtime_snapshot_sha256===binding.runtime_snapshot_sha256
  &&Array.isArray(v.assertions)&&v.assertions.length>0&&v.assertions.every(a=>a.pass===true)
  &&Array.isArray(v.evidence)&&v.evidence.length>0,'未完整终态通过或身份不符');
 return v;
}
export async function verifyFullSkillTask({task,runId,sha,expected,release,binding,readFile,request}){
 need(/^[a-f0-9]{64}$/.test(binding.runtime_snapshot_sha256||''),'缺真实运行字节身份');
 const v=verifyIndependentTask(task,{runId,expected,release,binding});
 const definition=skillAcceptanceDefinition(expected.payload.key,readFile);
 need(v.scope==='full_skill'&&Array.isArray(v.missing)&&v.missing.length===0&&v.overreach==='无'&&v.source_commit===sha&&v.run_binding_id===binding.id
  &&v.workflow_definition_version_id===expected.id&&digest(v.skill)===digest(definition.skill)
  &&v.acceptance_definition_sha256===digest(definition),'范围/源码/冻结定义摘要不符');
 need(/^[a-f0-9-]{36}$/.test(v.execution_task_id||'')&&v.execution_task_id!==task.id,'缺原执行任务独立身份');
 const execution=await request('/api/brain/tasks/'+encodeURIComponent(v.execution_task_id));
 need(execution?.id===v.execution_task_id&&execution.status==='completed'&&execution.result?.run_id===runId
  &&(execution.result.source_commit||execution.result.commit)===sha,'原执行任务没有本run/源码真实关联');
 need(v.task_scope_sha256===digest(executionTaskScope(execution)),'原执行任务输入/授权已变化');
 const required=[...definition.checks.map(c=>c.id),'task_scope'];
 need(v.assertions.length===required.length&&new Set(v.assertions.map(a=>a.id)).size===required.length
  &&required.every(id=>v.assertions.some(a=>a.id===id&&a.pass===true&&a.result==='pass'&&(!Object.hasOwn(a,'status')||a.status==='pass')&&Array.isArray(a.evidence)&&a.evidence.length>0&&a.evidence.every(e=>typeof e==='string'&&e.trim()))),'断言不完整或缺逐项真实证据');
 return {acceptance_task_id:task.id,execution_task_id:execution.id,acceptance_report_sha256:digest(v),acceptance_definition_sha256:digest(definition),task_scope_sha256:v.task_scope_sha256};
}
