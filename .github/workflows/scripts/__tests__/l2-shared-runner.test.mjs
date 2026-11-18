import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';

const workflow = YAML.parse(readFileSync(new URL('../../ci-l2-consistency.yml', import.meta.url), 'utf8'));
const names = ['Check tsconfig.base.json exists', 'Check apps inherit from base', 'Check Node.js version consistency', 'Check for sensitive files'];
const job = () => workflow.jobs['tsconfig-inheritance'];
const actual = name => job().steps.find(step => step.name === name);
const run = (shell, cwd) => spawnSync('bash', ['-eo', 'pipefail', '-c', shell], { cwd, encoding: 'utf8' });

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'l2-shared-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const app of ['api', 'dashboard']) {
    mkdirSync(join(root, 'apps', app), { recursive: true });
    writeFileSync(join(root, 'apps', app, 'tsconfig.json'), '{"extends":"../../tsconfig.base.json"}');
  }
  writeFileSync(join(root, 'tsconfig.base.json'), '{}');
  writeFileSync(join(root, 'package.json'), '{"engines":{"node":">=20"}}');
  writeFileSync(join(root, 'Dockerfile'), 'FROM node:20\n');
  return root;
}

function gate(result) {
  const script = workflow.jobs['l2-passed'].steps[0].run.replace(/\$\{\{\s*needs\.([\w-]+)\.result\s*\}\}/g,
    (_, key) => key === 'tsconfig-inheritance' ? result : 'success');
  assert.doesNotMatch(script, /\$\{\{/);
  return run(script);
}

test('the real required L2 gate shares setup, retains events and blocks skipped or cancelled worker', () => {
  assert.equal(workflow.on.pull_request.branches.includes('main'), true);
  assert.equal(workflow.on.push.branches.includes('main'), true);
  assert.ok(Object.hasOwn(workflow.on, 'merge_group'));
  assert.equal(workflow.jobs['engines-consistency'], undefined);
  assert.equal(workflow.jobs['sensitive-files'], undefined);
  assert.equal(job().if, undefined);
  assert.equal(job()['continue-on-error'], undefined);
  assert.equal(job().steps.filter(s => s.uses === 'actions/checkout@v4').length, 1);
  const restore = job().steps.filter(s => s.uses === './.github/actions/skills-source');
  assert.equal(restore.length, 1);
  assert.equal(restore[0].if, "hashFiles('.skills-source.json') != ''");
  assert.equal(restore[0].with['ssh-key'], '${{ secrets.SKILLS_SOURCE_SSH_KEY }}');
  for (const name of names) {
    const step = actual(name);
    assert.ok(step?.run, name);
    assert.equal(step.if, name === 'Check Node.js version consistency' || name === 'Check for sensitive files' ? '${{ !cancelled() }}' : undefined, name);
    if (step.if) assert.equal(step['timeout-minutes'], 5, name);
    assert.equal(step['continue-on-error'], undefined, name);
  }
  assert.equal(workflow.jobs['l2-passed'].if, 'always()');
  assert.ok(workflow.jobs['l2-passed'].needs.includes('tsconfig-inheritance'));
  assert.equal(gate('success').status, 0);
  for (const result of ['failure', 'skipped', 'cancelled', '']) assert.notEqual(gate(result).status, 0, result);
});

for (const [name, mutate] of [
  ['Check tsconfig.base.json exists', root => unlinkSync(join(root, 'tsconfig.base.json'))],
  ['Check apps inherit from base', root => writeFileSync(join(root, 'apps/api/tsconfig.json'), '{}')],
  ['Check Node.js version consistency', root => writeFileSync(join(root, 'Dockerfile'), 'FROM node:21\n')],
  ['Check for sensitive files', root => writeFileSync(join(root, 'private.pem'), 'fixture')],
]) test(`actual ${name} rejects its own failure and the required gate rejects the failed job`, t => {
  const root = fixture(t), step = actual(name);
  assert.ok(step?.run, name);
  assert.equal(run(step.run, root).status, 0, `valid fixture: ${name}`);
  mutate(root);
  assert.notEqual(run(step.run, root).status, 0, `invalid fixture: ${name}`);
  assert.notEqual(gate('failure').status, 0);
});
