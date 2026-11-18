import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REPO } from './acceptance-record.mjs';
import { validateStagingRun, verifyStaging } from './staging-evidence.mjs';

const workflow = '.github/workflows/video-tools-live-acceptance.yml';
const jobsApi = path => JSON.parse(execFileSync('gh', ['api', path], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}));
function need(ok, message) { if (!ok) throw new Error(message); }

export function verifyVideoToolsAcceptance({sha, stagingRunId, acceptanceRunId, api = jobsApi}) {
  need(/^[a-f0-9]{40}$/.test(sha) && /^[1-9]\d{0,17}$/.test(stagingRunId) &&
    /^[1-9]\d{0,17}$/.test(acceptanceRunId), '视频画布验收必须指定固定候选和 GitHub 运行编号');
  const runs = `repos/${REPO}/actions/runs`;
  const stage = api(`${runs}/${stagingRunId}`);
  validateStagingRun(stage, {sha, workflow:'deploy-staging-hk.yml'});
  const run = api(`${runs}/${acceptanceRunId}`);
  need(String(run?.id) === acceptanceRunId && run.repository?.full_name === REPO &&
    run.head_sha === sha && run.head_branch === 'main' && run.path === workflow &&
    run.event === 'workflow_dispatch' && run.status === 'completed' && run.conclusion === 'success',
  '视频画布验收来源或候选版本不符');
  need(String(stage.id) === stagingRunId && Date.parse(stage.updated_at) <= Date.parse(run.run_started_at),
    '视频画布实传验收必须晚于该候选最近一次预发部署');
  const {jobs} = api(`${runs}/${acceptanceRunId}/jobs`);
  const acceptance = jobs?.filter(job => job.name === 'Live video tools acceptance');
  need(acceptance?.length === 1 && acceptance[0].conclusion === 'success' &&
    ['Verify live private canvas upload', 'Store live upload evidence'].every(name =>
      acceptance[0].steps?.some(step => step.name === name && step.conclusion === 'success')),
  '视频画布实传步骤缺失或未通过');
  return {sha, staging_run_id: stage.id, run_id: run.id};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [sha, acceptanceRunId] = process.argv.slice(2);
    const [stage] = verifyStaging({sha, targets:'api'});
    console.log(JSON.stringify(verifyVideoToolsAcceptance({sha, stagingRunId:String(stage.run_id), acceptanceRunId})));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
