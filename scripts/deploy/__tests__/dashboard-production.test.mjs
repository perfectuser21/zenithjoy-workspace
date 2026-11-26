import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = new URL('../../../', import.meta.url);
function workflow(name) {
  const program = 'import json, sys, yaml; d=yaml.safe_load(open(sys.argv[1])); d["on"]=d.pop(True,d.get("on")); print(json.dumps(d))';
  return JSON.parse(execFileSync('python3', ['-c', program, fileURLToPath(new URL(`.github/workflows/${name}.yml`, root))]));
}

test('Dashboard production coordinator and host regression', () => {
  for (const file of ['dashboard-production.test.py', 'dashboard-production-host.test.py']) {
    execFileSync('python3', [fileURLToPath(new URL(file, import.meta.url))], {stdio:'pipe'});
  }
});

test('manual main Dashboard promotion requires staging admission and one production bundle', () => {
  const w = workflow('zenithjoy-dashboard-production');
  assert.deepEqual(Object.keys(w.on), ['workflow_dispatch']);
  assert.equal(w.concurrency['cancel-in-progress'], false);
  assert.equal(w.concurrency.group, workflow('hangzhou-api-release').concurrency.group);
  assert.match(w.jobs.request.steps[0].run, /GITHUB_REF.*refs\/heads\/main/);
  assert.equal(w.jobs.admission.uses, './.github/workflows/release-admission.yml');
  assert.equal(w.jobs.admission.with.targets, 'dashboard');
  assert.equal(w.jobs.build.needs, 'admission');
  const opts = w.jobs.build.steps.find(step => step.name?.startsWith('Build the admitted')).env;
  assert.equal(opts.VITE_DEPLOY_ENV, 'production');
  assert.equal(opts.VITE_SKIP_AUTH, 'false');
  assert.ok(opts.VITE_FEISHU_APP_ID && opts.VITE_SUPER_ADMIN_EMAILS);
  assert.ok(opts.VITE_STAFF_EMAILS);
  assert.doesNotMatch(opts.VITE_STAFF_EMAILS, /@zenithjoy\.test/);
  assert.equal(w.jobs.build.steps.filter(step => step.uses?.startsWith('actions/upload-artifact@')).length, 1);
  const download = w.jobs.release.steps.find(step => step.uses?.startsWith('actions/download-artifact@'));
  assert.match(download.with.name, /needs.build.outputs.artifact/);
  assert.match(w.jobs.release.if, /needs.admission.result == 'success'.*needs.build.result == 'success'/s);
  assert.match(w.jobs.release.if, /needs.admission.result == 'skipped'.*needs.build.result == 'skipped'/s);
  assert.equal(w.jobs.release.environment, 'zenithjoy-dashboard-production');
});
