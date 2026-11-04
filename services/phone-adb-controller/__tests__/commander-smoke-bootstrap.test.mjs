import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,rmSync,copyFileSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';
import {gates} from '../../../scripts/ci/required-gate.mjs';
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
test('Commander入口先安装固定Skill并核验源合同，行为回归由required L3独立执行',()=>{
 const {r,lines,dir}=run(0);assert.equal(r.status,0,r.stderr);assert.deepEqual(lines.slice(0,2),['node:scripts/ci/implementation-skill-source.mjs --install-regression-skills '+dir,'bootstrap:'+dir]);
 assert.equal(lines.filter(x=>x.startsWith('bootstrap:')).length,1);
 assert.deepEqual(lines.slice(2),[
  'node:scripts/product-map/gen-commander-contracts.mjs --check',
  'node:--test scripts/product-map/__tests__/commander-skill-contracts.test.js',
  'python3:-c import ast,sys; ast.parse(open(sys.argv[1]).read()) services/phone-adb-controller/commander/wf-agent-lib.py',
 ]);
 assert.equal(lines.length,5);
 assert.ok(lines.some(x=>x.includes('commander-skill-contracts.test.js')));
 assert.ok(!r.stdout.includes('execution regressions PASS'),'source verification must not claim behavior tests ran');
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

// Expand the actual required workflow command, rather than treating a comment
// about L3 ownership as evidence that the behavior suites are still selected.
test('实际required L3命令仍选择完整Commander执行与部署回归且每套只选择一次', t=>{
 const dir=mkdtempSync(join(tmpdir(),'commander-required-selection-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const workflow=YAML.parse(readFileSync(new URL('../../../.github/workflows/ci-l3-code.yml',import.meta.url),'utf8'));
 const job=workflow.jobs['openclaw-scripts-test'];assert.ok(job);assert.ok(!job['continue-on-error']);
 assert.ok(workflow.jobs['l3-passed'].needs.includes('openclaw-scripts-test'));
 assert.ok(gates.code.always.includes('openclaw-scripts-test'));
 const step=job.steps.find(step=>step.run?.startsWith('node --test'));assert.ok(step);assert.ok(!step['continue-on-error']);
 const args=join(dir,'args');writeFileSync(join(dir,'node'),'#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE_ARGS"\n',{mode:0o755});
 const command=step.run.replace(/\$\{\{\s*matrix.shard\s*\}\}/g,'1');
 const result=spawnSync('bash',['-c',command],{cwd:resolve(new URL('../../..',import.meta.url).pathname),env:{...process.env,PATH:dir+':'+process.env.PATH,CAPTURE_ARGS:args},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 const selected=readFileSync(args,'utf8').trim().split('\n');
 for(const name of ['commander-report','commander-v2','commander-codex-agent','commander-handoff','deployment-unified','deployment-prepare']){
  const file='services/phone-adb-controller/__tests__/'+name+'.test.mjs';assert.equal(selected.filter(arg=>arg===file).length,1,file);
 }
});
