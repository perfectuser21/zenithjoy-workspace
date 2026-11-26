import assert from 'node:assert/strict';
import test from 'node:test';
import { hzApiStagingEvidence } from '../hz-api-staging-evidence.mjs';

const sha = 'a'.repeat(40);
const repository = 'perfectuser21/zenithjoy-workspace';
function fixture({ version = sha, artifacts, runAttempt = 2, conclusion = 'success' } = {}) {
  const exact = {
    id: 77,
    name: 'hk-api-candidate-500-2',
    expired: false,
    workflow_run: { id: 500, head_sha: sha },
  };
  return {
    sha,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://staging-autopilot.zenjoymedia.media/api/version');
      assert.equal(options.redirect, 'error');
      return Response.json({ sha: version });
    },
    api(path) {
      if (path.includes('/compare/')) return { status: 'ahead' };
      if (path.includes('/artifacts')) {
        assert.equal(path, `repos/${repository}/actions/runs/500/artifacts?name=hk-api-candidate-500-${runAttempt}&per_page=100`);
        return { artifacts: artifacts?.(exact) ?? [exact] };
      }
      return { workflow_runs: [{
        id: 500, run_attempt: runAttempt, head_sha: sha, head_branch: 'main', event: 'push',
        path: '.github/workflows/deploy-staging-hk.yml', status: 'completed', conclusion,
        repository: { full_name: repository },
      }] };
    },
  };
}

test('admits only the artifact published for the running API by its exact staging attempt', async () => {
  assert.deepEqual(await hzApiStagingEvidence(fixture()), {
    sha, run_id:500, run_attempt:2, artifact_id:77,
  });
});

test('rejects a mismatched live version, missing attempt, or unsuccessful staging run', async () => {
  await assert.rejects(hzApiStagingEvidence(fixture({version: 'b'.repeat(40)})), /expected/);
  await assert.rejects(hzApiStagingEvidence(fixture({runAttempt: null})), /exact GitHub run and attempt/);
  await assert.rejects(hzApiStagingEvidence(fixture({conclusion:'failure'})), /未通过/);
});

test('rejects missing, expired, duplicate, stale-attempt and different-source artifacts', async () => {
  for (const artifacts of [
    () => [],
    x => [{ ...x, expired: true }],
    x => [x, x],
    x => [{ ...x, name: 'hk-api-candidate-500-1' }],
    x => [{ ...x, workflow_run: { ...x.workflow_run, id: 501 } }],
    x => [{ ...x, workflow_run: { ...x.workflow_run, head_sha: 'b'.repeat(40) } }],
  ]) await assert.rejects(hzApiStagingEvidence(fixture({artifacts})), /artifact/);
});
