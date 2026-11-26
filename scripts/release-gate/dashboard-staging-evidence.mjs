import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { verifyStaging } from './staging-evidence.mjs';

const origin = 'https://staging-autopilot.zenjoymedia.media';
const shaPattern = /^[a-f0-9]{40}$/;

async function readVersion(path, fetchImpl) {
  const response = await fetchImpl(origin + path, {
    redirect: 'error',
    cache: 'no-store',
    headers: { 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Hong Kong staging ${path} returned HTTP ${response.status}`);
  const { sha } = await response.json();
  if (!shaPattern.test(sha ?? '')) throw new Error(`Hong Kong staging ${path} did not return a full SHA`);
  return sha;
}

export async function dashboardStagingEvidence({ sha, fetchImpl = fetch, api }) {
  if (!shaPattern.test(sha ?? '')) throw new Error('Dashboard verification requires a full candidate SHA');
  const [frontend, backend] = await Promise.all([
    readVersion('/release-sha.json', fetchImpl),
    readVersion('/api/version', fetchImpl),
  ]);
  if (frontend !== sha) throw new Error(`Hong Kong staging Dashboard is ${frontend}, expected ${sha}`);
  const [dashboard] = verifyStaging({ sha, targets: 'dashboard', api });
  const [backendRun] = verifyStaging({ sha: backend, targets: 'api', api });
  for (const run of [dashboard, backendRun]) {
    if (![run.run_id, run.run_attempt].every(value => Number.isSafeInteger(value) && value > 0)) {
      throw new Error(`Hong Kong staging ${run.target} run is missing an exact attempt`);
    }
  }
  return { dashboard, api: backendRun };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { dashboard, api } = await dashboardStagingEvidence({ sha: process.argv[2] });
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, [
      `dashboard_sha=${dashboard.sha}`,
      `dashboard_run_id=${dashboard.run_id}`,
      `dashboard_run_attempt=${dashboard.run_attempt}`,
      `api_sha=${api.sha}`,
      `api_run_id=${api.run_id}`,
      `api_run_attempt=${api.run_attempt}`,
      '',
    ].join('\n'));
    console.log(JSON.stringify({ dashboard, api }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
