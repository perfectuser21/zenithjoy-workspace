import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
const helper=fileURLToPath(new URL('../pr-review-diff.mjs',import.meta.url));
function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'pr-review-git-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');mkdirSync(join(dir,'hooks'));git('config','core.hooksPath',join(dir,'hooks'));git('config','user.name','fixture');git('config','user.email','fixture@example.invalid');git('remote','add','origin','https://github.com/fixture/repository.git');
 writeFileSync(join(dir,'base.txt'),'base\n');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
 writeFileSync(join(dir,'head.txt'),'fixed PR change\n');git('add','.');git('commit','-qm','head');const head=git('rev-parse','HEAD');
 const event={pull_request:{base:{sha:base,repo:{full_name:'fixture/repository'}},head:{sha:head},title:'$(touch title-executed)',body:'`touch body-executed`'}};
 const env={...process.env,RUNNER_TEMP:dir,GITHUB_EVENT_NAME:'pull_request',GITHUB_EVENT_PATH:join(dir,'event.json'),GITHUB_REPOSITORY:'fixture/repository',GITHUB_SERVER_URL:'https://github.com',PR_BASE_SHA:base,PR_HEAD_SHA:head};
 return {dir,git,base,head,event,env,run(){writeFileSync(env.GITHUB_EVENT_PATH,JSON.stringify(event));return spawnSync(process.execPath,[helper],{cwd:dir,env,encoding:'utf8',timeout:10000});},diff(){return readFileSync(join(dir,'pr-review.diff'),'utf8');}};
}
test('305 changed files are all present without API pagination or truncation',t=>{
 const f=fixture(t);
 for(let i=0;i<305;i++)writeFileSync(join(f.dir,`file-${String(i).padStart(3,'0')}.txt`),`complete change ${i}\n`);
 writeFileSync(join(f.dir,'binary.dat'),Buffer.from([0,1,2,3,255]));
 f.git('add','.');f.git('commit','-qm','large head');f.env.PR_HEAD_SHA=f.event.pull_request.head.sha=f.git('rev-parse','HEAD');
 const result=f.run();assert.equal(result.status,0,result.stderr);const diff=f.diff();
 for(let i=0;i<305;i++)assert.ok(diff.includes(`+complete change ${i}\n`),`file ${i} missing`);
 assert.ok(diff.includes('GIT binary patch'));assert.equal((diff.match(/^diff --git /gm)||[]).length,307);
 assert.equal(existsSync(join(f.dir,'title-executed')),false);assert.equal(existsSync(join(f.dir,'body-executed')),false);
});
test('moving local base/head branches never changes the exact event source',t=>{
 const f=fixture(t);f.git('checkout','-qb','moved-base',f.base);writeFileSync(join(f.dir,'base-only.txt'),'not a PR change\n');f.git('add','.');f.git('commit','-qm','base advanced');
 f.env.PR_BASE_SHA=f.event.pull_request.base.sha=f.git('rev-parse','HEAD');
 f.git('checkout','--detach',f.head);f.git('branch','-f','moved-head',f.base);
 const result=f.run();assert.equal(result.status,0,result.stderr);assert.ok(f.diff().includes('+fixed PR change'));assert.equal(f.diff().includes('base-only.txt'),false);
});
for(const mode of ['base-env-drift','head-env-drift','checkout-head-drift','wrong-base-repository','wrong-checkout-origin','missing-base-object','invalid-head-option','non-pr-event','unrelated-history'])test('fails closed without stale diff: '+mode,t=>{
 const f=fixture(t);writeFileSync(join(f.dir,'pr-review.diff'),'stale diff must not survive');
 if(mode==='base-env-drift')f.env.PR_BASE_SHA=f.head;
 if(mode==='head-env-drift')f.env.PR_HEAD_SHA=f.base;
 if(mode==='checkout-head-drift')f.git('checkout','--detach',f.base);
 if(mode==='wrong-base-repository')f.event.pull_request.base.repo.full_name='wrong/repository';
 if(mode==='wrong-checkout-origin')f.git('remote','set-url','origin','https://github.com/wrong/repository.git');
 if(mode==='missing-base-object')f.env.PR_BASE_SHA=f.event.pull_request.base.sha='f'.repeat(40);
 if(mode==='invalid-head-option')f.env.PR_HEAD_SHA=f.event.pull_request.head.sha='--output=bad';
 if(mode==='non-pr-event')f.env.GITHUB_EVENT_NAME='push';
 if(mode==='unrelated-history'){
  f.git('checkout','--orphan','unrelated');f.git('rm','-rf','.');writeFileSync(join(f.dir,'orphan.txt'),'unrelated');f.git('add','.');f.git('commit','-qm','unrelated');f.env.PR_BASE_SHA=f.event.pull_request.base.sha=f.git('rev-parse','HEAD');f.git('checkout','--detach',f.head);
 }
 const result=f.run();assert.notEqual(result.status,0,result.stdout+result.stderr);assert.equal(existsSync(join(f.dir,'pr-review.diff')),false);assert.equal(existsSync(join(f.dir,'pr-review.diff.tmp')),false);
});
