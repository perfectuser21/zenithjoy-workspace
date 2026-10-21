import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';

for (const [file, job] of [['wechat-cs-e2e.yml','agent-windows'], ['agent-module-e2e.yml','preflight-xian-rog']]) test(`${file}: ROG历史local sparse开关不能让完整checkout漏掉微信源码测试`,()=>{
 const root=mkdtempSync(join(tmpdir(),'zj-checkout-reuse-'));
 const required='services/agent/src/handlers/__tests__/wechat-rpa.test.ts';
 function run(cmd,args){const r=spawnSync(cmd,args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r;}
 const git=(...args)=>run('git',args);
 try {
  git('init','-q','-b','cp-fixture');git('config','core.hooksPath','/dev/null');
  git('config','user.name','fixture');git('config','user.email','fixture@example.invalid');
  mkdirSync(join(root,'services/agent/src/handlers/__tests__'),{recursive:true});
  mkdirSync(join(root,'services/agent/publishers'),{recursive:true});
  writeFileSync(join(root,required),'// real tracked test fixture\n');
  writeFileSync(join(root,'services/agent/publishers/keep.cjs'),'// publisher\n');
  mkdirSync(join(root,'services/agent/modules/line04'),{recursive:true});
  writeFileSync(join(root,'services/agent/tsconfig.build.json'),'{}');
  writeFileSync(join(root,'services/agent/modules/line04/preflight.ts'),'// preflight');
  git('add','.');git('commit','-qm','fixture');
  git('sparse-checkout','set','services/agent/publishers');
  git('config','--local','core.sparseCheckout','true');
  // actions/checkout v4 disables the worktree override before removing the extension.
  git('sparse-checkout','disable');git('config','--local','--unset-all','extensions.worktreeConfig');
  git('checkout','--force','HEAD');
  assert.equal(existsSync(join(root,required)),false,'reproduce inherited sparse source omission');
  const workflow=YAML.parse(readFileSync('.github/workflows/'+file,'utf8'));
  const step=workflow.jobs[job].steps.find(s=>s.name==='Restore complete agent source after reused checkout');
  run('bash',['-e','-o','pipefail','-c',step?.run||':']);
  assert.equal(existsSync(join(root,required)),true,'actual workflow must restore required tracked source');
  const checkout=workflow.jobs[job].steps.findIndex(s=>s.uses?.startsWith('actions/checkout@'));
  assert.ok(workflow.jobs[job].steps.indexOf(step)>checkout);
 } finally {rmSync(root,{recursive:true,force:true});}
});
