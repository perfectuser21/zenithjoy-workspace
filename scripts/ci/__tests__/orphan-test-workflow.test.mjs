import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';
const workflow=YAML.parse(readFileSync(new URL('../../../.github/workflows/ci-l2-consistency.yml',import.meta.url),'utf8'));
const script=workflow.jobs['orphan-test-check'].steps.find(s=>s.name==='Check all test files are registered in test-registry.yaml').run;
function run(files, registered){
 const root=mkdtempSync(join(tmpdir(),'orphan-check-'));
 try{
  for(const file of files){mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),'');}
  writeFileSync(join(root,'test-registry.yaml'),registered.map(path=>`  path: ${path}`).join('\n'));
  return spawnSync('bash',['-e','-o','pipefail','-c',script],{cwd:root,encoding:'utf8'});
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('dependency source cache is excluded, registered workspace tests still pass',()=>{
 const result=run(['.skills-source/sprints/source.test.ts','apps/real.test.ts'],['apps/real.test.ts']);
 assert.equal(result.status,0,result.stdout+result.stderr);
});
test('a genuine unregistered workspace test remains blocked',()=>{
 const result=run(['apps/orphan.test.ts'],['apps/registered.test.ts']);
 assert.equal(result.status,1);assert.match(result.stdout,/apps\/orphan.test.ts/);
});
test('registry paths must match exactly and a large registry does not trigger pipefail',()=>{
 const registered=['apps/real.test.ts',...Array.from({length:10000},(_,i)=>`apps/unused-${i}.test.ts`)];
 const result=run(['apps/real.test.ts'],registered);
 assert.equal(result.status,0,result.stdout+result.stderr);
 const mismatch=run(['apps/real.test.ts'],['prefix/apps/real.test.ts']);
 assert.equal(mismatch.status,1,mismatch.stdout+mismatch.stderr);
});
