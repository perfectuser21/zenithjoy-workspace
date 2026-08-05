import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

const brain = process.env.BRAIN ?? 'http://127.0.0.1:5221';
const timeout = 7_200_000;

function curlJson(args: string[]) {
  return JSON.parse(execFileSync('curl', ['-sfS', ...args], { encoding: 'utf8' }));
}

function payload(overrides: Record<string, unknown> = {}) {
  return { task_type: 'harness_initiative', title: 'Fleet payload validation', payload: { base_repo: 'perfectuser21/zenithjoy-workspace', base_sha: '676fed7de12023d355deac7849af8a525ae53f8d', target_head_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189', gp_anchor: 'line02/keyword_acquisition#step7', target_environment: 'local_api', ...overrides } };
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

async function expectFailed(body: object) {
  const task = await terminal(submit(body));
  expect(task.status).not.toBe('completed');
  expect(JSON.stringify(task.error_message ?? task.failure_class ?? task.metadata ?? {})).not.toBe('{}');
}

describe('Fleet Worker production chain [BEHAVIOR]', () => {
  it('正确 payload 经真实 Fleet Worker 绑定目标', async () => {
    const task = await terminal(submit(payload()));
    expect(task.status).toBe('completed');
    expect(String(task.execution_surface ?? task.executor ?? '').toLowerCase()).toContain('fleet');
    expect(task.payload).toMatchObject(payload().payload);
    const evidence = JSON.stringify(task.result ?? task.metadata ?? {});
    for (const value of ['perfectuser21/zenithjoy-workspace', 'c305f6217da65bb69413c39e621b7e797e0fb189', 'line02/keyword_acquisition#step7', process.env.HARNESS_ATTEMPT_ID, process.env.CAPABILITY_SNAPSHOT_ID]) expect(evidence).toContain(value);
  }, timeout);

  it('错误仓库 fail-closed', async () => {
    await expectFailed(payload({ base_repo: 'wrong/repo' }));
  }, timeout);

  it('畸形或不一致 SHA fail-closed', async () => {
    for (const head of [undefined, 'HEAD', '0000000000000000000000000000000000000000']) {
      const body = payload({ target_head_sha: head });
      if (head === undefined) delete body.payload.target_head_sha;
      await expectFailed(body);
    }
  }, timeout);

  it('不可解析锚点 fail-closed', async () => {
    const missing = payload(); delete missing.payload.gp_anchor;
    await expectFailed(missing);
    await expectFailed(payload({ gp_anchor: 'line02/keyword_acquisition#step999' }));
  }, timeout);
});
