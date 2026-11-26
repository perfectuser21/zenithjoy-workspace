import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { REPO } from './acceptance-record.mjs';
import { verifyStaging } from './staging-evidence.mjs';

const versionUrl = 'https://staging-autopilot.zenjoymedia.media/api/version';
const fullSha = /^[a-f0-9]{40}$/;
const github = path => JSON.parse(execFileSync('gh', ['api', path], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000,
}));

export async function hzApiStagingEvidence({ sha, fetchImpl = fetch, api = github }) {
  if (!fullSha.test(sha ?? '')) throw new Error('Hangzhou API verification requires the full candidate SHA');
  const response = await fetchImpl(versionUrl, {
    redirect: 'error', cache: 'no-store',
    headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Hong Kong API version returned HTTP ${response.status}`);
  const body = await response.json();
  if (body?.sha !== sha) {
    const observed = fullSha.test(body?.sha ?? '') ? body.sha : 'unknown';
    throw new Error(`Hong Kong staging API is ${observed}, expected ${sha}`);
  }

  const [staging] = verifyStaging({ sha, targets: 'api', api });
  const { run_id, run_attempt } = staging;
  if (![run_id, run_attempt].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('Hong Kong staging API requires an exact GitHub run and attempt');
  }
  const name = `hk-api-candidate-${run_id}-${run_attempt}`;
  const result = api(`repos/${REPO}/actions/runs/${run_id}/artifacts?name=${name}&per_page=100`);
  const artifacts = result.artifacts?.filter(item => item.name === name);
  const artifact = artifacts?.[0];
  if (artifacts?.length !== 1 || artifact.expired !== false || !Number.isSafeInteger(artifact.id)
      || artifact.id <= 0 || artifact.workflow_run?.id !== run_id || artifact.workflow_run?.head_sha !== sha) {
    throw new Error(`No single live GitHub artifact for staging attempt ${name}`);
  }
  return { sha, run_id, run_attempt, artifact_id: artifact.id };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const evidence = await hzApiStagingEvidence({ sha: process.argv[2] });
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, [
      `sha=${evidence.sha}`,
      `api_run_id=${evidence.run_id}`,
      `api_run_attempt=${evidence.run_attempt}`,
      '',
    ].join('\n'));
    console.log(JSON.stringify(evidence));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
