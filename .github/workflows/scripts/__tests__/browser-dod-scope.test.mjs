import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {detectChanges} from '../../../../scripts/ci/detect-changes.mjs';
import {checkGate} from '../../../../scripts/ci/required-gate.mjs';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';
const l1=YAML.parse(readFileSync('.github/workflows/ci-l1-process.yml','utf8'));
const step=Object.values(l1.jobs).flatMap(j=>j.steps||[]).find(s=>s.name==='Detect frontend changes and check browser DoD');
const pipeline=step.run.match(/if ! (echo "\$CHANGED" \|[\s\S]+?); then/)?.[1];
function frontend(paths){assert.ok(pipeline);return spawnSync('bash',['-c',pipeline],{env:{...process.env,CHANGED:paths.join('\n')},encoding:'utf8'}).status===0;}
test('正式路径筛选把API服务/路由归入API测试，不误读历史浏览器DoD',()=>{
 assert.equal(frontend(['apps/api/src/services/walking-skeleton.service.ts']),false);
 assert.equal(frontend(['apps/api/src/routes/agent.ts','apps/api/tests/routes/heartbeat-modules.test.ts']),false);
});
test('真实dashboard与staff界面仍必须浏览器DoD，测试文件仍不冒充界面改动',()=>{
 assert.equal(frontend(['apps/dashboard/src/pages/Workers.tsx']),true);
 assert.equal(frontend(['apps/staff-hub/src/App.tsx']),true);
 assert.equal(frontend(['apps/dashboard/e2e/workers.spec.ts','apps/staff-hub/src/__tests__/App.test.tsx']),false);
});
test('API改动仍触发现行L4实际测试且不成功即阻断聚合门',()=>{
 const l4=YAML.parse(readFileSync('.github/workflows/ci-l4-runtime.yml','utf8'));
 const dir=mkdtempSync(join(tmpdir(),'browser-dod-api-'));
 const previous=process.cwd();
 function git(args){const r=spawnSync('git',args,{cwd:dir,encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'fixture',GIT_AUTHOR_EMAIL:'ci@example.test',GIT_COMMITTER_NAME:'fixture',GIT_COMMITTER_EMAIL:'ci@example.test'}});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
 try {
  git(['init','-q']);
  writeFileSync(join(dir,'README.md'),'base');git(['add','.']);
  const base=git(['commit-tree',git(['write-tree']),'-m','base']);
  mkdirSync(join(dir,'apps/api/src/services'),{recursive:true});
  writeFileSync(join(dir,'apps/api/src/services/walking-skeleton.service.ts'),'changed');git(['add','.']);
  const head=git(['commit-tree',git(['write-tree']),'-p',base,'-m','api']);
  process.chdir(dir);
  const outputs=detectChanges('runtime','pull_request',{pull_request:{base:{sha:base},head:{sha:head}}});
  assert.equal(outputs.api,'true');
  const needs=Object.fromEntries(l4.jobs['l4-passed'].needs.map(job=>[job,{result:'success'}]));
  needs.changes={result:'success',outputs};
  assert.doesNotThrow(()=>checkGate('runtime',needs));
  for(const result of ['failure','cancelled','skipped','']) {
   needs['api-test']={result};
   assert.throws(()=>checkGate('runtime',needs),/api-test/);
  }
 } finally {process.chdir(previous);rmSync(dir,{recursive:true,force:true});}

 assert.match(l4.jobs['api-test'].if,/needs.changes.outputs.api == 'true'/);
 assert.ok(l4.jobs['api-test'].steps.some(s=>s['working-directory']==='apps/api'&&s.run?.includes('vitest run --coverage')));
 assert.ok(l4.jobs['l4-passed'].needs.includes('api-test'));

});
