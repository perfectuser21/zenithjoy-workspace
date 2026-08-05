import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

const brain = process.env.BRAIN ?? 'http://127.0.0.1:5221';
const timeout = Number(process.env.FLEET_TERMINAL_TIMEOUT_MS ?? 90_000);

function curlJson(args: string[]) {
  return JSON.parse(execFileSync('curl', ['-sfS', ...args], { encoding: 'utf8' }));
}

function payload(overrides: Record<string, unknown> = {}) {
  return { task_type: 'harness_initiative', title: 'Fleet payload validation', payload: { base_repo: 'perfectuser21/zenithjoy-workspace', base_sha: '676fed7de12023d355deac7849af8a525ae53f8d', target_head_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189', gp_anchor: 'line02/keyword_acquisition#step7', target_environment: 'local_api', ...overrides } };
}

function expectFleetEvidence(task: Record<string, any>) {
  const result = task.result ?? task.metadata ?? {};
  const evidence = JSON.stringify(result);
  for (const value of ['perfectuser21/zenithjoy-workspace', '676fed7de12023d355deac7849af8a525ae53f8d', 'c305f6217da65bb69413c39e621b7e797e0fb189', 'line02/keyword_acquisition#step7']) expect(evidence).toContain(value);
  const identity = result.validation_identity ?? result.provenance;
  expect(identity).toEqual(expect.objectContaining({ attempt_id: expect.any(String), capability_snapshot_id: expect.any(String) }));
  expect(identity.attempt_id.length).toBeGreaterThan(0);
  expect(identity.capability_snapshot_id.length).toBeGreaterThan(0);
}

function submit(body: object) {
  return curlJson(['-X', 'POST', `${brain}/api/brain/tasks`, '-H', 'content-type: application/json', '-d', JSON.stringify(body)]).id as string;
}

async function terminal(id: string) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const task = curlJson([`${brain}/api/brain/tasks/${id}`]);
    if (['completed', 'failed', 'cancelled'].includes(task.status)) return task;
    await new Promise(resolve => setTimeout(resolve, 10_000));
  }
  throw new Error(`task ${id} 未在 7200s 内终态`);
}

async function expectFailed(body: object, field: string) {
  const task = await terminal(submit(body));
  expect(task.status).toBe('failed');
  expect(task.failure_class).toBe('validation_input_invalid');
  expect(String(task.error_message ?? '').toLowerCase()).toContain(field);
}

describe('Fleet Worker production chain [BEHAVIOR]', () => {
  it('正确 payload 经真实 Fleet Worker 绑定目标', async () => {
    const task = await terminal(submit(payload()));
    expect(task.status).toBe('completed');
    expect(String(task.execution_surface ?? task.executor ?? '').toLowerCase()).toContain('fleet');
    expect(task.payload).toMatchObject(payload().payload);
    expectFleetEvidence(task);
  }, timeout);

  it('错误仓库 fail-closed', async () => {
    await expectFailed(payload({ base_repo: 'wrong/repo' }), 'base_repo');
  }, timeout);

  it('缺失 target_head_sha fail-closed', async () => {
    const body = payload(); delete body.payload.target_head_sha;
    await expectFailed(body, 'target_head_sha');
  }, timeout);

  it('缺失 base_repo fail-closed', async () => {
    const body = payload(); delete body.payload.base_repo;
    await expectFailed(body, 'base_repo');
  }, timeout);

  it('错误冻结 base_sha fail-closed', async () => {
    await expectFailed(payload({ base_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189' }), 'base_sha');
  }, timeout);

  it('畸形 SHA fail-closed', async () => {
    await expectFailed(payload({ target_head_sha: 'HEAD' }), 'target_head_sha');
  }, timeout);

  it('可解析但非 PR head SHA fail-closed', async () => {
    expect(execFileSync('git', ['rev-parse', '--verify', '676fed7de12023d355deac7849af8a525ae53f8d^{commit}'], { encoding: 'utf8' }).trim()).toBe('676fed7de12023d355deac7849af8a525ae53f8d');
    await expectFailed(payload({ target_head_sha: '676fed7de12023d355deac7849af8a525ae53f8d' }), 'target_head_sha');
  }, timeout);

  it('缺失或不可解析锚点 fail-closed', async () => {
    const missing = payload(); delete missing.payload.gp_anchor;
    await expectFailed(missing, 'gp_anchor');
    await expectFailed(payload({ gp_anchor: 'line02/keyword_acquisition#step999' }), 'gp_anchor');
  }, timeout);

  it('正确 payload 的依赖终态不误报业务成功', async () => {
    const task = await terminal(submit(payload()));
    if (task.status === 'completed') {
      expectFleetEvidence(task);
      return;
    }
    expect(task.status).toBe('failed');
    expect(task.failure_class).toBe('environment_failure');
    expect(String(task.error_message ?? '').toLowerCase()).toMatch(/github|postgres/);
  }, timeout);
});
