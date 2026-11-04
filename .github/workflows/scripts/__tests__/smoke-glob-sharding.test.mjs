import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {parse} from 'yaml';

const requiredDuplicates=['dashboard-license-smoke.sh','line04-crm-view-prefs-smoke.sh'];
const helpers = ['remote-adb.sh','line02-android-accessibility-ui.sh','line02-android-cancel-candidate-setup.sh','remote-android-install.sh','line02-android-cancel-candidate-cleanup.sh'];
const workflow = readFileSync(new URL('../../ci-smoke-glob-runner.yml', import.meta.url), 'utf8');
function step(name) {
  const tail = workflow.split(`      - name: ${name}\n`)[1];
  assert.ok(tail, `正式 workflow 缺步骤 ${name}`);
  const run = tail.split('        run: |\n')[1];
  assert.ok(run);
  return run.split('\n').slice(0, run.split('\n').findIndex(line => line && !line.startsWith('          ')))
    .map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
}
const caller = step('Discover + run all CI-capable smoke scripts (ratchet gate)');
function fixture(t, { fail = false, denied = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'smoke-glob-shards-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, '.github/workflows/scripts/smoke');
  mkdirSync(dir, { recursive: true });
  const names = ['a-smoke.sh', 'b-smoke.sh', 'c-smoke.sh', 'd-smoke.sh'];
  if (denied) names.push('account-scan-realmachine-smoke.sh');
  for (const name of names) writeFileSync(join(dir, name), `#!/bin/bash\nprintf '%s\\n' '${name}' >> "$TRACE"\nexit ${fail && name === 'b-smoke.sh' ? 7 : 0}\n`);
  writeFileSync(join(root, '.github/workflows/scripts/smoke-baseline.txt'), names.filter(n => n !== 'account-scan-realmachine-smoke.sh').join('\n') + '\n');
  const helperManifest = {schema_version:1, helpers:helpers.map(name=>({name,reason:'Explicit transport/device setup helper, requires caller context.',consumers:['.github/workflows/e2e-line02-android-collect.yml']}))};
  writeFileSync(join(root,'.github/workflows/scripts/smoke-helpers.json'),JSON.stringify(helperManifest));
  writeFileSync(join(root,'.github/workflows/e2e-line02-android-collect.yml'),helpers.join('\n'));
  for(const name of helpers)writeFileSync(join(dir,name),`#!/bin/bash\nprintf '%s\n' '${name}' >> "$TRACE"\nexit 97\n`);
  const selector=new URL('../smoke-selection.py',import.meta.url);
  if(existsSync(selector))cpSync(selector,join(root,'.github/workflows/scripts/smoke-selection.py'));
  for(const name of requiredDuplicates)writeFileSync(join(dir,name),`#!/bin/bash\nprintf '%s\n' '${name}' >> "$TRACE"\nexit 98\n`);
  const requiredManifest=new URL('../smoke-required-duplicates.json',import.meta.url);
  if(existsSync(requiredManifest))cpSync(requiredManifest,join(root,'.github/workflows/scripts/smoke-required-duplicates.json'));
  else writeFileSync(join(root,'.github/workflows/scripts/smoke-required-duplicates.json'),JSON.stringify({schema_version:1,duplicates:requiredDuplicates.map(name=>({name}))}));
  cpSync(new URL('../../ci-l4-e2e-smoke.yml',import.meta.url),join(root,'.github/workflows/ci-l4-e2e-smoke.yml'));
  return { root, names };


}
function run(root, index, count = 2, extraEnv = {}) {
  const output = join(root, `worker-${index}`);
  mkdirSync(output, { recursive: true });
  const result = spawnSync('bash', ['-c', caller], { cwd: root, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, RUNNER_TEMP: output, GITHUB_SHA: 'f'.repeat(40), GITHUB_STEP_SUMMARY: join(output, 'summary.md'),
      TRACE: join(output, 'trace'), SMOKE_SHARD_INDEX: String(index), SMOKE_SHARD_COUNT: String(count), ...extraEnv } });
  return { ...result, output };
}
function rows(output, index) {
  return readFileSync(join(output, `smoke-glob-shard-${index}/results.tsv`), 'utf8').trim().split('\n').filter(Boolean).map(line => line.split('\t'));
}
test('正式工作流两隔离worker、25分钟不加预算、全部worker结束才聚合原required名字', () => {
  assert.match(workflow, /smoke-glob-shards:\n/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /shard: \[0, 1\]/);
  assert.match(workflow, /SMOKE_SHARD_COUNT: '2'/);
  const shard = workflow.split('  smoke-glob-shards:')[1]?.split('  smoke-glob-runner:')[0];
  assert.match(shard, /timeout-minutes: 25/);
  assert.match(shard, /services:\n      postgres:/);
  assert.match(shard, /Run apps\/api\/db migrations/);
  const aggregator = workflow.split('  smoke-glob-runner:')[1]?.split('  baseline-lint:')[0];
  assert.match(aggregator, /name: Smoke Glob Runner/);
  assert.match(aggregator, /needs: \[smoke-glob-shards\]/);
  assert.match(aggregator, /needs\.smoke-glob-shards\.result/);
  assert.match(shard, /if: always\(\)\n        uses: actions\/upload-artifact@v4/);
});
test('完整正式inline caller两分片真正执行全部脚本一次，denylist只保原SKIP', t => {
  const { root, names } = fixture(t, { denied: true });
  const workers = [run(root, 0), run(root, 1)];
  for (const r of workers) assert.equal(r.status, 0, r.stderr);
  const all = workers.flatMap((r, i) => rows(r.output, i));
  assert.deepEqual(all.map(r => r[0]).sort(), names.sort());
  assert.equal(new Set(all.map(r => r[0])).size, names.length);
  assert.equal(all.find(r => r[0] === 'account-scan-realmachine-smoke.sh')[1], 'SKIP');
  const actual = workers.flatMap(r => readFileSync(join(r.output, 'trace'), 'utf8').trim().split('\n'));
  assert.deepEqual(actual.sort(), names.filter(n => n !== 'account-scan-realmachine-smoke.sh').sort());
});
test('分片并不放过基线失败：实际caller同脚本最多一次重试仍exit1并完整记录', t => {
  const { root } = fixture(t, { fail: true });
  const r = run(root, 1);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(rows(r.output, 1).find(row => row[0] === 'b-smoke.sh')[1], 'GATE-FAIL');
  assert.equal(readFileSync(join(r.output, 'trace'), 'utf8').split('\n').filter(n => n === 'b-smoke.sh').length, 2);
});
test('错误分片参数必须执行前拒绝，不产生任何脚本副作用', t => {
  const { root } = fixture(t);
  for (const [index, count] of [[-1, 2], [2, 2], [0, 0], ['bad', 2]]) {
    const r = run(root, index, count);
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(r.stdout, /→ PASS/);
  }
});
function verify(root, workersResult = 'success') {
  return spawnSync('bash', ['-c', step('Verify complete shard coverage and original gates')], { cwd: root, encoding: 'utf8',
    env: { ...process.env, GITHUB_SHA: 'f'.repeat(40), GITHUB_STEP_SUMMARY: join(root, 'aggregate-summary.md'),
      SMOKE_ARTIFACTS: root, SMOKE_SHARDS_RESULT: workersResult } });
}
function artifact(root, index) {
  return join(root, `worker-${index}/smoke-glob-shard-${index}`);
}
test('正式聚合器拒绝漏分片/缺行/重复行/错source，不凭worker退出0假覆盖', t => {
  const { root } = fixture(t);
  assert.equal(run(root, 0).status, 0);
  assert.notEqual(verify(root).status, 0, '只有一个worker必须红');
  assert.equal(run(root, 1).status, 0);
  assert.equal(verify(root).status, 0);
  const file = join(artifact(root, 1), 'results.tsv');
  const original = readFileSync(file, 'utf8');
  writeFileSync(file, original.trim().split('\n').slice(1).join('\n') + '\n');
  assert.notEqual(verify(root).status, 0, '缺脚本结果必须红');
  writeFileSync(file, original + original.split('\n')[0] + '\n');
  assert.notEqual(verify(root).status, 0, '重复脚本结果必须红');
  writeFileSync(file, original);
  const meta = join(artifact(root, 1), 'manifest.json');
  const value = JSON.parse(readFileSync(meta, 'utf8'));
  value.source_sha = 'e'.repeat(40);
  writeFileSync(meta, JSON.stringify(value));
  assert.notEqual(verify(root).status, 0, '错受测source必须红');
});
test('原聚合拒绝未完成/伪跳过/伪债务基线/worker失败，不修改原失败意义', t => {
  const { root } = fixture(t);
  const workers = [run(root, 0), run(root, 1)];
  for (const r of workers) assert.equal(r.status, 0, r.stderr);
  assert.equal(verify(root).status, 0);
  assert.notEqual(verify(root, 'failure').status, 0);
  assert.notEqual(verify(root, 'cancelled').status, 0);
  const metaPath = join(artifact(root, 0), 'manifest.json');
  const originalMeta = readFileSync(metaPath, 'utf8');
  const meta = JSON.parse(originalMeta);
  meta.complete = false;
  writeFileSync(metaPath, JSON.stringify(meta));
  assert.notEqual(verify(root).status, 0);
  writeFileSync(metaPath, originalMeta);
  const file = join(artifact(root, 0), 'results.tsv');
  const originalRows = readFileSync(file, 'utf8');
  writeFileSync(file, originalRows.replace('PASS\t0', 'SKIP\t-'));
  assert.notEqual(verify(root).status, 0, '非denylist不能变成SKIP');
  writeFileSync(file, originalRows.replace('PASS\t0', 'DEBT-FAIL\t7'));
  assert.notEqual(verify(root).status, 0, '基线失败不能改标存量债');
});

test('C排序只限发现：非ASCII UTF8脚本实际执行且继承原编码环境，完整inventory顺序一致', t => {
  const { root, names } = fixture(t);
  const name = 'é-中文-smoke.sh';names.push(name);
  const dir = join(root, '.github/workflows/scripts/smoke');
  writeFileSync(join(dir, name), `#!/bin/bash\nset -eu\nprintf '%s\\n' '${name}' >> "$TRACE"\n[ "$(locale charmap)" = UTF-8 ]\nprintf '中文→é' > "$RUNNER_TEMP/中文→é.txt"\n[ "$(cat "$RUNNER_TEMP/中文→é.txt")" = '中文→é' ]\n`);
  writeFileSync(join(root, '.github/workflows/scripts/smoke-baseline.txt'), names.join('\n') + '\n');
  const locale = process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8';
  const workers = [run(root, 0, 2, { LANG: locale, LC_ALL: locale }), run(root, 1, 2, { LANG: locale, LC_ALL: locale })];
  for (const worker of workers) assert.equal(worker.status, 0, worker.stderr + worker.stdout);
  const all = workers.flatMap((worker, index) => rows(worker.output, index));
  assert.deepEqual(all.map(row => row[0]).sort(), names.sort());
  for (const [index, worker] of workers.entries()) {
    const meta = JSON.parse(readFileSync(join(worker.output, `smoke-glob-shard-${index}/manifest.json`), 'utf8'));
    assert.deepEqual(meta.inventory, names);
    assert.deepEqual(rows(worker.output, index).map(row => row[0]), names.filter((_, ordinal) => ordinal % 2 === index));
  }
  assert.equal(readFileSync(join(workers[0].output, '中文→é.txt'), 'utf8'), '中文→é');
  assert.equal(verify(root).status, 0);
});


test('真实部署回归仅精确脚本获得180秒预算，其他及近似名仍90秒', () => {
  const definition = caller.match(/script_timeout\(\) \{[\s\S]*?\n\s*}/)?.[0];
  assert.ok(definition, '必须提取正式caller的实际预算函数');
  const actual = spawnSync('bash', ['-c', definition + '\nscript_timeout phone-adb-controller-smoke.sh; script_timeout ordinary-smoke.sh; script_timeout phone-adb-controller-smoke.sh-extra'], { encoding: 'utf8' });
  assert.equal(actual.status, 0, actual.stderr);
  assert.equal(actual.stdout, '180\n90\n90\n');
});

test('正式caller强制回收忽略TERM的子进程后才返回，重试不会与残留并跑', t => {
  const { root } = fixture(t);
  const script = join(root, 'stubborn.sh');
  const pidFile = join(root, 'child.pid');
  writeFileSync(script, `#!/bin/bash\ntrap '' TERM\necho $$ > '${pidFile}'\nwhile :; do sleep 1; done\n`);
  const definition = caller.match(/run_one\(\) \{[\s\S]*?\n\s*}/)?.[0];
  assert.ok(definition);
  const result = spawnSync('bash', ['-c', `DIR='${root}'; script_timeout() { echo 0.2; }; ${definition}; run_one stubborn.sh`],
    { encoding: 'utf8', timeout: 8000, killSignal: 'SIGKILL' });
  const pid = Number(readFileSync(pidFile, 'utf8'));
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch {} });
  assert.equal(result.error, undefined, '必须在外层超时前完成子进程回收');
  assert.notEqual(result.status, 0, '超时不能标为通过');
  const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
  assert.ok(!state || state.startsWith('Z'), `子进程仍在执行: ${state}`);
});

test('Android native suites execute once in their required producer, outside Node smoke shards', () => {
  assert.doesNotMatch(workflow, /compileDebugUnitTestKotlin|setup-android|gradle\/actions\/setup-gradle/);
  const android=parse(readFileSync(new URL('../../android-agent-ci.yml',import.meta.url),'utf8'));
  const steps=android.jobs['test-and-build'].steps;
  const producer=steps.findIndex(s=>s.run==='gradle :app:testDebugUnitTest');
  const verify=steps.findIndex(s=>s.run==='bash .github/workflows/scripts/android-agent-contracts.sh --verify-results');
  assert.ok(producer>=0 && verify>producer);
  assert.ok(steps.some(s=>s.uses==='android-actions/setup-android@v3'));
  assert.equal(steps[producer]['continue-on-error'],undefined);
  assert.ok(android.jobs['android-ci-gate'].needs.includes('test-and-build'));
});

test('Staff验收API启动失败必须带原始诊断，不进入业务断言', t => {
  const {root}=fixture(t);
  for(const file of ['apps/api/src/services/acceptance.ts','apps/api/src/routes/staff.ts',
    ...['AcceptancePage','AcceptanceDetailPage','AcceptanceHistoryPage'].map(n=>'apps/staff-hub/src/pages/'+n+'.tsx')]){
    mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),'');
  }
  const bin=join(root,'fixture-bin');mkdirSync(bin);
  for(const [name,body]of Object.entries({npm:'exit 0',node:'echo STAFF_FIXTURE_STARTUP_REFUSED >&2; exit 42',curl:'exit 7',sleep:'/bin/sleep 0.01'}))
    writeFileSync(join(bin,name),'#!/bin/bash\n'+body+'\n',{mode:0o755});
  const script=readFileSync(new URL('../smoke/staff-acceptance-smoke.sh',import.meta.url),'utf8');
  const run=spawnSync('bash',['-c',script],{cwd:root,env:{...process.env,PATH:bin+':'+process.env.PATH},encoding:'utf8',timeout:5000});
  assert.notEqual(run.status,0);
  assert.match(run.stdout+run.stderr,/STAFF_FIXTURE_STARTUP_REFUSED/);
  assert.doesNotMatch(run.stdout,/三个验收端点无认证头/);
});

test('OpenClaw三片完整覆盖原两片文件集合，失败片不能报通过',t=>{
 const source=readFileSync(new URL('../../ci-l3-code.yml',import.meta.url),'utf8');
 const job=source.split('  openclaw-scripts-test:')[1].split('  api-scripts-test:')[0];
 assert.match(job,/shard: \[1, 2, 3\]/);assert.match(job,/fail-fast: false/);
 assert.match(job,/--test-shard=\$\{\{ matrix.shard \}\}\/3/);
 assert.match(job,/timeout-minutes: 10/);
 assert.doesNotMatch(job,/continue-on-error|test-name-pattern|test-skip-pattern/);
 const {root}=fixture(t),files=Array.from({length:8},(_,i)=>join(root,`case-${i}.test.mjs`));
 const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
 for(const [i,file]of files.entries())writeFileSync(file,`import {test} from 'node:test';import {appendFileSync} from 'node:fs';test('case-${i}',()=>appendFileSync(process.env.TRACE,'${i}\\n'));`);
 const sets=[];
 for(const shard of [1,2,3]){
  const trace=join(root,'trace-'+shard);
  const r=spawnSync(process.execPath,['--test',`--test-shard=${shard}/3`,...files],{env:{...childEnv,TRACE:trace},encoding:'utf8',timeout:10000});
  assert.equal(r.status,0,r.stderr);sets.push(readFileSync(trace,'utf8').trim().split('\n'));
 }
 assert.equal(new Set(sets.flat()).size,sets.flat().length,'三片互不重叠');
 assert.deepEqual(sets.flat().sort(),['0','1','2','3','4','5','6','7']);
 const previous=[];
 for(const shard of [1,2]){
  const trace=join(root,'old-trace-'+shard);
  const r=spawnSync(process.execPath,['--test',`--test-shard=${shard}/2`,...files],{env:{...childEnv,TRACE:trace},encoding:'utf8',timeout:10000});
  assert.equal(r.status,0,r.stderr);previous.push(...readFileSync(trace,'utf8').trim().split('\n'));
 }
 assert.deepEqual(sets.flat().sort(),previous.sort(),'原2片与新3片实际文件集合/总数完全相同');
 writeFileSync(files[0],"import {test} from 'node:test';test('must fail',()=>{throw Error('fixture');});");
 const codes=[1,2,3].map(shard=>spawnSync(process.execPath,['--test',`--test-shard=${shard}/3`,...files],{env:{...childEnv,TRACE:join(root,'failed-trace')},encoding:'utf8',timeout:10000}).status);
 assert.equal(codes.filter(x=>x!==0).length,1);
});

for(const name of helpers)test(`helper baseline overlap rejects both real worker and aggregate before execution: ${name}`,t=>{
 const {root}=fixture(t);
 const baseline=join(root,'.github/workflows/scripts/smoke-baseline.txt');
 writeFileSync(baseline,readFileSync(baseline,'utf8')+name+'\n');
 const worker=run(root,0);assert.notEqual(worker.status,0,worker.stdout+worker.stderr);
 assert.match(worker.stdout+worker.stderr,/baseline.*helper|helper.*baseline/i);
 assert.equal(existsSync(join(worker.output,'trace')),false,'reject all execution before selecting a shard');
 const independent=fixture(t).root;
 assert.equal(run(independent,0).status,0);assert.equal(run(independent,1).status,0);assert.equal(verify(independent).status,0);
 const aggregateBaseline=join(independent,'.github/workflows/scripts/smoke-baseline.txt');
 writeFileSync(aggregateBaseline,readFileSync(aggregateBaseline,'utf8')+name+'\n');
 const aggregate=verify(independent);assert.notEqual(aggregate.status,0);assert.match(aggregate.stdout+aggregate.stderr,/baseline.*helper|helper.*baseline/i);
});
test('four context-only helpers stay at original paths and outside execution; aggregate records exact exclusions',t=>{
 const {root,names}=fixture(t),workers=[run(root,0),run(root,1)];
 for(const r of workers)assert.equal(r.status,0,r.stdout+r.stderr);
 const all=workers.flatMap((r,i)=>rows(r.output,i));assert.deepEqual(all.map(r=>r[0]).sort(),names.sort());
 assert.equal(verify(root).status,0);
 for(const r of workers){const meta=JSON.parse(readFileSync(join(r.output,`smoke-glob-shard-${workers.indexOf(r)}/manifest.json`),'utf8'));assert.deepEqual(meta.excluded_helpers,helpers.slice().sort());}
 for(const name of helpers)assert.ok(existsSync(join(root,'.github/workflows/scripts/smoke',name)));
 const metaFile=join(artifact(root,0),'manifest.json'),meta=JSON.parse(readFileSync(metaFile,'utf8'));
 meta.excluded_helpers.pop();writeFileSync(metaFile,JSON.stringify(meta));assert.notEqual(verify(root).status,0,'forged helper omission rejected');
});
for(const mode of ['wildcard','unknown','duplicate','missing-file','missing-consumer','unreferenced-consumer'])test(`invalid helper selection fails closed before any side effects: ${mode}`,t=>{
 const {root}=fixture(t),file=join(root,'.github/workflows/scripts/smoke-helpers.json'),manifest=JSON.parse(readFileSync(file,'utf8'));
 if(mode==='wildcard')manifest.helpers[0].name='*.sh';
 if(mode==='unknown')manifest.helpers[0].name='absent.sh';
 if(mode==='duplicate')manifest.helpers.push(manifest.helpers[0]);
 if(mode==='missing-file')rmSync(join(root,'.github/workflows/scripts/smoke',helpers[0]));
 if(mode==='missing-consumer')manifest.helpers[0].consumers=['absent.yml'];
 if(mode==='unreferenced-consumer')writeFileSync(join(root,'.github/workflows/e2e-line02-android-collect.yml'),'unrelated caller');
 writeFileSync(file,JSON.stringify(manifest));const r=run(root,0);assert.notEqual(r.status,0,r.stdout+r.stderr);assert.equal(existsSync(join(r.output,'trace')),false);
});

test('explicit device workflow stays bounded and keeps all four helper consumers',()=>{
 const source=readFileSync(new URL('../../e2e-line02-android-collect.yml',import.meta.url),'utf8');
 const job=Object.values(parse(source).jobs).find(j=>JSON.stringify(j.steps).includes('remote-adb.sh'));
 assert.ok(Number.isInteger(job?.['timeout-minutes'])&&job['timeout-minutes']>0&&job['timeout-minutes']<=25,'explicit device caller retains finite job budget');
 for(const name of ['remote-adb.sh','remote-android-install.sh','line02-android-cancel-candidate-setup.sh'])assert.ok(JSON.stringify(job.steps).includes(name));
 for(const name of ['remote-adb.sh','remote-android-install.sh','line02-android-cancel-candidate-setup.sh'])assert.ok(source.includes(name));
 const setup=readFileSync(new URL('../smoke/line02-android-cancel-candidate-setup.sh',import.meta.url),'utf8');
 const cleanup=readFileSync(new URL('../smoke/line02-android-cancel-candidate-cleanup.sh',import.meta.url),'utf8');
 for(const caller of [setup,cleanup])assert.ok(caller.includes('line02-android-accessibility-ui.sh'));
});

for(const name of requiredDuplicates)test(`required duplicate baseline overlap is rejected without a skip exception: ${name}`,t=>{
 const {root}=fixture(t);const baseline=join(root,'.github/workflows/scripts/smoke-baseline.txt');writeFileSync(baseline,readFileSync(baseline,'utf8')+name+'\n');
 const r=run(root,0);assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/baseline/);assert.equal(existsSync(join(r.output,'trace')),false);
});
test('only two proven required duplicates excluded; both worker manifests and aggregate preserve proof',t=>{
 const {root,names}=fixture(t),workers=[run(root,0),run(root,1)];for(const r of workers)assert.equal(r.status,0,r.stdout+r.stderr);
 assert.deepEqual(workers.flatMap((r,i)=>rows(r.output,i)).map(r=>r[0]).sort(),names.sort());assert.equal(verify(root).status,0);
 for(const [i,r]of workers.entries())assert.deepEqual(JSON.parse(readFileSync(join(r.output,`smoke-glob-shard-${i}/manifest.json`),'utf8')).excluded_required,requiredDuplicates.slice().sort());
 const file=join(artifact(root,0),'manifest.json'),meta=JSON.parse(readFileSync(file,'utf8'));meta.excluded_required=[];writeFileSync(file,JSON.stringify(meta));assert.notEqual(verify(root).status,0);
});
for(const mode of ['unknown-exclusion','missing-script','missing-caller','conditional-step','nonblocking-step','nonblocking-job','missing-required-needs','weakened-required-gate'])test(`required duplicate consumer drift rejects before any smoke executes: ${mode}`,t=>{
 const {root}=fixture(t),mf=join(root,'.github/workflows/scripts/smoke-required-duplicates.json'),wf=join(root,'.github/workflows/ci-l4-e2e-smoke.yml');let source=readFileSync(wf,'utf8');const data=JSON.parse(readFileSync(mf,'utf8'));
 if(mode==='unknown-exclusion')data.duplicates.push({...data.duplicates[0],name:'a-smoke.sh'});
 if(mode==='missing-script')rmSync(join(root,'.github/workflows/scripts/smoke',requiredDuplicates[0]));
 if(mode==='missing-caller')source=source.replace('bash .github/workflows/scripts/smoke/dashboard-license-smoke.sh','echo lost contract');
 if(mode==='conditional-step')source=source.replace('      - name: Smoke — Dashboard License (Sprint A)','      - name: Smoke — Dashboard License (Sprint A)\n        if: false');
 if(mode==='nonblocking-step')source=source.replace('      - name: Smoke — Dashboard License (Sprint A)','      - name: Smoke — Dashboard License (Sprint A)\n        continue-on-error: true');
 if(mode==='nonblocking-job')source=source.replace('  smoke-api-contract:\n','  smoke-api-contract:\n    continue-on-error: true\n');
 if(mode==='missing-required-needs')source=source.replace('      - smoke-api-contract\n','');
 if(mode==='weakened-required-gate')source=source.replace('if [ "$RESULT" != "success" ]; then','if false; then');
 writeFileSync(wf,source);writeFileSync(mf,JSON.stringify(data));const r=run(root,0);assert.notEqual(r.status,0,r.stdout+r.stderr);assert.equal(existsSync(join(r.output,'trace')),false);
});
test('real required L4 E2E shell remains fail-closed for API job success/failure/cancel/skip/missing',()=>{
 const w=parse(readFileSync(new URL('../../ci-l4-e2e-smoke.yml',import.meta.url),'utf8')),gate=w.jobs['l4-e2e-passed'],job=w.jobs['smoke-api-contract'];
 assert.equal(gate.name,'L4 E2E Gate Passed');assert.equal(gate.if,'always()');assert.ok(gate.needs.includes('smoke-api-contract'));assert.equal(job.if,undefined);assert.notEqual(job['continue-on-error'],true);
 for(const name of requiredDuplicates){const step=job.steps.find(s=>s.run?.includes('bash .github/workflows/scripts/smoke/'+name));assert.ok(step);assert.equal(step.if,undefined);assert.notEqual(step['continue-on-error'],true);}
 for(const state of ['success','failure','cancelled','skipped','']){
  const script=gate.steps.find(s=>s.run).run.replace(/\$\{\{ needs\.([a-z0-9-]+)\.result \}\}/g,(_,name)=>name==='smoke-api-contract'?state:'success');
  const r=spawnSync('bash',['-e','-o','pipefail','-c',script],{encoding:'utf8'});assert.equal(r.status===0,state==='success',r.stdout+r.stderr);
 }
});
