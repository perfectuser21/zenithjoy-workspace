import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const path=new URL('../../../.github/workflows/pr-review.yml',import.meta.url);
const source=readFileSync(path,'utf8');
const run=source.match(/id: ai-review[\s\S]*?run: \|([\s\S]*?)(?=\n      - name:|$)/)?.[1];
assert.ok(run,'实际审查步骤存在，测试只用Node内置模块');
test('真实CI请求使用已核OpenRouter固定模型关闭推理，保留4096最终输出预算',()=>{
 const fragment=run.match(/jq -n([\s\S]*?)\n\s*\)"/);
 assert.ok(fragment,'验证CI真正发送的jq请求');
 const built=spawnSync('bash',['-c','jq -n'+fragment[1]],{encoding:'utf8',env:{...process.env,SYSTEM_PROMPT:'审查代码',USER_PROMPT:'diff --git a/a.py b/a.py'}});
 assert.equal(built.status,0,built.stderr);
 const request=JSON.parse(built.stdout);
 assert.equal(request.model,'deepseek/deepseek-v4-flash');
 assert.deepEqual(request.reasoning,{enabled:false});
 assert.equal(request.max_tokens,4096);
 assert.equal(request.temperature,0.1);
 assert.equal(request.enable_thinking,undefined,'旧字段会被上游忽略');
 assert.equal(request.thinking,undefined,'OpenRouter使用统一reasoning参数');
 assert.equal(request.messages.length,2);
 assert.deepEqual(request.messages,[{role:'system',content:'审查代码'},{role:'user',content:'diff --git a/a.py b/a.py'}]);
});

// 隔离传输fixture：执行实际CI step.run，curl/sleep仅替换为临时目录程序；
// 唯一脚本文本替换是将固定/tmp结果文件映射到本用例目录，避免触碰机器原文件。
for(const row of [
 {name:'空正文',response:{choices:[{message:{content:''}}]},pass:false},
 {name:'仅reasoning',response:{choices:[{message:{reasoning:'fixture reasoning without final review'}}]},pass:false},
 {name:'额度错误不能冒审查',response:{error:{code:402,message:'fixture only'}},pass:false},
 {name:'真实最终字段有正文',response:{choices:[{message:{content:'fixture final review',reasoning:'fixture hidden reasoning'}}]},pass:true},
])test('实际审查step.run隔离fixture：'+row.name,()=>{
 const folder=mkdtempSync(join(tmpdir(),'pr-review-step-fixture-'));
 try{
  const bin=join(folder,'bin');mkdirSync(bin);
  const calls=join(folder,'calls.jsonl'),sleeps=join(folder,'sleep.jsonl'),response=join(folder,'response.json'),output=join(folder,'review-result.txt');
  writeFileSync(response,JSON.stringify(row.response));
  writeFileSync(join(bin,'curl'),'#!'+process.execPath+'\n'+`const fs=require('node:fs');fs.appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify(process.argv.slice(2))+'\\n');process.stdout.write(fs.readFileSync(process.env.FIXTURE_RESPONSE));\n`,{mode:0o755});
  writeFileSync(join(bin,'sleep'),'#!'+process.execPath+'\n'+`require('node:fs').appendFileSync(process.env.FIXTURE_SLEEPS,JSON.stringify(process.argv.slice(2))+'\\n');\n`,{mode:0o755});
  const script=run.replaceAll('/tmp/review-result.txt',output);
  const result=spawnSync('bash',['-e','-o','pipefail','-c',script],{cwd:folder,encoding:'utf8',timeout:10000,env:{...process.env,PATH:bin+':'+process.env.PATH,PR_DIFF:'fixture diff only',OPENROUTER_API_KEY:'fixture-key-not-a-secret',TOAPIS_API_KEY:'fixture-old-key-not-used',FIXTURE_CALLS:calls,FIXTURE_SLEEPS:sleeps,FIXTURE_RESPONSE:response}});
  assert.equal(result.error,undefined,result.error?.message);
  const observed=readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(observed.length,row.pass?1:3,'保留三次调用预算，最终正文成功即停止');
  for(const args of observed){
   const methodIndex=args.indexOf('-X');assert.equal(args[methodIndex+1],'POST');
   assert.equal(args[methodIndex+2],'https://openrouter.ai/api/v1/chat/completions');
   assert.ok(args.includes('Authorization: Bearer fixture-key-not-a-secret'));
   assert.equal(args[args.indexOf('--max-time')+1],'60');
   const body=JSON.parse(args[args.indexOf('-d')+1]);assert.equal(body.model,'deepseek/deepseek-v4-flash');assert.deepEqual(body.reasoning,{enabled:false});assert.equal(body.max_tokens,4096);
  }
  const retries=existsSync(sleeps)?readFileSync(sleeps,'utf8').trim().split('\n').map(JSON.parse):[];
  assert.equal(retries.length,row.pass?0:2);for(const args of retries)assert.deepEqual(args,['5']);
  if(row.pass){assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(output,'utf8'),'fixture final review\n');}
  else{assert.equal(result.status,1,result.stderr);assert.equal(existsSync(output),false,'缺最终正文不能生成冒成功的review文件');}
 }finally{rmSync(folder,{recursive:true,force:true});}
});
