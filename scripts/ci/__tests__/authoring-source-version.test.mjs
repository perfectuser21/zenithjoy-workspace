import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {AUTHORING_FILES,checkAuthoringVersions} from '../authoring-source-version.mjs';
test('真实PR缺版头红、fix只改五个version、重跑幂等、main拒绝自动改Git',()=>{
 const root=mkdtempSync(join(tmpdir(),'source-version-'));
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  git('init','-q','-b','main');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');git('remote','add','origin','https://github.com/perfectuser21/zenithjoy-workspace.git');
  for(const p of AUTHORING_FILES){mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),JSON.stringify({key:p,version:'1.0.0',runtime:{revision:'unchanged'}}));}
  git('add','.');git('commit','-qm','fixture');const base=git('rev-parse','HEAD');git('update-ref','refs/remotes/origin/main',base);
  assert.throws(()=>checkAuthoringVersions(root,{base,fix:true}),/FIX_MAIN_FORBIDDEN/);
  git('switch','-qc','cp-fixture');assert.throws(()=>checkAuthoringVersions(root,{base}),/VERSION_BUMP_REQUIRED/);
  checkAuthoringVersions(root,{base,fix:true});const bytes=AUTHORING_FILES.map(p=>readFileSync(join(root,p),'utf8'));
  for(const [i,p] of AUTHORING_FILES.entries())assert.deepEqual(JSON.parse(bytes[i]),{key:p,version:'1.0.1',runtime:{revision:'unchanged'}});
  checkAuthoringVersions(root,{base,fix:true});assert.deepEqual(AUTHORING_FILES.map(p=>readFileSync(join(root,p),'utf8')),bytes);
  checkAuthoringVersions(root,{base});
  git('add','.');git('commit','-qm','unreleased');const unpublished=git('rev-parse','HEAD');
  assert.throws(()=>checkAuthoringVersions(root,{base:unpublished,fix:true}),/BASE_NOT_MAIN/);
  git('remote','set-url','origin','https://github.com/fork/repo.git');assert.throws(()=>checkAuthoringVersions(root,{base,fix:true}),/REPOSITORY_INVALID/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
