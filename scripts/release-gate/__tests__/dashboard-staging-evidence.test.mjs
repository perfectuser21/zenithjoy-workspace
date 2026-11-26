import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardStagingEvidence } from '../dashboard-staging-evidence.mjs';

const dashboardSha = 'a'.repeat(40);
const apiSha = 'b'.repeat(40);
const repo = 'perfectuser21/zenithjoy-workspace';

function fixture({ frontend = dashboardSha, backend = apiSha, apiAttempt = 3, conclusion = 'success' } = {}) {
  return {
    sha: dashboardSha,
    fetchImpl: async url => new Response(JSON.stringify({ sha: url.endsWith('/api/version') ? backend : frontend })),
    api(path) {
      if (path.includes('/compare/')) return { status: 'ahead' };
      const dashboard = path.includes('/deploy-dashboard-staging.yml/');
      const workflow = dashboard ? 'deploy-dashboard-staging.yml' : 'deploy-staging-hk.yml';
      const sha = dashboard ? dashboardSha : apiSha;
      assert.match(path, new RegExp(`head_sha=${sha}`));
      return {
        workflow_runs: [{
          repository: { full_name: repo }, event: 'push', head_branch: 'main', head_sha: sha,
          path: `.github/workflows/${workflow}`, status: 'completed',
          conclusion: dashboard ? 'success' : conclusion,
          id: dashboard ? 100 : 200, run_attempt: dashboard ? 1 : apiAttempt,
        }],
      };
    },
  };
}

test('binds the candidate and the live companion API to their successful deployment attempts', async () => {
  assert.deepEqual(await dashboardStagingEvidence(fixture()), {
    dashboard: { target:'dashboard', sha:dashboardSha, run_id:100, run_attempt:1 },
    api: { target:'api', sha:apiSha, run_id:200, run_attempt:3 },
  });
});

test('rejects a stale candidate, an invalid API version and missing deployment attempts', async () => {
  await assert.rejects(dashboardStagingEvidence(fixture({ frontend: apiSha })), /expected/);
  await assert.rejects(dashboardStagingEvidence(fixture({ backend: 'unknown' })), /full SHA/);
  await assert.rejects(dashboardStagingEvidence(fixture({ apiAttempt: null })), /missing an exact attempt/);
  await assert.rejects(dashboardStagingEvidence(fixture({ conclusion: 'failure' })), /未通过/);
});
