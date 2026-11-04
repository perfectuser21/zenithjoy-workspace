import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { parse } from 'yaml';

const workflows = [
  ['ci-l1-process.yml', 'l1-passed'],
  ['ci-smoke-glob-runner.yml', 'gate'],
];
const root = fileURLToPath(new URL('../../../../', import.meta.url));

function workflow(file) {
  return parse(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'));
}
function applies(condition, event) {
  if (!condition) return true;
  const rendered = condition.replace(/\$\{\{|\}\}/g, '')
    .replaceAll('always()', 'true').replaceAll('github.event_name', JSON.stringify(event));
  return Function(`return (${rendered})`)();
}
function gateRun(file, gateId, job, result, event = 'pull_request') {
  const gate = workflow(file).jobs[gateId];
  const script = gate.steps.filter(step => step.run && applies(step.if, event)).map(step => step.run).join('\n')
    .replace(/\$\{\{\s*needs\.([\w-]+)\.result\s*\}\}/g,
      (_, dependency) => gate.needs.includes(dependency) ? (dependency === job ? result : 'success') : '');
  return spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: event },
  });
}

for (const [file, gateId] of workflows) {
  test(`${file}: required check is requested for merge groups`, () => {
    const w = workflow(file);
    assert.deepEqual(w.on.merge_group?.types, ['checks_requested']);
    assert.ok(w.on.pull_request);
    assert.ok(w.on.push);
  });
  test(`${file}: always gate runs for both PR and merge-group events`, () => {
    const condition = workflow(file).jobs[gateId].if;
    assert.match(condition, /always\(\)/);
    for (const event of ['pull_request', 'merge_group']) {
      assert.equal(applies(condition, event), true, event);
    }
  });
  test(`${file}: complete successful dependencies can pass`, () => {
    const result = gateRun(file, gateId);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
  test(`${file}: merge group without equivalent metadata proof is explicitly rejected even if code checks succeeded`, () => {
    const result = gateRun(file, gateId, undefined, undefined, 'merge_group');
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /merge.?queue|merge_group/i);
  });
  test(`${file}: skipped PR-only jobs cannot become merge-group success`, () => {
    const dependent = workflow(file).jobs[gateId].needs.find(id => workflow(file).jobs[id].if?.includes('pull_request'));
    assert.ok(dependent, 'fixture must represent a real PR-only dependency');
    const result = gateRun(file, gateId, dependent, 'skipped', 'merge_group');
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
  });
  for (const dependency of workflow(file).jobs[gateId].needs) {
    for (const status of ['failure', 'cancelled', 'skipped', '']) {
      test(`${file}: ${dependency} ${status || 'missing'} cannot pass its always gate`, () => {
        const result = gateRun(file, gateId, dependency, status);
        assert.notEqual(result.status, 0, result.stdout + result.stderr);
      });
    }
  }
}
