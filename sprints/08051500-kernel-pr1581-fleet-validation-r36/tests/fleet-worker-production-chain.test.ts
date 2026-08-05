import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';

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
    const evidence = JSON.stringify(task.result ?? task.metadata ?? {});
    for (const value of ['perfectuser21/zenithjoy-workspace', 'c305f6217da65bb69413c39e621b7e797e0fb189', 'line02/keyword_acquisition#step7', process.env.HARNESS_ATTEMPT_ID, process.env.CAPABILITY_SNAPSHOT_ID]) expect(evidence).toContain(value);
  }, timeout);

  it('错误仓库 fail-closed', async () => {
    await expectFailed(payload({ base_repo: 'wrong/repo' }), 'base_repo');
  }, timeout);

  it('缺失 target_head_sha fail-closed', async () => {
    const body = payload(); delete body.payload.target_head_sha;
    await expectFailed(body, 'target_head_sha');
  }, timeout);

  it('畸形或不一致 SHA fail-closed', async () => {
    for (const head of ['HEAD', '0000000000000000000000000000000000000000']) await expectFailed(payload({ target_head_sha: head }), 'target_head_sha');
  }, timeout);

  it('缺失或不可解析锚点 fail-closed', async () => {
    const missing = payload(); delete missing.payload.gp_anchor;
    await expectFailed(missing, 'gp_anchor');
    await expectFailed(payload({ gp_anchor: 'line02/keyword_acquisition#step999' }), 'gp_anchor');
  }, timeout);

  it('GitHub 与 Postgres 依赖预检', async () => {
    const gh = spawnSync('gh', ['api', 'repos/perfectuser21/zenithjoy-workspace/pulls/1581'], { encoding: 'utf8' });
    expect(gh.status, `ENVIRONMENT_FAILURE:github ${gh.stderr}`).toBe(0);
    const dbUrl = process.env.DB_URL;
    expect(dbUrl, 'ENVIRONMENT_FAILURE:postgres DB_URL missing').toBeTruthy();
    const pg = spawnSync('psql', [dbUrl!, '-v', 'ON_ERROR_STOP=1', '-tAc', 'SELECT 1'], { encoding: 'utf8' });
    expect(pg.status, `ENVIRONMENT_FAILURE:postgres ${pg.stderr}`).toBe(0);
    expect(pg.stdout.trim()).toBe('1');
  }, 30_000);
});
