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
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  const { request, admission, execute } = workflow.jobs;
  assert.match(request.steps[0].run, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(request.steps[0].run, /ROLLBACK/);
  assert.equal(admission.uses, './.github/workflows/release-admission.yml');
  assert.equal(admission.with.targets, 'api');
  assert.equal(admission.with.bind_api_artifact, true);
  assert.match(execute.if, /inputs.action == 'promote' && needs.admission.result == 'success'/);
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
