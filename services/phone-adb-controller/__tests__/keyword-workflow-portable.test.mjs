import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { keywordFixture } from './keyword-workflow-cli-fixture.mjs';
import { cli, service, compiler } from './workflow-cli-fixture.mjs';

const require = createRequire(import.meta.url);
const { runKeywordWorkflow } = require('../keyword-workflow.js');
const runtime = process.env.CECELIA_ACTIVITY_RUNTIME;
const bindings = join(service, 'plans/keyword_workflow.bindings.json');
const projection = join(service, 'plans/keyword_workflow.contract.json');
const input = { run_tag: 'portable-test', line_key: 'jinuo',
  device: { profile: 'jinoshengyuan-work', serial: 'fixture-serial', lock_holder: 'portable-test' },
  account: { sender_id: 'fixture-account' }, keywords: [{ word: 'AI 报名', max_videos: 1 }] };

function compile(file = bindings) {
  const out = spawnSync(process.execPath, [compiler, 'keyword_acquisition', '--json', '--bindings', file], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout);
}

function deviceBundle(directory) {
  const deploy = readFileSync(join(service, 'deploy.sh'), 'utf8');
  const files = ['DEVICE_SH_FILES', 'DEVICE_NODE_FILES', 'DEVICE_PLAN_FILES'].flatMap(name => {
    const body = new RegExp('^' + name + '=\\(([\\s\\S]*?)\\)', 'm').exec(deploy)?.[1];
    assert.ok(body, '部署清单缺 ' + name);
    return body.replace(/#[^\n]*/g, '').trim().split(/\s+/);
  });
  for (const file of files) {
    const target = join(directory, file);
    mkdirSync(join(target, '..'), { recursive: true });
    copyFileSync(join(service, file), target);
  }
  return files;
}

test('完整 JSON 编译投影与真实契约、绑定组装完全一致', () => {
  assert.equal(existsSync(projection), true, '缺少可携带契约编译投影');
  assert.deepEqual(JSON.parse(readFileSync(projection, 'utf8')), compile());
});

test('显式 contract 缺失或非法必须在编译器与 runtime 调用前拒绝', async t => {
  const home = mkdtempSync(join(tmpdir(), 'portable-contract-invalid-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const malformed = join(home, 'malformed.json'); writeFileSync(malformed, '{');
  const empty = join(home, 'empty.json'); writeFileSync(empty, JSON.stringify({ contract: { activities: [] } }));
  const invalidShape = join(home, 'invalid-shape.json');
  writeFileSync(invalidShape, JSON.stringify({ contract: { activities: '不是活动数组' } }));
  for (const contract of [join(home, 'missing.json'), malformed, empty, invalidShape]) {
    let calls = 0;
    const result = await runKeywordWorkflow(input, { runtime: process.execPath, contract,
      invoke: async () => { calls++; throw Error('不能调用编译器或 runtime'); } });
    assert.equal(calls, 0, contract);
    assert.equal(result.reason_code, 'invalid_workflow_contract');
    assert.equal(result.status, 'failed');
  }
});

test('contract 与 bindings 同时显式提供必须拒绝，不能静默忽略', async () => {
  let calls = 0;
  const result = await runKeywordWorkflow(input, { runtime: process.execPath, contract: projection, bindings,
    invoke: async () => { calls++; throw Error('不能调用编译器或 runtime'); } });
  assert.equal(calls, 0);
  assert.equal(result.reason_code, 'workflow_contract_binding_conflict');
});

test('真实runtime运输逐byte拆开UTF-8时保留中文产物及回执一致', async t => {
  const home = mkdtempSync(join(tmpdir(), 'portable-utf8-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const entry = join(home, 'runtime.js');
  const receipt = join(home, 'receipt.json');
  writeFileSync(entry, `const fs=require('node:fs');
const {input}=JSON.parse(fs.readFileSync(0,'utf8'));
const out={schema_version:1,run_tag:input.run_tag,status:'completed',
outputs:{comments:[{fields:{评论原文:'中文🙂'}}]},metrics:{},evidence:[]};
const text=JSON.stringify(out);fs.writeFileSync(process.argv[process.argv.indexOf('--receipt')+1],text);
const bytes=Buffer.from(text),at=bytes.indexOf(Buffer.from('中'))+1;
process.stdout.write(bytes.subarray(0,at));setTimeout(()=>process.stdout.write(bytes.subarray(at)),30);`);
  const result = await runKeywordWorkflow(input, { runtime: entry, contract: projection, receipt });
  assert.equal(result.status, 'completed');
  assert.equal(result.outputs.comments[0].fields.评论原文, '中文🙂');
  assert.deepEqual(result, JSON.parse(readFileSync(receipt, 'utf8')));
});

for (const withoutScore of [false, true]) {
  test(`隔离平铺部署目录使用显式 contract 跑真实 Cec CLI${withoutScore ? '，删除评分仅替换编译产物' : ' 与完整七活动'}`, { timeout: 60000 }, async t => {
    assert.ok(runtime, '必须显式提供 CECELIA_ACTIVITY_RUNTIME，不可跳过验收');
    const f = await keywordFixture(t, ['matched', 'matched'], { withoutScore });
    const directory = join(f.home, 'portable', 'bin-harvest'); mkdirSync(directory, { recursive: true });
    const files = deviceBundle(directory);
    assert.ok(files.includes('keyword-workflow.js'), '部署未携带整批入口');
    assert.ok(files.includes('keyword-workflow-activity.js'), '部署未携带活动 wrapper');
    assert.ok(files.includes('checks/social-keyword-leadgen.yaml'), '部署未携带原探针 SSOT');
    assert.equal(existsSync(join(directory, '../../scripts/product-map/wf-plan.mjs')), false);
    assert.equal(existsSync(join(directory, 'node_modules')), false);
    const contract = join(directory, 'plans/keyword_workflow.contract.json');
    if (withoutScore) writeFileSync(contract, JSON.stringify(compile(f.bindingsPath)));
    delete f.input.execution.gateway; // 模型/飞书与 SQL 仅访问该测试的显式运输 fixture。
    const output = await cli(join(directory, 'keyword-workflow.js'), [
      '--runtime', runtime, '--contract', contract, '--receipt', f.receiptPath,
    ], { cwd: directory, env: f.env, input: f.input });
    assert.equal(output.signal, null, output.stderr);
    const receipt = JSON.parse(output.stdout);
    assert.equal(output.code, 0, JSON.stringify(receipt));
    assert.equal(receipt.status, 'completed');
    assert.deepEqual(JSON.parse(readFileSync(f.receiptPath, 'utf8')), receipt);
    assert.equal(f.pool.size, 2);
    assert.equal(f.leads.size, withoutScore ? 0 : 2);
    assert.equal(f.modelCalls.length, withoutScore ? 0 : 2);
    assert.equal(receipt.activities.some(row => row.key === 'scoring'), !withoutScore);
    assert.deepEqual(receipt.activities.slice(-2).map(row => row.key), ['delivery', 'cleanup']);
    assert.equal(f.read('phone-state.json').owner, null);
    assert.equal(f.errors.length, 0);
  });
}
