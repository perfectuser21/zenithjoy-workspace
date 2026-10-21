// 隔离HTTP/Git fixture：原文与预期条目显式定义，不使用生产解析器来构造预期。
import {digest} from '../../runtime-definition.mjs';
const sections=[['输入与交付','输入公司与批准范围。'],['执行','1. 原生身份核验。'],['执行','2. 真实持久读回。'],['原实现的数据外发与调用记录','记录调用。'],['Commander 与接手','仅原范围接手。'],['验收','独立核验。'],['冻结来源绑定','保持原来源。']];
export function fixtureSkill(n){return `---\nname: douyin-leadgen-${n}\n---\n# ${n}\n\n`+sections.map(([heading,text],i)=>(i===2?'':`## ${heading}\n\n`)+text+'\n\n').join('');}
export function fixtureSkillTasks({n,taskId,proof,sha}){
 const b=proof.binding,key=proof.workflow.payload.key,skill={path:`services/phone-adb-controller/skills/douyin-leadgen-${n}/SKILL.md`,sha256:digest(fixtureSkill(n))};
 const checks=sections.map(([section,text])=>({id:digest(section+'\n'+text),section,text}));
 const execution={status:'completed',id:taskId.replace(/^a/,'b'),description:'已批准公司同城筛选；禁止额外发送。',payload:{inputs:{location:'same_city',limit:2}},result:{run_id:b.run_id,source_commit:sha}};
 const v={task_id:taskId,execution_task_id:execution.id,run_id:b.run_id,run_binding_id:b.id,workflow_definition_version_id:proof.workflow.id,source_commit:sha,definition_sha256:proof.workflow.payload_sha256,scope:'full_skill',verdict:'PASS',skill,acceptance_definition_sha256:digest({schema_version:1,workflow_key:key,skill,checks}),task_scope_sha256:digest({execution_task_id:execution.id,description:execution.description,payload:execution.payload}),assertions:[...checks.map(c=>c.id),'task_scope'].map(id=>({id,pass:true,evidence:['fixture://'+b.run_id+'/'+id]})),evidence:['fixture://'+b.run_id+'/report']};
 return [execution,{id:taskId,status:'completed',result:{workflow_control:{phase:'final',envelope:{definition:b},verification:v}}}];
}
