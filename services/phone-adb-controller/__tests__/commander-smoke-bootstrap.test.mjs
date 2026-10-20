import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,rmSync,copyFileSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const path='.github/workflows/scripts/smoke/commander-codex-agent-smoke.sh';
function run(fail){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'commander-bootstrap-')));
 try{
  mkdirSync(join(dir,'.github/workflows/scripts/smoke'),{recursive:true});mkdirSync(join(dir,'scripts'),{recursive:true});mkdirSync(join(dir,'bin'));
  writeFileSync(join(dir,path),readFileSync(new URL('../../../'+path,import.meta.url)));
  writeFileSync(join(dir,'scripts/ensure-skills-source.sh'),'printf "bootstrap:%s\\n" "$1" >> "$TRACE"\nexit "${BOOTSTRAP_EXIT:-0}"\n');
  for(const name of ['node','python3'])writeFileSync(join(dir,'bin',name),'#!/bin/sh\nprintf "'+name+':%s\\n" "$*" >> "$TRACE"\n[ "$1" != scripts/ci/implementation-skill-source.mjs ] || exec /bin/bash scripts/ensure-skills-source.sh "$3"\n',{mode:0o755});
  writeFileSync(join(dir,'bin/bash'),'#!/bin/sh\n[ \"$1\" = -n ] && exit 0\nexec /bin/bash \"$@\"\n',{mode:0o755});
  const trace=join(dir,'trace');const r=spawnSync('/bin/bash',[path],{cwd:dir,encoding:'utf8',env:{...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,TRACE:trace,BOOTSTRAP_EXIT:String(fail)},timeout:10000});
  const lines=readFileSync(trace,'utf8').trim().split('\n');return {r,lines,dir};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('Commander回归先执行固定Skill安装核验，再保留完整原测试链',()=>{
 const {r,lines,dir}=run(0);assert.equal(r.status,0,r.stderr);assert.deepEqual(lines.slice(0,2),['node:scripts/ci/implementation-skill-source.mjs --install-regression-skills '+dir,'bootstrap:'+dir]);
 assert.equal(lines.filter(x=>x.startsWith('bootstrap:')).length,1);
 assert.deepEqual(lines.slice(2,6),[
  'node:scripts/product-map/gen-commander-contracts.mjs --check',
  'node:--test scripts/product-map/__tests__/commander-skill-contracts.test.js',
  'node:--test services/phone-adb-controller/__tests__/commander-report.test.mjs services/phone-adb-controller/__tests__/commander-v2.test.mjs services/phone-adb-controller/__tests__/commander-codex-agent.test.mjs services/phone-adb-controller/__tests__/commander-handoff.test.mjs',
  'node:--test services/phone-adb-controller/__tests__/deployment-unified.test.mjs services/phone-adb-controller/__tests__/deployment-prepare.test.mjs',
 ]);
 assert.equal(lines.length,7);assert.match(lines[6],/^python3:-c .*wf-agent-lib\.py$/);
 assert.ok(lines.some(x=>x.includes('commander-skill-contracts.test.js')));assert.ok(lines.some(x=>x.includes('commander-v2.test.mjs')));assert.ok(lines.some(x=>x.includes('deployment-prepare.test.mjs')));
});
test('固定Skill安装核验失败立即拒绝，不能继续测试或报PASS',()=>{
 const {r,lines}=run(23);assert.equal(r.status,23);assert.equal(lines.length,2);assert.match(lines[0],/^node:scripts\/ci\/implementation-skill-source\.mjs --install-regression-skills /);assert.match(lines[1],/^bootstrap:/);assert.ok(!r.stdout.includes('commander-codex-agent-smoke: PASS'));
});

test('真实Commander来源用例可消费外部无HEAD对象缓存且不依赖默认缓存',t=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'commander-external-cache-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const root=process.cwd(),workspace=join(dir,'workspace'),cache=join(dir,'objects');
 const env={...process.env,GIT_ALLOW_PROTOCOL:'file',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
 const git=(args,cwd=root)=>{const r=spawnSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd,env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 const lock=JSON.parse(readFileSync(join(root,'.skills-source.json')));
 git(['clone','--quiet','--no-hardlinks','--no-checkout',root,workspace]);git(['checkout','--quiet','--detach','HEAD'],workspace);
 assert.equal(existsSync(join(workspace,'.skills-source')),false,'fresh源码不应有默认Skill缓存');
 git(['init','--quiet',cache]);git(['fetch','--quiet','--no-tags','--depth=1',resolve(process.env.SKILLS_SOURCE_DIR||join(root,'.skills-source')),lock.revision],cache);
 const head=spawnSync('git',['-C',cache,'rev-parse','--verify','HEAD'],{env,encoding:'utf8'});assert.notEqual(head.status,0,'复现正式无HEAD缓存');
 symlinkSync(resolve(root,'node_modules'),join(workspace,'node_modules'),'dir');
 const target='scripts/product-map/__tests__/commander-skill-contracts.test.js';copyFileSync(join(root,target),join(workspace,target));
 const childEnv={...env,SKILLS_SOURCE_DIR:cache};delete childEnv.NODE_TEST_CONTEXT;
 const r=spawnSync(process.execPath,['--test','--test-name-pattern=^未还原Commander正文',target],{cwd:workspace,env:childEnv,encoding:'utf8',timeout:30000});
 assert.match(r.stdout,/未还原Commander正文/);assert.equal(r.status,0,r.stdout+'\n'+r.stderr);assert.equal(existsSync(join(workspace,'.skills-source')),false,'测试不能造默认缓存掩盖正式前提');
});
