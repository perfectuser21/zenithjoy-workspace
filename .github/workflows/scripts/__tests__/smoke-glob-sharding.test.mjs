import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

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
  if (denied) names.push('wechat-auto-launch-smoke.sh');
  for (const name of names) writeFileSync(join(dir, name), `#!/bin/bash\nprintf '%s\\n' '${name}' >> "$TRACE"\nexit ${fail && name === 'b-smoke.sh' ? 7 : 0}\n`);
  writeFileSync(join(root, '.github/workflows/scripts/smoke-baseline.txt'), names.filter(n => !n.startsWith('wechat-')).join('\n') + '\n');
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
  assert.equal(all.find(r => r[0].startsWith('wechat-'))[1], 'SKIP');
  const actual = workers.flatMap(r => readFileSync(join(r.output, 'trace'), 'utf8').trim().split('\n'));
  assert.deepEqual(actual.sort(), names.filter(n => !n.startsWith('wechat-')).sort());
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
