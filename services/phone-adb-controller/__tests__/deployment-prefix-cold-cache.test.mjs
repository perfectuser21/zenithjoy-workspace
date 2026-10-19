import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,symlinkSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withDeploymentPrefixFixture} from './deployment-prefix-fixture.mjs';

const source=fileURLToPath(new URL('../../../',import.meta.url));
const env={...process.env,GIT_ALLOW_PROTOCOL:'file',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0'};
for(const key of ['HOME','GIT_SSH_COMMAND','GIT_CONFIG_COUNT','GIT_CONFIG_PARAMETERS','NODE_TEST_CONTEXT','NODE_OPTIONS','NODE_PATH'])delete env[key];
const git=(root,...args)=>execFileSync('git',['--no-replace-objects','-C',root,...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000});

// Regression: generated Skill files alone are not the deployment bootstrap's
// private Git cache. The array tests must establish the real deployment premise.
test('两个部署数组原用例在已生成Skill和外置无HEAD缓存下离线通过',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'deployment-prefix-cold-'));
 try{
  const root=join(temporary,'source'),cache=join(temporary,'objects');
  git(temporary,'init','--quiet',root);
  const revision=git(source,'rev-parse','HEAD').trim();
  git(root,'fetch','--quiet','--no-tags','--depth=1',source,revision);
  git(root,'checkout','--quiet','--detach',revision);
  symlinkSync(realpathSync(join(source,'node_modules')),join(root,'node_modules'),'dir');
  const lock=JSON.parse(readFileSync(join(root,'.skills-source.json'),'utf8'));
  const external=process.env.SKILLS_SOURCE_DIR||join(source,'.skills-source');
  git(temporary,'init','--quiet',cache);
  git(cache,'fetch','--quiet','--no-tags','--depth=1',external,lock.revision);
  const childEnv={...env,SKILLS_SOURCE_DIR:cache};
  assert.notEqual(spawnSync('git',['-C',cache,'rev-parse','--verify','HEAD'],{env:childEnv}).status,0);
  execFileSync(process.execPath,['scripts/ci/implementation-skill-source.mjs','--install-regression-skills',root],{cwd:root,env:childEnv,stdio:['ignore','pipe','pipe'],timeout:60000});
  assert.ok(existsSync(join(root,'services/phone-adb-controller/skills/douyin-leadgen-102/SKILL.md')));
  assert.equal(existsSync(join(root,'.skills-source')),false);
  const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=正式部署在系统 bash nounset|Skill和引用文件进入设备及MMV的实际发布清单','services/phone-adb-controller/__tests__/deploy-runtime-files.test.mjs','services/phone-adb-controller/__tests__/leadgen-skill-source-contract.test.mjs'],{cwd:root,env:childEnv,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  assert.match(result.stdout,/# pass 2\b/);
  assert.equal(existsSync(join(root,'.skills-source')),false,'不能污染原调用者的默认cache');
  assert.notEqual(spawnSync('git',['-C',cache,'rev-parse','--verify','HEAD'],{env:childEnv}).status,0);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

test('原Pythonbootstrap固定loader拒绝时，部署前缀不得继续输出数组',()=>{
 withDeploymentPrefixFixture((root,childEnv)=>{
  const lockPath=join(root,'.skills-source.json');
  const lock=JSON.parse(readFileSync(lockPath,'utf8'));
  lock.loader_sha256='0'.repeat(64);writeFileSync(lockPath,JSON.stringify(lock));
  const path=join(root,'services/phone-adb-controller/deploy.sh');
  const source=readFileSync(path,'utf8');
  const prefix=source.slice(0,source.indexOf('# 在任何SSH前核验部署源字节'));
  const result=spawnSync('/bin/bash',['-c',prefix+'\nprintf "RUNTIME:%s\\n" "${MMV_RUNTIME_FILES[@]}"',path],{env:childEnv,encoding:'utf8',timeout:30000});
  assert.notEqual(result.status,0,'不能绕过原bootstrap失败');
  assert.doesNotMatch(result.stdout,/RUNTIME:/);
 });
});
