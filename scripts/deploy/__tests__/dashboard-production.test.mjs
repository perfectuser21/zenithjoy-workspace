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
  assert.equal(w.jobs.admission.uses, './.github/workflows/dashboard-release-verification.yml');
  assert.equal(w.jobs.admission.with.sha, '${{ inputs.sha }}');
  assert.equal(w.on.workflow_dispatch.inputs.acceptance_run_key, undefined);
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

test('protected Dashboard verification and trusted compatibility check precede production package', () => {
  const verify = workflow('dashboard-release-verification');
  assert.deepEqual(Object.keys(verify.on), ['workflow_dispatch', 'workflow_call']);
  const job = verify.jobs.verification;
  assert.match(job.if, /github.repository == 'perfectuser21\/zenithjoy-workspace'.*github.ref == 'refs\/heads\/main'/);
  assert.equal(job.environment, 'zenithjoy-staging-acceptance');
  const step = job.steps.find(step => step.name === 'Verify real Dashboard business in Hong Kong staging');
  assert.ok(step);
  assert.match(step.run, /dashboard-business-smoke\.mjs/);
  assert.equal(step['continue-on-error'], undefined);
  for (const target of ['DASHBOARD', 'API']) {
    const key = target.toLowerCase();
    assert.equal(step.env[`EXPECTED_${target}_SHA`], '${{ steps.stage.outputs.' + key + '_sha }}');
    assert.equal(step.env[`${target}_STAGING_RUN_ID`], '${{ steps.stage.outputs.' + key + '_run_id }}');
    assert.equal(step.env[`${target}_STAGING_RUN_ATTEMPT`], '${{ steps.stage.outputs.' + key + '_run_attempt }}');
  }
  assert.match(job.steps.find(s => s.name?.startsWith('Confirm the deployment')).run, /cmp .*before\.json.*after\.json/);
  const artifact = job.steps.find(s => s.uses === 'actions/upload-artifact@v4');
  assert.match(artifact.with.name, /github\.run_id.*github\.run_attempt/);
  assert.equal(artifact.with['if-no-files-found'], 'error');

  const build = workflow('zenithjoy-dashboard-production').jobs.build;
  const preflight = build.steps.findIndex(s => s.run?.includes('dashboard-api-compat.mjs'));
  assert.ok(preflight > 0);
  assert.equal(build.steps[0].with?.ref, undefined);
  assert.match(build.steps[preflight].run, /git fetch --no-tags --depth=1 origin/);
  assert.equal(workflow('zenithjoy-dashboard-production').jobs.admission.secrets, undefined);
  assert.equal(build.steps[preflight].env.CANDIDATE_SHA, '${{ needs.admission.outputs.sha }}');
  assert.equal(build.steps[preflight + 1].with.ref, '${{ needs.admission.outputs.sha }}');
});
