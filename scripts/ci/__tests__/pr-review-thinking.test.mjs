import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';

const path=new URL('../../../.github/workflows/pr-review.yml',import.meta.url);
test('真实CI请求关闭DeepSeek推理并给最终审查留足输出，拒绝仅推理内容',()=>{
 const workflow=YAML.parse(readFileSync(path,'utf8'));
 const step=workflow.jobs['deepseek-review'].steps.find(s=>s.id==='ai-review');
 const fragment=step.run.match(/jq -n([\s\S]*?)\n\s*\)"/);
 assert.ok(fragment,'验证CI真正发送的jq请求');
 const built=spawnSync('bash',['-c','jq -n'+fragment[1]],{encoding:'utf8',env:{...process.env,SYSTEM_PROMPT:'审查代码',USER_PROMPT:'diff --git a/a.py b/a.py'}});
 assert.equal(built.status,0,built.stderr);
 const request=JSON.parse(built.stdout);
 assert.equal(request.model,'deepseek-v4-flash');
 assert.deepEqual(request.thinking,{type:'disabled'});
 assert.ok(request.max_tokens>=4096,'900 token曾全部被推理耗尽，最终答案为空');
 assert.equal(request.enable_thinking,undefined,'旧字段会被上游忽略');
 assert.ok(step.run.includes('.choices[0].message.content // empty'));
 assert.ok(step.run.includes('exit 1'),'空结果仍应失败，不把reasoning当作审查通过');
});
