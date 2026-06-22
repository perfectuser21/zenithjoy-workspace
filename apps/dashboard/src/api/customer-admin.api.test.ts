import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  updateCompanyName,
  listAccounts,
  createAccount,
  bindDevice,
  type AccountsResponse,
} from './customer-admin.api';

const TID = 'tenant-1';

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('updateCompanyName', () => {
  it('PUT /api/tenant/:id 并返回 data.name', async () => {
    const fn = mockFetchOnce({ success: true, data: { tenant_id: TID, name: '晨悦传媒' } });
    const out = await updateCompanyName(TID, '晨悦传媒', 'admin@zj.test');
    expect(out.name).toBe('晨悦传媒');
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe(`/api/tenant/${TID}`);
    expect((init as RequestInit).method).toBe('PUT');
  });
});

describe('listAccounts', () => {
  it('GET /accounts 解析 data + quota', async () => {
    const body: AccountsResponse = {
      success: true,
      data: [
        { account_id: 'a1', email: 'x@t.test', display_name: 'x', role: 'operator', created_at: '2026-06-22' },
      ],
      total: 1,
      quota: { used: 1, limit: 5 },
    };
    const fn = mockFetchOnce(body);
    const out = await listAccounts(TID, 'admin@zj.test');
    expect(out.data).toHaveLength(1);
    expect(out.data[0].account_id).toBe('a1');
    expect(out.quota.limit).toBe(5);
    expect(fn.mock.calls[0][0]).toBe(`/api/tenant/${TID}/accounts`);
  });
});

describe('createAccount', () => {
  it('POST /accounts，配额满抛错（message 取自 error.message）', async () => {
    mockFetchOnce(
      { success: false, data: null, error: { code: 'SUBACCOUNT_QUOTA_EXCEEDED', message: '配额已满，当前 3/3' } },
      false,
      409
    );
    await expect(
      createAccount(TID, { email: 'o@t.test', display_name: 'o', role: 'operator' }, 'admin@zj.test')
    ).rejects.toThrow(/配额/);
  });

  it('POST /accounts 成功回显 role', async () => {
    const fn = mockFetchOnce({
      success: true,
      data: { account_id: 'a2', email: 's@t.test', display_name: '客服', role: 'service_agent' },
    });
    const out = await createAccount(TID, { email: 's@t.test', display_name: '客服', role: 'service_agent' });
    expect(out.role).toBe('service_agent');
    expect((fn.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });
});

describe('bindDevice', () => {
  it('POST /service-agents/:aid/bind-device 命中 1:1 绑定路由', async () => {
    const fn = mockFetchOnce({ success: true, data: { binding_id: 'b1', account_id: 'a2', machine_id: 'pc-1' } });
    const out = await bindDevice(TID, 'a2', 'pc-1', 'admin@zj.test');
    expect(out.binding_id).toBe('b1');
    expect(fn.mock.calls[0][0]).toBe(`/api/tenant/${TID}/service-agents/a2/bind-device`);
  });
});
