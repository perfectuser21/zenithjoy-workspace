import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';
import {gates} from '../../../../scripts/ci/required-gate.mjs';
import {runCodeGate} from './helpers/run-code-gate.mjs';

const workflow=YAML.parse(readFileSync(new URL('../../ci-l3-code.yml',import.meta.url),'utf8'));
const key='collection-phone-darwin-test';
const preflight='services/phone-adb-controller/__tests__/preflight-*.test.mjs';
const preflightFiles=readdirSync(new URL('../../../../services/phone-adb-controller/__tests__/',import.meta.url)).filter(n=>/^preflight-.*\.test\.mjs$/.test(n)).sort().map(n=>'services/phone-adb-controller/__tests__/'+n);
const isPreflight=c=>c[0]==='node'&&c[1]==='--test'&&c.slice(3).some(p=>p.includes('/preflight-'));
const py=['collection-review-maintenance.test.py','collection-review-gap.test.py','collection-review-maintenance-claim.test.py']
  .map(n=>'services/phone-adb-controller/__tests__/'+n);
const suites=['collection-phone-proof','collection-cleanup-only','collection-evidence-layout','collection-leaf-returned','collection-panel-readback','collection-leaf-scope','collection-returned-authority','proxy-version-deadline','adb-host-terminal','native-operation-ipc','native-operation-identity','native-operation-races','discovery-phase-budget','discovery-cleanup-scope','uiautomator-dump-crash']
  .map(n=>'services/phone-adb-controller/__tests__/'+n+'.test.mjs');

function validate(w=workflow){
  const job=w.jobs[key],matrix=job.strategy?.matrix?.include;
  assert.equal(job.if, "needs.changes.outputs.docs_only != 'true' && needs.changes.outputs.darwin_unrelated != 'true'");assert.equal(job.needs, 'changes');assert.equal(job['continue-on-error'],undefined);
  assert.equal(job['runs-on'],'macos-latest');assert.equal(job['timeout-minutes'],10);
  assert.equal(job.strategy['fail-fast'],false);assert.deepEqual(matrix.map(x=>x.shard),[0,1]);
  assert.deepEqual(matrix[0].suites.trim().split(/\s+/),suites.slice(0,8));
  assert.deepEqual(matrix[1].suites.trim().split(/\s+/),suites.slice(8));
  const all=matrix.flatMap(x=>x.suites.trim().split(/\s+/));
  assert.equal(new Set(all).size,all.length);assert.deepEqual(all.toSorted(),suites.toSorted());
  const gate=w.jobs['l3-passed'];assert.ok(gate.needs.includes(key));assert.ok(gates.code.always.includes(key));
  assert.equal(gate.if,'always()');assert.equal(gate['continue-on-error'],undefined);
  const gateStep=gate.steps.find(s=>s.name==='L3 Code Gate');assert.ok(gateStep);
  assert.equal(gateStep.if,undefined);assert.equal(gateStep['continue-on-error'],undefined);
  assert.equal(gateStep.run,'node scripts/ci/required-gate.mjs code');
  for(const name of ['Prepare private preflight PostgreSQL 17 test binary','Diagnose pinned preflight Python startup without credentials or phone']){
    const step=job.steps.find(s=>s.name===name);assert.ok(step);assert.equal(step.if,undefined);assert.equal(step['continue-on-error'],undefined);
  }
  const pg=job.steps.find(s=>s.name==='Prepare private preflight PostgreSQL 17 test binary');
  assert.match(pg.run,/brew install postgresql@17/);assert.match(pg.run,/PREFLIGHT_TEST_PG_BIN=.*GITHUB_ENV/);
  const diag=job.steps.find(s=>s.name==='Diagnose pinned preflight Python startup without credentials or phone');
  for(const re of [/\/usr\/bin\/sandbox-exec/,/deny process-fork/,/positive\.status!==0/,/negative\.status!==1/,/PREFLIGHT_TEST_PYTHON_BIN=.*canonical/,/GITHUB_ENV/])assert.match(diag.run,re);
  const pre=job.steps.find(s=>s.name==='Run preflight native lifecycle tests on Darwin');
  const kernel=job.steps.find(s=>s.name==='Require real Darwin kernel tests');
  assert.ok(pre);assert.ok(kernel);assert.equal(pre.if,'matrix.shard == 0');assert.equal(pre['continue-on-error'],undefined);
  assert.equal(kernel.if,undefined);assert.equal(kernel['continue-on-error'],undefined);
  assert.match(pre.run,/preflight-\*\.test\.mjs/);
  assert.match(kernel.run,/^node -e "if\(process\.platform!=='darwin'\)process\.exit\(1\)"$/m);
  return {job,matrix,pre,kernel};
}
function execute(w=workflow,failed='',platform='darwin',withPreflight=true,extraPreflight=[]){
 const {matrix,pre,kernel}=validate(w),root=mkdtempSync(join(tmpdir(),'darwin-ci-union-'));
 try{
  const bin=join(root,'bin');mkdirSync(bin);
  assert.ok(preflightFiles.length>=2);
  if(withPreflight)for(const path of [...preflightFiles,...extraPreflight]){
    const full=join(root,path);mkdirSync(join(full,'..'),{recursive:true});
    writeFileSync(full,`import test from 'node:test'; import assert from 'node:assert/strict'; import {relative} from 'node:path'; import {fileURLToPath} from 'node:url'; test('isolated fixture',()=>assert.notEqual(process.env.FAIL_TARGET,relative(process.cwd(),fileURLToPath(import.meta.url))));`);
  }
  writeFileSync(join(bin,'node'),`#!/bin/bash\nprintf '%s\\0' node "$@" __END__ >> "$TRACE"\nif [ "$1" = -e ]; then exec "$REAL_NODE" -e "Object.defineProperty(process,'platform',{value:'$TEST_PLATFORM'}); $2"; fi\ncase " $* " in *'/preflight-'*) exec "$REAL_NODE" "$@";; esac\ncase " $* " in *" $FAIL_TARGET "*) exit 41;; esac\n`,{mode:0o755});
  writeFileSync(join(bin,'python3'),`#!/bin/bash\nprintf '%s\\0' python3 "$@" __END__ >> "$TRACE"\ncase " $* " in *" $FAIL_TARGET "*) exit 41;; esac\n`,{mode:0o755});
  const statuses=[],callsByShard=[];
  for(const row of matrix){
    const trace=join(root,'trace-'+row.shard);writeFileSync(trace,'');
    const script=(row.shard===0?pre.run+'\n':'')+kernel.run.replaceAll('${{ matrix.suites }}',row.suites).replaceAll('${{ matrix.shard }}',String(row.shard));
    const env={...process.env,PATH:bin+':'+process.env.PATH,TRACE:trace,FAIL_TARGET:failed,REAL_NODE:process.execPath,TEST_PLATFORM:platform};delete env.NODE_TEST_CONTEXT;
    const r=spawnSync('bash',['-e','-o','pipefail','-c',script],{cwd:root,encoding:'utf8',timeout:10000,env});
    statuses.push(r.status);assert.equal(r.signal,null,r.stderr);
    const chunks=readFileSync(trace,'utf8').split('\0').filter(Boolean),calls=[];let cur=[];
    for(const word of chunks){if(word==='__END__'){calls.push(cur);cur=[];}else cur.push(word);}
    assert.equal(cur.length,0);callsByShard.push(calls);
  }
  return {statuses,callsByShard,calls:callsByShard.flat()};
 }finally{rmSync(root,{recursive:true,force:true});}
}
function codeGate(result){
 const gate=runCodeGate(workflow,'success',{[key]:result==='missing'?null:result});
 return gate.status;
}
function assertShardCoverage(callsByShard){
 const [a,b]=callsByShard;
 const aPre=a.filter(isPreflight),bPre=b.filter(isPreflight);assert.equal(aPre.length,1);assert.equal(bPre.length,0);
 assert.deepEqual(aPre[0].slice(3).sort(),preflightFiles);
 for(const file of py){assert.equal(a.filter(c=>c[0]==='python3'&&c[1]===file).length,1,file);assert.equal(b.filter(c=>c.includes(file)).length,0,file);}
}

test('两片真实 YAML 命令恰好一次执行公共组且完整各执行本片 Darwin 组',()=>{
 const {statuses,calls,callsByShard}=execute();assert.deepEqual(statuses,[0,0]);assertShardCoverage(callsByShard);
 const p=calls.filter(isPreflight);
 assert.equal(p.length,1);assert.deepEqual(p[0].slice(0,3),['node','--test','--test-concurrency=1']);
 for(const file of py)assert.equal(calls.filter(c=>c[0]==='python3'&&c[1]===file).length,1,file);
 assert.equal(calls.filter(c=>c[0]==='node'&&c[1]==='-e').length,2,'both real Darwin guards remain');
 const seen=calls.filter(c=>c[0]==='node'&&c[1]==='--test'&&!isPreflight(c)).flatMap(c=>c.slice(3));
 assert.equal(new Set(seen).size,seen.length);assert.deepEqual(seen.toSorted(),suites.toSorted());
 assert.equal(codeGate('success'),0);
});
test('公共 preflight、三项 Python 和两片专属套件失败均阻断 L3',()=>{
 for(const failure of [...preflightFiles,...py,suites[0],suites.at(-1)]){
  const {statuses}=execute(workflow,failure);assert.ok(statuses.some(s=>s!==0),failure);
  assert.notEqual(codeGate('failure'),0);
 }
 for(const status of ['skipped','cancelled','missing'])assert.notEqual(codeGate(status),0);
 assert.notEqual(execute(workflow,'','darwin',false).statuses[0],0,'no glob match must fail with real Node');
 const invalid=execute(workflow,'','linux');assert.deepEqual(invalid.statuses,[1,1]);
});
test('含特殊字符的文件名作为数据处理，仍能逐文件触发失败',()=>{
 const path='services/phone-adb-controller/__tests__/preflight-quote\'"`\n\u2028.test.mjs';
 const good=execute(workflow,'','darwin',true,[path]);
 assert.deepEqual(good.statuses,[0,0]);
 assert.ok(good.callsByShard[0].some(c=>c.includes(path)));
 const failed=execute(workflow,path,'darwin',true,[path]);
 assert.notEqual(failed.statuses[0],0);
 assert.equal(failed.statuses[1],0);
});
test('遗漏、重复、跳过、吞错或修改平台与门禁的变体都不能通过合同',()=>{
 const mutations=[
  w=>{w.jobs[key].strategy.matrix.include.splice(0,1)},
  w=>{w.jobs[key].strategy.matrix.include[1].shard=0},
  w=>{w.jobs[key].strategy.matrix.include[1].suites=''},
  w=>{w.jobs[key].strategy.matrix.include[1].suites=w.jobs[key].strategy.matrix.include[0].suites},
  w=>{const m=w.jobs[key].strategy.matrix.include;[m[0].suites,m[1].suites]=[m[1].suites,m[0].suites]},
  w=>{w.jobs[key].steps.find(s=>s.name==='Run preflight native lifecycle tests on Darwin').if='matrix.shard == 2'},
  w=>{w.jobs[key].steps.find(s=>s.name==='Run preflight native lifecycle tests on Darwin').if=undefined},
  w=>{w.jobs[key].steps.find(s=>s.name==='Run preflight native lifecycle tests on Darwin')['continue-on-error']=true},
  w=>{w.jobs[key].steps.find(s=>s.name==='Run preflight native lifecycle tests on Darwin').run='node --test --test-concurrency=1 '+preflight},
  w=>{w.jobs[key].steps.find(s=>s.name==='Require real Darwin kernel tests')['continue-on-error']=true},
  w=>{const s=w.jobs[key].steps.find(s=>s.name==='Require real Darwin kernel tests');s.run=s.run.replace("= '0'","= '1'")},
  w=>{const s=w.jobs[key].steps.find(s=>s.name==='Require real Darwin kernel tests');s.run=s.run.replace('process.exit(1)','process.exit(0)')},
  w=>{w.jobs[key].steps.find(s=>s.name==='Require real Darwin kernel tests').run=w.jobs[key].steps.find(s=>s.name==='Require real Darwin kernel tests').run.replace(py[0],'missing.py')},
  w=>{w.jobs[key].steps.find(s=>s.name==='Require real Darwin kernel tests').run+='\npython3 '+py[0]},
  w=>{w.jobs[key].steps.find(s=>s.name==='Require real Darwin kernel tests').run=w.jobs[key].steps.find(s=>s.name==='Require real Darwin kernel tests').run.replace('python3 '+py[0],'python3 '+py[0]+' || true')},
  w=>{w.jobs[key]['timeout-minutes']=20},
  w=>{w.jobs[key]['runs-on']='ubuntu-latest'},
  w=>{w.jobs[key].steps.find(s=>s.name==='Diagnose pinned preflight Python startup without credentials or phone').if='false'},
  w=>{w.jobs['l3-passed'].needs=w.jobs['l3-passed'].needs.filter(n=>n!==key)},
  w=>{w.jobs['l3-passed'].if='always() && false'},
  w=>{w.jobs['l3-passed']['continue-on-error']=true},
  w=>{w.jobs['l3-passed'].steps.find(s=>s.name==='L3 Code Gate').if='false'},
  w=>{w.jobs['l3-passed'].steps.find(s=>s.name==='L3 Code Gate')['continue-on-error']=true},
 ];
 for(const [index,mutate] of mutations.entries()){
  const w=structuredClone(workflow);mutate(w);
  assert.throws(()=>{
   const {statuses,calls,callsByShard}=execute(w);
   assert.deepEqual(statuses,[0,0]);assertShardCoverage(callsByShard);
   assert.notEqual(execute(w,'','darwin',false).statuses[0],0,'empty glob cannot pass');
   for(const file of py)assert.equal(calls.filter(c=>c[0]==='python3'&&c[1]===file).length,1);
   for(const target of [preflightFiles[0],...py])assert.ok(execute(w,target).statuses.some(s=>s!==0));
  },'mutation '+index);
 }
});

test('两片分别证明 shard0 独占公共套件，且真实 Darwin 防护不能移除',()=>{
  const result=execute();
  assert.ok(Array.isArray(result.callsByShard),'separate shard traces required');
  for(const file of py) {
    assert.equal(result.callsByShard[0].filter(c=>c.includes(file)).length,1);
    assert.equal(result.callsByShard[1].filter(c=>c.includes(file)).length,0);
  }
  const changed=structuredClone(workflow),step=changed.jobs[key].steps.find(s=>s.name==='Require real Darwin kernel tests');
  step.run=step.run.replace("process.exit(1)","process.exit(0)");
  assert.throws(()=>validate(changed),'Darwin false positive must be rejected');
});

test('两片都保留真实 PostgreSQL 和 nofork Python 准备，删除关键准备应失败',()=>{
 for(const [name,change] of [
   ['Prepare private preflight PostgreSQL 17 test binary',s=>{s.run=s.run.replace('brew install postgresql@17','true')}],
   ['Prepare private preflight PostgreSQL 17 test binary',s=>{s.run=s.run.replace('PREFLIGHT_TEST_PG_BIN','IGNORED_PG_BIN')}],
   ['Diagnose pinned preflight Python startup without credentials or phone',s=>{s.run=s.run.replaceAll('/usr/bin/sandbox-exec','/usr/bin/true')}],
   ['Diagnose pinned preflight Python startup without credentials or phone',s=>{s.run=s.run.replace('negative.status!==1','false')}],
   ['Diagnose pinned preflight Python startup without credentials or phone',s=>{s.run=s.run.replace('PREFLIGHT_TEST_PYTHON_BIN','IGNORED_PYTHON')}],
 ]) {
  const w=structuredClone(workflow);change(w.jobs[key].steps.find(s=>s.name===name));
  assert.throws(()=>validate(w),name);
 }
});
