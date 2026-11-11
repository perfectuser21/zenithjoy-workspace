import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import YAML from 'yaml';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {gates,checkGate} from '../required-gate.mjs';
import {PHONE_DARWIN_SUITES} from '../native-phone-ci-selection.mjs';

test('native 103 PG and Darwin tests have a required owned-fixture CI path',()=>{
 const doc=YAML.parse(readFileSync(new URL('../../../.github/workflows/ci-l3-code.yml',import.meta.url),'utf8'));
 const job=doc.jobs['native-103-darwin-test'];
 assert.ok(job,'normal 103 must run on a real Darwin kernel with its own PG');
 assert.equal(job['runs-on'],'macos-latest');
 const commands=job.steps.filter(s=>s.run).map(s=>s.run).join('\n');
 assert.match(commands,/brew install postgresql@17/);
 assert.match(commands,/scripts\/ci\/native-103-darwin-tests\.mjs/);
 assert.ok(doc.jobs['l3-passed'].needs.includes('native-103-darwin-test'));
 assert.ok(gates.code.always.includes('native-103-darwin-test'));
 const needs={changes:{result:'success',outputs:Object.fromEntries(gates.code.routes.map(k=>[k,'false']))},...Object.fromEntries(gates.code.always.map(k=>[k,{result:'success'}]))};
 assert.doesNotThrow(()=>checkGate('code',needs));
 needs['native-103-darwin-test']={result:'skipped'};
 assert.throws(()=>checkGate('code',needs),/native-103-darwin-test=skipped/);
 const linux=doc.jobs['openclaw-scripts-test'].steps.find(s=>s.name?.startsWith('node --test scripts/openclaw')).run;
 const selection=linux.replace(/^node --test.*$/m,'printf "%s\\n" "${phone_tests[@]}"');
 const result=spawnSync('/bin/bash',['-c',selection],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 const selected=result.stdout.trim().split('\n');
 for(const name of ['transaction','public-executor','producers'])assert.equal(selected.some(p=>p.endsWith('native-103-'+name+'.test.mjs')),false);
 for(const name of ['claim','control-scope','public'])assert.ok(selected.some(p=>p.endsWith('native-103-'+name+'.test.mjs')));
 const lifecycle=readFileSync(new URL('../native-103-darwin-tests.mjs',import.meta.url),'utf8');
 for(const suite of ['native-103-public-executor','native-103-transaction','native-103-producers','native-103-claim','native-103-control-scope','native-103-public','native-activity-authority','native-task-lease'])assert.ok(lifecycle.includes(suite+'.test.mjs'),suite);
 assert.ok(lifecycle.includes('phone-lock-clean-bootstrap.test.py'));
 assert.match(lifecycle,/ZJ_NATIVE_103_PG_FIXTURE/);
 assert.doesNotMatch(lifecycle,/15532|brew services|process\.kill\(/);
});

test('native phone 101 runs in the same required Darwin PG owner with pinned Pillow and scoped debug artifacts',()=>{
 const workflow=YAML.parse(readFileSync(new URL('../../../.github/workflows/ci-l3-code.yml',import.meta.url),'utf8'));
 const job=workflow.jobs['native-103-darwin-test'],commands=job.steps.filter(s=>s.run).map(s=>s.run).join('\n');
 const lifecycle=readFileSync(new URL('../native-103-darwin-tests.mjs',import.meta.url),'utf8');
 assert.ok(lifecycle.includes('...PHONE_DARWIN_SUITES'),'the actual owned-PG driver must run public 101');
 assert.ok(PHONE_DARWIN_SUITES.includes('native-phone-public-executor.test.mjs'));
 assert.equal(PHONE_DARWIN_SUITES.length,18);assert.equal(new Set(PHONE_DARWIN_SUITES).size,18);
 assert.equal(PHONE_DARWIN_SUITES.some(s=>/audio|source-delivery/.test(s)),false);
 assert.match(commands,/python@3\.14/);assert.match(commands,/Pillow==12\.2\.0/);assert.match(commands,/PREFLIGHT_TEST_PIL_ROOT/);
 assert.match(commands,/PREFLIGHT_TEST_PHONE_ARTIFACTS/);
 assert.ok(job.steps.some(s=>s.uses==='actions/upload-artifact@v4'&&s.if==='failure()'),'CI debug must remain available after a failed phone scenario');
 const scenario=readFileSync(new URL('../../../services/phone-adb-controller/__tests__/fixtures/native-phone-public-scenario.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(scenario,/\/Users\/administrator\//,'hosted fixtures cannot write the developer home');
 const linux=workflow.jobs['openclaw-scripts-test'].steps.find(s=>s.name?.startsWith('node --test scripts/openclaw')).run;
 const selection=linux.replace(/^node --test.*$/m,'printf "%s\\n" "${phone_tests[@]}"');
 const selected=spawnSync('/bin/bash',['-c',selection],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),encoding:'utf8'});
 assert.equal(selected.status,0,selected.stderr);
 for(const name of PHONE_DARWIN_SUITES)assert.equal(selected.stdout.split('\n').some(path=>path.endsWith('/'+name)),false,name+' must be covered by real Darwin instead of a Linux platform skip');
 // Root adds this genuine filename in its separate Source commit. Supply only
 // selector input here; do not invent its policy, implementation or test body.
 const futureSelection=selection.replace('for path in services/phone-adb-controller/__tests__/*.test.mjs; do','for path in services/phone-adb-controller/__tests__/native-phone-source-delivery.test.mjs services/phone-adb-controller/__tests__/native-phone-public-executor.test.mjs; do');
 assert.notEqual(futureSelection,selection);
 const future=spawnSync('/bin/bash',['-c',futureSelection],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),encoding:'utf8'});
 assert.equal(future.status,0,future.stderr);
 assert.deepEqual(future.stdout.trim().split('\n'),['services/phone-adb-controller/__tests__/native-phone-source-delivery.test.mjs'],'formal Source packaging keeps Linux selection; public 101 stays in required Darwin');
});

test('public Code preflight and epoch producer native regressions require an owned hosted Darwin job',()=>{
 const doc=YAML.parse(readFileSync(new URL('../../../.github/workflows/ci-l3-code.yml',import.meta.url),'utf8'));
 const key='public-code-phone-darwin-test',job=doc.jobs[key];assert.ok(job,'Linux platform skips do not cover the public Code native boundary');
 assert.equal(job['runs-on'],'macos-latest');assert.equal(job['timeout-minutes'],10);
 const commands=job.steps.filter(s=>s.run).map(s=>s.run).join('\n');
 for(const name of ['public-code-preflight.test.mjs','phone-epoch-producer.test.mjs'])assert.ok(commands.includes('services/phone-adb-controller/__tests__/'+name),name);
 assert.match(commands,/process\.platform.*darwin/);assert.match(commands,/PREFLIGHT_TEST_PYTHON_BIN/);
 assert.ok(doc.jobs['l3-passed'].needs.includes(key));assert.ok(gates.code.always.includes(key));
 const needs={changes:{result:'success',outputs:Object.fromEntries(gates.code.routes.map(k=>[k,'false']))},...Object.fromEntries(gates.code.always.map(k=>[k,{result:'success'}]))};
 assert.doesNotThrow(()=>checkGate('code',needs));needs[key]={result:'skipped'};assert.throws(()=>checkGate('code',needs),/public-code-phone-darwin-test=skipped/);
 assert.equal(doc.jobs['collection-phone-darwin-test']['timeout-minutes'],10,'existing Darwin budget remains unchanged');
});

test('both collection Darwin shards retain every original kernel file and fail the required aggregate on any shard failure',()=>{
 const doc=YAML.parse(readFileSync(new URL('../../../.github/workflows/ci-l3-code.yml',import.meta.url),'utf8'));
 const key='collection-phone-darwin-test',job=doc.jobs[key],matrix=job.strategy?.matrix?.include;
 assert.equal(job.strategy?.['fail-fast'],false,'one shard failure must not cancel the other evidence');
 assert.equal(matrix?.length,2,'split the aggregate workload without increasing the original job budget');
 const expected=['adb-host-terminal','native-operation-ipc','native-operation-identity','native-operation-races','discovery-phase-budget','discovery-cleanup-scope','collection-leaf-returned','uiautomator-dump-crash','collection-returned-authority','collection-panel-readback','collection-leaf-scope','collection-phone-proof','collection-evidence-layout','collection-cleanup-only','proxy-version-deadline'].map(n=>'services/phone-adb-controller/__tests__/'+n+'.test.mjs');
 const actual=matrix.flatMap(row=>row.suites.trim().split(/\s+/));assert.equal(new Set(actual).size,actual.length);assert.deepEqual(actual.toSorted(),expected.toSorted());
 assert.deepEqual(matrix.map(row=>row.shard).toSorted(),[0,1]);assert.equal(job['timeout-minutes'],10);assert.equal(job['runs-on'],'macos-latest');
 const kernel=job.steps.find(s=>s.name==='Require real Darwin kernel tests').run;
 assert.match(kernel,/node --test --test-concurrency=1 \$\{\{ matrix\.suites \}\}/);
 for(const name of ['collection-review-maintenance.test.py','collection-review-gap.test.py','collection-review-maintenance-claim.test.py'])assert.ok(kernel.includes(name));
 assert.ok(job.name.includes('${{ matrix.shard }}'));assert.ok(doc.jobs['l3-passed'].needs.includes(key));assert.ok(gates.code.always.includes(key));
 for(const result of ['failure','cancelled','skipped','missing']){
  const needs={changes:{result:'success',outputs:Object.fromEntries(gates.code.routes.map(k=>[k,'false']))},...Object.fromEntries(gates.code.always.map(k=>[k,{result:'success'}])),[key]:{result}};
  assert.throws(()=>checkGate('code',needs),/collection-phone-darwin-test/);
 }
});

test('the public 101 file has a fresh required Darwin PG shard and the union retains all original 26 suites',()=>{
 const doc=YAML.parse(readFileSync(new URL('../../../.github/workflows/ci-l3-code.yml',import.meta.url),'utf8'));
 const key='native-103-darwin-test',job=doc.jobs[key],groups=job.strategy?.matrix?.shard;
 assert.deepEqual(groups,['remaining','public101']);assert.equal(job.strategy['fail-fast'],false);assert.equal(job['timeout-minutes'],20);assert.equal(job['runs-on'],'macos-latest');
 const step=job.steps.find(s=>s.name==='Run native 103 public executor and real transaction failure paths');
 assert.equal(step.env.NATIVE_103_DARWIN_SHARD,'${{ matrix.shard }}');assert.match(step.run,/native-103-ci-lifecycle\.test\.mjs/);
 const cwd=fileURLToPath(new URL('../../../',import.meta.url)),list=group=>{
  const r=spawnSync(process.execPath,['scripts/ci/native-103-darwin-tests.mjs','--list-suites',group],{cwd,encoding:'utf8',env:{...process.env,PREFLIGHT_TEST_PG_BIN:'/not-used-in-a-readonly-selection'}});
  assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
 };
 const expected=['native-103-public-executor.test.mjs','native-103-transaction.test.mjs','native-103-producers.test.mjs','native-103-claim.test.mjs','native-103-control-scope.test.mjs','native-103-public.test.mjs','native-activity-authority.test.mjs','native-task-lease.test.mjs',...PHONE_DARWIN_SUITES];
 const publicFiles=list('public101'),remaining=list('remaining'),union=[...remaining,...publicFiles];
 assert.deepEqual(publicFiles,['native-phone-public-executor.test.mjs']);assert.equal(remaining.length,25);assert.equal(new Set(union).size,26);assert.deepEqual(union.toSorted(),expected.toSorted());assert.deepEqual(list('all').toSorted(),expected.toSorted());
 const bad=spawnSync(process.execPath,['scripts/ci/native-103-darwin-tests.mjs','--list-suites','missing'],{cwd,encoding:'utf8'});assert.notEqual(bad.status,0);
 const lifecycle=readFileSync(new URL('../native-103-darwin-tests.mjs',import.meta.url),'utf8');assert.match(lifecycle,/--test-concurrency=1/);assert.match(lifecycle,/selectedSuites\.map/);assert.match(lifecycle,/mkdtempSync/);assert.match(lifecycle,/CREATE DATABASE cecelia_scratch/);assert.match(lifecycle,/pg\.kill\('SIGTERM'\)/);
 assert.ok(job.name.includes('${{ matrix.shard }}'));assert.ok(doc.jobs['l3-passed'].needs.includes(key));assert.ok(gates.code.always.includes(key));assert.ok(job.steps.some(s=>s.uses==='actions/upload-artifact@v4'&&s.with.name.includes('${{ matrix.shard }}')));
 for(const result of ['failure','cancelled','skipped','missing']){
  const needs={changes:{result:'success',outputs:Object.fromEntries(gates.code.routes.map(k=>[k,'false']))},...Object.fromEntries(gates.code.always.map(k=>[k,{result:'success'}])),[key]:{result}};
  assert.throws(()=>checkGate('code',needs),/native-103-darwin-test/);
 }
});
