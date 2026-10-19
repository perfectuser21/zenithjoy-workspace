import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse} from 'yaml';

const workflow=parse(readFileSync(new URL('../../auto-version.yml',import.meta.url),'utf8'));
const command=workflow.jobs.bump.steps.find(step=>step.name==='Create version bump PR').run;
function publication(mode){
 const root=mkdtempSync(join(tmpdir(),'auto-version-publication-')),bin=join(root,'bin'),log=join(root,'calls');mkdirSync(bin);
 const executable=(name,source)=>writeFileSync(join(bin,name),'#!/bin/bash\nset -eu\n'+source,{mode:0o755});
 executable('git','printf "git %s\\n" "$*" >> "$FIXTURE_CALLS"\nif [[ "$*" == "diff --cached --quiet" ]]; then exit 1; fi\n');
 executable('node','printf "node %s\\n" "$*" >> "$FIXTURE_CALLS"\nif [[ "$1" == -e ]]; then printf "1.10.1\\n"; fi\n');
 executable('gh',`printf "gh %s\\n" "$*" >> "$FIXTURE_CALLS"
 case "$1 $2" in
  'pr create') if [[ "$FIXTURE_MODE" == success || "$FIXTURE_MODE" == merge_failure ]]; then echo 'https://github.com/perfectuser21/zenithjoy-workspace/pull/99999'; else echo 'CREATE_ROOT_CAUSE_17' >&2; exit 17; fi;;
  'pr view') if [[ "$FIXTURE_MODE" == existing ]]; then echo 'https://github.com/perfectuser21/zenithjoy-workspace/pull/99998'; elif [[ "$FIXTURE_MODE" == invalid_existing ]]; then echo 'PR creation failed and no existing PR found'; else echo 'VIEW_NOT_FOUND_19' >&2; exit 19; fi;;
  'pr merge') if [[ "$FIXTURE_MODE" == merge_failure ]]; then echo 'MERGE_ROOT_CAUSE_23' >&2; exit 23; fi;;
  *) echo 'unexpected gh invocation' >&2; exit 29;;
 esac
 `);
 try{
  // Run the real workflow shell with inert executables, never a real push or API.
  const script=command.replaceAll('${{ steps.bump.outputs.type }}','patch');
  const result=spawnSync('/bin/bash',['-e','-c',script],{cwd:root,encoding:'utf8',timeout:10000,env:{PATH:bin+':/usr/bin:/bin',FIXTURE_CALLS:log,FIXTURE_MODE:mode}});
  return {...result,calls:readFileSync(log,'utf8')};
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('创建PR失败且没有真实既存PR时保留stderr和原退出码',()=>{
 const r=publication('missing');assert.equal(r.status,17,r.stderr);assert.match(r.stderr,/CREATE_ROOT_CAUSE_17/);assert.doesNotMatch(r.calls,/gh pr merge/);
});
test('成功创建PR正常请求auto-merge',()=>{
 const r=publication('success');assert.equal(r.status,0,r.stderr);assert.match(r.calls,/gh pr merge .*--squash --auto --delete-branch/);
});
test('创建失败仅可从成功查询的真实本仓PR URL恢复',()=>{
 const r=publication('existing');assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/CREATE_ROOT_CAUSE_17/);assert.match(r.calls,/gh pr view/);assert.match(r.calls,/gh pr merge/);
});
test('查询输出任意提示文本不算已有PR，不能假成功',()=>{
 const r=publication('invalid_existing');assert.notEqual(r.status,0);assert.doesNotMatch(r.calls,/gh pr merge/);
});
test('auto-merge请求失败保留原stderr和退出码',()=>{
 const r=publication('merge_failure');assert.equal(r.status,23,r.stderr);assert.match(r.stderr,/MERGE_ROOT_CAUSE_23/);
});
test('生成分支命中现行L1且不删除其他候选分支',()=>{
 const r=publication('success');assert.equal(r.status,0,r.stderr);
 const branch=r.calls.match(/^git checkout -b (.+)$/m)?.[1];assert.match(branch||'',/^cp-\d{8,10}-auto-version-bump-1-10-1$/);
 assert.doesNotMatch(r.calls,/git push origin --delete/);
});
