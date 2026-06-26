/**
 * machines.api.ts 单元测试 — mock global fetch，验证 URL / 方法 / body / 信封解析 / 错误抛出。
 * 配对 lint-test-pairing：apps/dashboard/src/api/machines.api.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchMachines,
  fetchMachineDetail,
  updateMachine,
  dispatchQrBind,
} from './machines.api';

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = init;
  return vi.fn().mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  } as unknown as Response);
}

describe('machines.api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchMachines 调 GET /api/agent/machines 并返回 data 数组', async () => {
    const machines = [
      { id: 'm1', agent_id: 'a1', hostname: 'H', nickname: '主力机', machine_role: 'main', status: 'online', version: '1.0.70', last_seen: 'x', session_count: 2 },
    ];
    const f = mockFetchOnce({ success: true, data: machines });
    vi.stubGlobal('fetch', f);

    const out = await fetchMachines();
    expect(out).toEqual(machines);
    const url = f.mock.calls[0][0] as string;
    expect(url).toContain('/api/agent/machines');
  });

  it('fetchMachineDetail 调 GET /api/agent/machines/:id 返回 {machine, sessions}', async () => {
    const detail = { machine: { id: 'm1' }, sessions: [{ account_label: 'perfect-01', role: 'main', status: 'active', platform: 'douyin' }] };
    const f = mockFetchOnce({ success: true, data: detail });
    vi.stubGlobal('fetch', f);

    const out = await fetchMachineDetail('m1');
    expect(out).toEqual(detail);
    expect(f.mock.calls[0][0]).toContain('/api/agent/machines/m1');
  });

  it('updateMachine 用 PUT + JSON body 调 /api/agent/machines/:id', async () => {
    const updated = { id: 'm1', nickname: '新名', machine_role: 'sub' };
    const f = mockFetchOnce({ success: true, data: updated });
    vi.stubGlobal('fetch', f);

    const out = await updateMachine('m1', { nickname: '新名', machine_role: 'sub' });
    expect(out).toEqual(updated);
    const [, opts] = f.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body as string)).toEqual({ nickname: '新名', machine_role: 'sub' });
  });

  it('dispatchQrBind 用 POST 调 /api/agent/burner/qr-bind 带 agent_id', async () => {
    const f = mockFetchOnce({ success: true, data: { task_id: 't1' } });
    vi.stubGlobal('fetch', f);

    const out = await dispatchQrBind({ account_label: 'perfect-09', agent_id: 'a1' });
    expect(out).toEqual({ task_id: 't1' });
    const [url, opts] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/agent/burner/qr-bind');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toMatchObject({ agent_id: 'a1' });
  });

  it('success:false 时抛出 error.message', async () => {
    const f = mockFetchOnce({ success: false, error: { code: 'MACHINE_NOT_FOUND', message: '机器不存在' } }, { ok: false, status: 404 });
    vi.stubGlobal('fetch', f);

    await expect(fetchMachineDetail('nope')).rejects.toThrow('机器不存在');
  });

  it('响应非 JSON 时抛出带状态码的错误', async () => {
    const f = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json'); },
    } as unknown as Response);
    vi.stubGlobal('fetch', f);

    await expect(fetchMachines()).rejects.toThrow('500');
  });
});
