import { describe, it, expect } from 'vitest';

const ZJ_API = process.env.ZJ_API_URL ?? 'http://localhost:5200';

async function post(path: string, body: unknown) {
  const r = await fetch(`${ZJ_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

async function get(path: string) {
  const r = await fetch(`${ZJ_API}${path}`);
  return { status: r.status, body: await r.json() };
}

describe('WS2 — operator-sessions API [BEHAVIOR]', () => {
  it('POST trigger-bind 返回 202 + {ok,platform,taskId}，keys 完全等于 ["ok","platform","taskId"]', async () => {
    const { status, body } = await post('/api/operator/sessions/trigger-bind', { platform: 'douyin' });
    expect(status).toBe(202);
    expect(body.ok).toBe(true);
    expect(typeof body.taskId).toBe('string');
    expect(body.platform).toBe('douyin');
    expect(Object.keys(body).sort()).toEqual(['ok', 'platform', 'taskId']);
  });

  it('trigger-bind 禁用字段不在 response（id/task/jobId/requestId）', async () => {
    const { body } = await post('/api/operator/sessions/trigger-bind', { platform: 'kuaishou' });
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('task');
    expect(body).not.toHaveProperty('jobId');
    expect(body).not.toHaveProperty('requestId');
  });

  it('trigger-bind 非法 platform 返 400 + error（禁用 message/msg）', async () => {
    const { status, body } = await post('/api/operator/sessions/trigger-bind', { platform: 'invalid_xyz' });
    expect(status).toBe(400);
    expect(typeof body.error).toBe('string');
    expect(body).not.toHaveProperty('message');
    expect(body).not.toHaveProperty('msg');
    expect(body).not.toHaveProperty('reason');
  });

  it('GET /api/operator/sessions 返回 8 条，每项 keys 完全等于期望集合', async () => {
    const { status, body } = await get('/api/operator/sessions');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(8);
    const expectedKeys = ['lastCheckedAt', 'lastValidAt', 'platform', 'secretName', 'status'];
    expect(Object.keys(body[0]).sort()).toEqual(expectedKeys);
  });

  it('GET sessions status 仅含 active/expired/missing（禁用 ok/healthy/valid）', async () => {
    const { body } = await get('/api/operator/sessions');
    const forbidden = ['ok', 'healthy', 'valid', 'inactive', 'error'];
    body.forEach((item: { status: string }) => {
      expect(forbidden).not.toContain(item.status);
      expect(['active', 'expired', 'missing']).toContain(item.status);
    });
  });

  it('GET sessions secretName 以 _COOKIES 结尾（禁用 _MAIN）', async () => {
    const { body } = await get('/api/operator/sessions');
    body.forEach((item: { secretName: string }) => {
      expect(item.secretName).toMatch(/_COOKIES$/);
      expect(item.secretName).not.toMatch(/_MAIN/);
      expect(item.secretName).not.toMatch(/_SESSION/);
      expect(item.secretName).not.toMatch(/_TOKEN/);
    });
  });

  it('POST /api/operator/sessions/status 返回 {ok,updated}，keys 完全等于 ["ok","updated"]', async () => {
    const { status, body } = await post('/api/operator/sessions/status', {
      updates: [{ platform: 'douyin', status: 'active', checkedAt: '2026-05-27T10:00:00Z' }],
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.updated).toBe('number');
    expect(Object.keys(body).sort()).toEqual(['ok', 'updated']);
  });
});
