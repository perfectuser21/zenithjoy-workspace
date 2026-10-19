import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readImplementationSource} from '../implementation-skill-source.mjs';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const commit=root=>{git(root,'add','.');git(root,'-c','user.name=Fixture','-c','user.email=f@f','-c','commit.gpgsign=false','commit','-qm','fixture');return git(root,'rev-parse','HEAD');};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'trusted-skill-reader-')),business=join(root,'business'),central=join(root,'central');
 for(const dir of [business,central]){mkdirSync(dir);git(dir,'init','-q');git(dir,'config','core.hooksPath','/dev/null');}
 git(business,'remote','add','origin','https://github.com/perfectuser21/zenithjoy-workspace.git');
 const path='scripts/phone-account-patrol/SKILL.md',payload=Buffer.from('real source\n\n');
 mkdirSync(join(business,'scripts/phone-account-patrol'),{recursive:true});writeFileSync(join(business,path),payload);
 const before=commit(business);mkdirSync(join(central,'distribution'));writeFileSync(join(central,'body.md'),payload);
 const catalog={profiles:{zenithjoy:{files:[{path,source:'body.md',sha256:createHash('sha256').update(payload).digest('hex')}]}}};
 writeFileSync(join(central,'distribution/catalog.json'),JSON.stringify(catalog));const revision=commit(central);
 rmSync(join(business,path));writeFileSync(join(business,'.skills-source.json'),JSON.stringify({version:1,repository:'perfectuser21/zenithjoy-skills',profile:'zenithjoy',revision,loader_sha256:'0'.repeat(64)}));
 writeFileSync(join(business,'scripts/skills-source.py'),"raise Exception('CANDIDATE_MUST_NOT_EXECUTE')\n");
 const after=commit(business);
 return {business,central,path,payload,before,after,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('reads exact old and migrated Git bytes without executing candidate loader',()=>{
 const f=fixture();try{
  assert.deepEqual(readImplementationSource(f.business,f.before,f.path,{source:f.central}),f.payload);
  assert.deepEqual(readImplementationSource(f.business,f.after,f.path,{source:f.central}),f.payload);
  writeFileSync(join(f.central,'body.md'),'new checkout content must not be read');commit(f.central);
  writeFileSync(join(f.business,'.skills-source.json'),'poisoned working copy');
  assert.deepEqual(readImplementationSource(f.business,f.after,f.path,{source:f.central}),f.payload);
 }finally{f.cleanup();}
});
test('rejects missing entries, checksum mismatch and wrong profile',()=>{
 const f=fixture();try{
  assert.throws(()=>readImplementationSource(f.business,f.after,'missing/SKILL.md',{source:f.central}));
  const lock=JSON.parse(git(f.business,'show',`${f.after}:.skills-source.json`));lock.profile='cecelia';
  writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(lock));const wrong=commit(f.business);
  assert.throws(()=>readImplementationSource(f.business,wrong,f.path,{source:f.central}),/PROFILE/);
  lock.profile='zenithjoy';const catalog={profiles:{zenithjoy:{files:[{path:f.path,source:'body.md',sha256:'0'.repeat(64)}]}}};
  writeFileSync(join(f.central,'distribution/catalog.json'),JSON.stringify(catalog));lock.revision=commit(f.central);
  writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(lock));const corrupt=commit(f.business);
  assert.throws(()=>readImplementationSource(f.business,corrupt,f.path,{source:f.central}),/CHECKSUM/);
 }finally{f.cleanup();}
});
test('Git replacement objects cannot change historical business source',()=>{
 const f=fixture();try{
  const original=git(f.business,'rev-parse',`${f.before}:${f.path}`);
  const replacement=execFileSync('git',['-C',f.business,'hash-object','-w','--stdin'],{input:'malicious replacement',encoding:'utf8'}).trim();
  git(f.business,'replace',original,replacement);
  assert.deepEqual(readImplementationSource(f.business,f.before,f.path,{source:f.central}),f.payload);
 }finally{f.cleanup();}
});
test('Cecelia identity must select the Cecelia profile at the pinned revision',()=>{
 const f=fixture();try{
  git(f.business,'remote','set-url','origin','git@github.com:perfectuser21/cecelia.git');
  const catalog={profiles:{cecelia:{files:[{path:f.path,source:'body.md',sha256:createHash('sha256').update(f.payload).digest('hex')}]}}};
  writeFileSync(join(f.central,'distribution/catalog.json'),JSON.stringify(catalog));
  const lock=JSON.parse(git(f.business,'show',`${f.after}:.skills-source.json`));lock.profile='cecelia';lock.revision=commit(f.central);
  writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(lock));const revision=commit(f.business);
  assert.deepEqual(readImplementationSource(f.business,revision,f.path,{source:f.central}),f.payload);
 }finally{f.cleanup();}
});

// The Pilot capability is an object repository with an unborn HEAD, not a checkout.
import * as sourceApi from '../implementation-skill-source.mjs';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
function regressionFixture(){
 const f=fixture();mkdirSync(join(f.central,'distribution'),{recursive:true});
 const loader=Buffer.from("import argparse,pathlib\np=argparse.ArgumentParser();p.add_argument('command');p.add_argument('--workspace');p.add_argument('--source');a=p.parse_args();w=pathlib.Path(a.workspace);x=w/'installer-phases';x.write_text((x.read_text() if x.exists() else '')+a.command+'\\n')\n");
 writeFileSync(join(f.central,'distribution/skills_source.py'),loader);
 const pin=commit(f.central),lock={version:1,repository:'perfectuser21/zenithjoy-skills',profile:'zenithjoy',revision:pin,loader_sha256:createHash('sha256').update(loader).digest('hex')};
 writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(lock));
 for(const path of ['scripts/skills-source.py','scripts/ensure-skills-source.sh'])writeFileSync(join(f.business,path),readFileSync(new URL('../../../'+path,import.meta.url)));
 commit(f.business);const cache=join(f.business,'../objects');mkdirSync(cache);git(cache,'init','-q');git(cache,'fetch','--quiet','--depth=1',f.central,pin);
 return {...f,cache,pin,lock};
}
test('Pilot白名单无HEAD对象缓存经私有checkout执行原install/verify，保持共享缓存不变并清理',()=>{
 const f=regressionFixture();try{
  const config=readFileSync(join(f.cache,'.git/config')),objects=git(f.cache,'count-objects','-v');
  assert.throws(()=>git(f.cache,'rev-parse','--verify','HEAD'));
  assert.equal(typeof sourceApi.installRegressionSkills,'function');
  const result=sourceApi.installRegressionSkills(f.business,{source:f.cache});
  assert.equal(readFileSync(join(f.business,'installer-phases'),'utf8'),'install\nverify\n');
  assert.ok(result.privateCheckout);assert.equal(existsSync(result.privateCheckout),false);
  assert.deepEqual(readFileSync(join(f.cache,'.git/config')),config);assert.equal(git(f.cache,'count-objects','-v'),objects);
  assert.throws(()=>git(f.cache,'rev-parse','--verify','HEAD'));
 }finally{f.cleanup();}
});
test('正确外部checkout沿原行为，错误HEAD仍拒绝且不能用缓存适配掩盖',()=>{
 for(const wrong of [false,true]){const f=regressionFixture();try{
  if(wrong){writeFileSync(join(f.central,'new'),'new');commit(f.central);}
  if(wrong)assert.throws(()=>sourceApi.installRegressionSkills(f.business,{source:f.central}),/explicit source revision/);
  else {sourceApi.installRegressionSkills(f.business,{source:f.central});assert.equal(readFileSync(join(f.business,'installer-phases'),'utf8'),'install\nverify\n');}
 }finally{f.cleanup();}}
});
test('离线对象缓存错pin/loader/repo/缺commit/replace均在安装前拒绝',()=>{
 for(const mode of ['pin','loader','repo','missing','replace']){const f=regressionFixture();try{
  if(mode==='pin')f.lock.revision='a'.repeat(40);
  if(mode==='loader')f.lock.loader_sha256='0'.repeat(64);
  if(mode==='repo')f.lock.repository='evil/skills';
  if(['pin','loader','repo'].includes(mode)){writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(f.lock));commit(f.business);}
  if(mode==='missing'){rmSync(f.cache,{recursive:true});mkdirSync(f.cache);git(f.cache,'init','-q');}
  if(mode==='replace')git(f.cache,'replace',f.pin,f.pin);
  assert.throws(()=>sourceApi.installRegressionSkills(f.business,{source:f.cache}),undefined,mode);
  assert.equal(existsSync(join(f.business,'installer-phases')),false,mode);
 }finally{f.cleanup();}}
});
test('ambient Git重定向与源local config不能执行hook/filter或污染私有安装',()=>{
 const f=regressionFixture(),previous=process.env.GIT_DIR;try{
  const poison=join(f.business,'poisoned');git(f.cache,'config','core.hooksPath',poison);git(f.cache,'config','core.autocrlf','true');git(f.cache,'config','uploadpack.packObjectsHook',`touch ${poison}`);
  process.env.GIT_DIR=poison;
  sourceApi.installRegressionSkills(f.business,{source:f.cache});
  assert.equal(readFileSync(join(f.business,'installer-phases'),'utf8'),'install\nverify\n');
  assert.equal(existsSync(poison),false);delete process.env.GIT_DIR;assert.equal(git(f.cache,'config','core.autocrlf'),'true');
 }finally{if(previous===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previous;f.cleanup();}
});

test('实际白名单CLI只继承对象cache，拒绝relative/missing且finally清理失败checkout',()=>{
 const f=regressionFixture();try{
  const cli=fileURLToPath(new URL('../implementation-skill-source.mjs',import.meta.url));
  const env={PATH:`${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,CI:'true',NODE_ENV:'test',LANG:'C.UTF-8',SKILLS_SOURCE_DIR:f.cache,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.worktree',GIT_CONFIG_VALUE_0:'/does-not-exist',GIT_OBJECT_DIRECTORY:'/missing-objects'};
  const result=spawnSync(process.execPath,[cli,'--install-regression-skills',f.business],{env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(join(f.business,'installer-phases'),'utf8'),'install\nverify\n');
  for(const source of ['relative',join(f.business,'missing')])assert.throws(()=>sourceApi.installRegressionSkills(f.business,{source}));
  const loader=Buffer.from("raise RuntimeError('installer failure witness')\n");writeFileSync(join(f.central,'distribution/skills_source.py'),loader);f.lock.revision=commit(f.central);f.lock.loader_sha256=createHash('sha256').update(loader).digest('hex');writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(f.lock));commit(f.business);git(f.cache,'fetch','--quiet',f.central,f.lock.revision);
  const before=readdirSync(tmpdir()).filter(x=>x.startsWith('regression-skills-')).sort();
  assert.throws(()=>sourceApi.installRegressionSkills(f.business,{source:f.cache}),/Command failed/);
  assert.deepEqual(readdirSync(tmpdir()).filter(x=>x.startsWith('regression-skills-')).sort(),before);
 }finally{f.cleanup();}
});

test('三个正式scope smoke全部经同一离线适配入口，不能直装对象cache',()=>{
 for(const path of ['.github/workflows/scripts/smoke/commander-codex-agent-smoke.sh','.github/workflows/scripts/smoke/codex-publish-contract-smoke.sh','scripts/smoke/leadgen-split-smoke.sh']){
  const source=readFileSync(new URL('../../../'+path,import.meta.url),'utf8');
  assert.match(source,/^node scripts\/ci\/implementation-skill-source\.mjs --install-regression-skills "\$(?:REPO_ROOT|PWD)"$/m,path);
  assert.doesNotMatch(source,/^bash scripts\/ensure-skills-source\.sh/m,path);
 }
});
test('已有固定HEAD的正确外部Git worktree保留原安装兼容，不改共享身份',()=>{
 const f=regressionFixture();try{
  const source=join(f.business,'../external-worktree');git(f.central,'worktree','add','--quiet','--detach',source,f.pin);
  const config=readFileSync(join(f.central,'.git/config'));
  sourceApi.installRegressionSkills(f.business,{source});
  assert.equal(readFileSync(join(f.business,'installer-phases'),'utf8'),'install\nverify\n');
  assert.equal(git(source,'rev-parse','HEAD'),f.pin);assert.deepEqual(readFileSync(join(f.central,'.git/config')),config);
 }finally{f.cleanup();}
});
