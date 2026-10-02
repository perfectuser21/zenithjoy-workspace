import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import YAML from 'yaml';

const path = new URL('../../../.github/workflows/implementation-impact.yml', import.meta.url);
const fixedRevision = '8e014b50bb5a586a1697eb699a1d97a1ea408e91';
function workflow() {
  assert.ok(existsSync(path), '必须存在真实跨仓 implementation-impact caller');
  return YAML.parse(readFileSync(path, 'utf8'));
}
test('implementation-impact 以固定提交调用受信工具，两个仓库身份不混淆', () => {
  const job = workflow().jobs.impact;
  assert.equal(job.uses, `perfectuser21/cecelia/.github/workflows/implementation-impact.yml@${fixedRevision}`);
  assert.equal(job.with.tooling_revision, fixedRevision);
  assert.equal(job.with.source_repo, 'perfectuser21/zenithjoy-workspace');
  assert.equal(job.with.scope, 'zenithjoy');
  assert.deepEqual(Object.keys(job.with).sort(), ['source_repo', 'scope', 'base_revision', 'head_revision', 'mode', 'tooling_revision'].sort());
});
test('PR 使用真实 base/head 而非合并伪提交，main 与手动运行输入明确', () => {
  const config = workflow(), job = config.jobs.impact;
  assert.deepEqual(config.on.pull_request.branches, ['main']);
  assert.deepEqual(config.on.push.branches, ['main']);
  assert.equal(config.on.workflow_dispatch.inputs.base_revision.required, true);
  assert.equal(config.on.workflow_dispatch.inputs.base_revision.type, 'string');
  assert.equal(job.with.base_revision, '${{ github.event.pull_request.base.sha || inputs.base_revision || github.event.before }}');
  assert.equal(job.with.head_revision, '${{ github.event.pull_request.head.sha || github.sha }}');
  assert.equal(job.with.mode, "${{ github.event_name == 'pull_request' && 'pr' || 'main' }}");
  assert.equal(config.on.pull_request_target, undefined);
});
test('只传约定三项 secrets，artifact 来源校验所需工作流路径和读权限保持稳定', () => {
  const config = workflow(), job = config.jobs.impact;
  assert.deepEqual(config.permissions, { contents: 'read', actions: 'read' });
  assert.deepEqual(job.secrets, {
    TS_AUTHKEY: '${{ secrets.TS_AUTHKEY }}',
    CECELIA_INTERNAL_TOKEN: '${{ secrets.CECELIA_INTERNAL_TOKEN }}',
    BRAIN_DEPLOY_URL: '${{ secrets.BRAIN_DEPLOY_URL }}',
  });
  assert.equal(path.pathname.endsWith('/.github/workflows/implementation-impact.yml'), true);
  assert.equal(config.concurrency, undefined, '并发组仅由受信callee控制，防止嵌套调用自行取消');
});
test('caller协议检查永久在CI执行，不因触发路径或continue-on-error变绿', () => {
  const config = workflow(), job = config.jobs['caller-contract'];
  assert.ok(job.steps.some(step => step.run === 'node --test scripts/ci/__tests__/implementation-impact-workflow.test.mjs'));
  assert.equal(config.jobs.impact.needs, 'caller-contract');
  assert.equal(config.jobs.impact['continue-on-error'], undefined);
  assert.equal(config.on.pull_request.paths, undefined);
  assert.equal(config.on.push.paths, undefined);
});
