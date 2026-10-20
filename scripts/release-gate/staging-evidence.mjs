import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { REPO, parseTargets } from './acceptance-record.mjs';
const workflows = {api:'deploy-staging-hk.yml',dashboard:'deploy-dashboard-staging.yml','staff-hub':'deploy-staff-hub-staging.yml'};
function need(ok, message) { if (!ok) throw new Error(message); }
export function validateStagingRun(run, {sha, workflow}) {
  need(/^[a-f0-9]{40}$/.test(sha), '必须指定完整候选SHA');
  need(run?.repository?.full_name === REPO && run.head_sha === sha && run.head_branch === 'main', 'staging来源/版本不符');
  need(['push','workflow_dispatch'].includes(run.event) && run.path === `.github/workflows/${workflow}`, 'staging不是批准的部署入口');
  need(run.status === 'completed' && run.conclusion === 'success', 'staging部署未通过');
  return run.id;
}
export function verifyStaging({sha, targets, api = path => JSON.parse(execFileSync('gh',['api',path],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))}) {
  need(/^[a-f0-9]{40}$/.test(sha), '必须指定完整候选SHA');
  targets = parseTargets(targets);
  const comparison = api(`repos/${REPO}/compare/${sha}...main`);
  need(['ahead','identical'].includes(comparison.status), '候选不是main已合并版本');
  return targets.map(target => {
    const workflow = workflows[target];
    const page = api(`repos/${REPO}/actions/workflows/${workflow}/runs?head_sha=${sha}&branch=main&per_page=100`);
    // 最近同SHA的运行必须通过；旧绿不能掩盖其后的失败/进行中运行。
    const run = [...(page.workflow_runs || [])].sort((a,b) => b.id-a.id)[0];
    validateStagingRun(run,{sha,workflow});
    return {target,run_id:run.id,sha};
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const sha = process.argv[2], evidence = verifyStaging({sha,targets:process.argv[3]});
    console.log(JSON.stringify({sha,staging:evidence}));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,`sha=${sha}\n`);
  } catch(error) { console.error(error.message); process.exitCode=1; }
}
