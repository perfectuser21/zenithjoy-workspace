import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

const root = new URL('../../../', import.meta.url);
const readWorkflow = name => JSON.parse(execFileSync('python3', ['-c', String.raw`
import json, sys, yaml
with open(sys.argv[1]) as source:
    # PyYAML recognizes the YAML 1.1 word "on" as a boolean.
    data = yaml.safe_load(source)
data['on'] = data.pop(True)
print(json.dumps(data))
`, new URL(`.github/workflows/${name}.yml`, root).pathname], { encoding: 'utf8' }));

test('Hangzhou candidate checks exact staging bytes, run and attempt', () => {
  execFileSync('python3', [new URL('scripts/deploy/__tests__/hz-api-candidate.test.py', root).pathname]);
});

test('only a trusted manual main run may activate the admitted Hangzhou API artifact', () => {
  const workflow = readWorkflow('hangzhou-api-release');
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.concurrency, undefined);
  const { request, admission, execute } = workflow.jobs;
  assert.deepEqual(execute.concurrency, {group:'zenithjoy-hangzhou-production-api','cancel-in-progress':false});
  assert.match(request.steps[0].run, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(request.steps[0].run, /ROLLBACK/);
  assert.equal(admission.uses, './.github/workflows/hz-api-release-verification.yml');
  assert.deepEqual(admission.with, {sha: '${{ inputs.sha }}'});
  assert.equal(workflow.on.workflow_dispatch.inputs.acceptance_run_key, undefined);
  assert.match(execute.if, /inputs.action == 'promote' && needs.admission.result == 'success' && needs.business-review.result == 'success'/);
  assert.match(execute.if, /needs.admission.result == 'skipped' && needs.business-review.result == 'skipped'/);
  const review = workflow.jobs['business-review'];
  assert.equal(review.environment, 'hangzhou-api-business-review');
  assert.equal(review.concurrency, undefined);
  assert.match(review.steps.at(-1).run, /hz-api-business-review\.mjs/);
  assert.equal(review.steps.at(-1).env.STAGED_ATTEMPT, '${{ needs.admission.outputs.api_run_attempt }}');
  const download = execute.steps.find(step => step.uses?.startsWith('actions/download-artifact@'));
  assert.match(download.with.name, /api_run_id.*api_run_attempt/);
  assert.match(download.with['run-id'], /needs.admission.outputs.api_run_id/);
});

test('HK staging publishes a run-attempt artifact after existing acceptance steps', () => {
  const jobs = Object.values(readWorkflow('deploy-staging-hk').jobs);
  const steps = jobs.find(job => job.steps.some(step => step.id === 'hangzhou_upload')).steps;
  const publish = steps.findIndex(step => step.id === 'hangzhou_upload');
  const payment = steps.findIndex(step => step.id === 'payment');
  assert.ok(payment >= 0 && publish > payment);
  assert.match(steps[publish].with.name, /run_id.*run_attempt/);
  assert.equal(steps[publish]['continue-on-error'], true);
  assert.equal(steps.find(step => step.id === 'hangzhou_bundle')['continue-on-error'], true);
});

test('API verifier shares the staging fixture lock and exposes only verified artifact coordinates', () => {
  const verifier = readWorkflow('hz-api-release-verification');
  assert.deepEqual(Object.keys(verifier.on), ['workflow_dispatch', 'workflow_call']);
  const job = verifier.jobs.verification;
  assert.match(job.if, /github.repository == 'perfectuser21\/zenithjoy-workspace'.*github.ref == 'refs\/heads\/main'/);
  assert.equal(job.environment, 'zenithjoy-staging-acceptance');
  assert.deepEqual(job.concurrency, readWorkflow('dashboard-release-verification').jobs.verification.concurrency);
  assert.deepEqual(Object.keys(verifier.on.workflow_call.outputs), ['sha','api_run_id','api_run_attempt']);
  assert.match(job.steps.find(s => s.id === 'stage').run, /hz-api-staging-evidence\.mjs/);
  const verify = job.steps.find(s => s.run?.includes('hz-api-business-smoke.mjs'));
  assert.equal(verify.env.EXPECTED_API_SHA, '${{ steps.stage.outputs.sha }}');
  assert.equal(verify.env.API_STAGING_RUN_ID, '${{ steps.stage.outputs.api_run_id }}');
  assert.equal(verify.env.API_STAGING_RUN_ATTEMPT, '${{ steps.stage.outputs.api_run_attempt }}');
  assert.equal(verify['continue-on-error'], undefined);
  assert.match(job.steps.find(s => s.name?.startsWith('Confirm the staging')).run, /cmp .*before\.json.*after\.json/);
  assert.equal(job.steps.find(s => s.uses === 'actions/upload-artifact@v4').with['if-no-files-found'], 'error');
});

test('production forwards only the two credential names from the protected staging environment', () => {
  const caller = readWorkflow('hangzhou-api-release').jobs.admission;
  const verifier = readWorkflow('hz-api-release-verification');
  assert.deepEqual(Object.keys(caller.secrets ?? {}).sort(), ['STAGING_ACCEPTANCE_EMAIL', 'STAGING_ACCEPTANCE_PASSWORD']);
  assert.deepEqual(Object.keys(verifier.on.workflow_call.secrets ?? {}).sort(), Object.keys(caller.secrets).sort());
  const job = verifier.jobs.verification;
  assert.equal(job.environment, 'zenithjoy-staging-acceptance');
  const probe = job.steps.find(step => step.env?.STAGING_ACCEPTANCE_PASSWORD);
  for (const name of Object.keys(caller.secrets)) {
    const expression = '${{ secrets.' + name + ' }}';
    assert.equal(caller.secrets[name], expression);
    assert.equal(probe.env[name], expression);
    assert.equal(verifier.on.workflow_call.secrets[name].required, true);
  }
});
