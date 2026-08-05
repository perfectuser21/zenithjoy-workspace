import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

const brainUrl = required('BRAIN_URL');
const taskId = required('HARNESS_TASK_ID');
const bundleFile = required('HARNESS_TASK_BUNDLE_FILE');
const payload = JSON.parse(execFileSync('curl', ['-sf', `${brainUrl}/api/brain/tasks/${taskId}`], { encoding: 'utf8' })).payload;
const bundle = JSON.parse(readFileSync(bundleFile, 'utf8')).task_bundle;

describe('Fleet Worker 生产 receipt [BEHAVIOR]', () => {
  it('Fleet bundle 原样消费 Brain payload', async () => {
    await Promise.resolve();
    expect(bundle.inputs.execution_surface).toBe('fleet-worker');
    expect(bundle.inputs.workspace_spec.repo).toBe(payload.base_repo);
    expect(bundle.inputs.workspace_spec.base_sha).toBe(payload.base_sha);
    expect(bundle.inputs.workspace_spec.expected_head_sha).toBe(payload.target_head_sha);
    expect(bundle.inputs.gp_anchor).toBe(payload.gp_anchor);
  });

  it('实际 checkout 绑定目标 PR head', async () => {
    await Promise.resolve();
    const checkout = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { encoding: 'utf8' }).trim();
    const prHead = execFileSync('gh', ['api', 'repos/perfectuser21/zenithjoy-workspace/pulls/1581', '--jq', '.head.sha'], { encoding: 'utf8' }).trim();
    expect(checkout).toBe(payload.target_head_sha);
    expect(prHead).toBe(payload.target_head_sha);
  });

  it('GP anchor 唯一解析到 step7', async () => {
    await Promise.resolve();
    const map = JSON.parse(readFileSync('product-map/generated/product-map.json', 'utf8'));
    const matches = map.golden_paths.filter((gp: any) => gp.line_id === 'line02' && gp.id === 'keyword_acquisition' && gp.steps.some((step: any) => step.id === 'step7'));
    expect(bundle.inputs.gp_anchor).toBe('line02/keyword_acquisition#step7');
    expect(matches).toHaveLength(1);
  });

  it('成功结论 schema 精确且禁用字段缺席', async () => {
    await Promise.resolve();
    const receipt = { status: 'passed', failure_class: null, base_repo: payload.base_repo, base_sha: payload.base_sha, target_head_sha: payload.target_head_sha, gp_anchor: payload.gp_anchor, run_id: required('HARNESS_RUN_ID'), attempt_id: required('HARNESS_ATTEMPT_ID'), execution_surface: 'fleet-worker' };
    expect(Object.keys(receipt).sort()).toEqual(['attempt_id', 'base_repo', 'base_sha', 'execution_surface', 'failure_class', 'gp_anchor', 'run_id', 'status', 'target_head_sha']);
    expect(receipt).not.toHaveProperty('repo');
    expect(receipt).not.toHaveProperty('head_sha');
    expect(receipt).not.toHaveProperty('anchor');
    expect(receipt).not.toHaveProperty('ok');
  });
});
