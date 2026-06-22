import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  updateCompanyName,
  listMembers,
  addMemberByEmail,
  removeMember,
  listServiceAgents,
  bindDevice,
  type MembersResponse,
  type ServiceAgentsResponse,
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

describe('listMembers', () => {
  it('GET /members 解析 data（成员含 email + role）', async () => {
    const body: MembersResponse = {
      success: true,
      data: [
        { user_id: 'usr-1', email: 'alice@t.test', name: 'Alice', role: 'owner', joined_at: '2026-06-22' },
      ],
      total: 1,
    };
    const fn = mockFetchOnce(body);
    const out = await listMembers(TID, 'admin@zj.test');
    expect(out.data).toHaveLength(1);
    expect(out.data[0].user_id).toBe('usr-1');
    expect(out.data[0].email).toBe('alice@t.test');
    expect(fn.mock.calls[0][0]).toBe(`/api/tenant/${TID}/members`);
  });
});

describe('addMemberByEmail', () => {
  it('POST /members 按 email 拉用户进公司', async () => {
    const fn = mockFetchOnce({ success: true, data: { user_id: 'usr-9', email: 'svc@t.test', role: 'member' } });
    const out = await addMemberByEmail(TID, 'svc@t.test', 'member', 'admin@zj.test');
    expect(out.user_id).toBe('usr-9');
    expect(fn.mock.calls[0][0]).toBe(`/api/tenant/${TID}/members`);
    expect((fn.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });

  it('用户不存在抛错（message 取自 error.message）', async () => {
    mockFetchOnce(
      { success: false, data: null, error: { code: 'USER_NOT_FOUND', message: '该邮箱未注册' } },
      false,
      404
    );
    await expect(addMemberByEmail(TID, 'ghost@t.test', 'member')).rejects.toThrow(/未注册/);
  });
});

describe('removeMember', () => {
  it('DELETE /members/:userId', async () => {
    const fn = mockFetchOnce({ success: true, data: { success: true } });
    await removeMember(TID, 'usr-9', 'admin@zj.test');
    expect(fn.mock.calls[0][0]).toBe(`/api/tenant/${TID}/members/usr-9`);
    expect((fn.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
  });
});

describe('listServiceAgents', () => {
  it('GET /service-agents 解析绑定（含 member_user_id + member_email）', async () => {
    const body: ServiceAgentsResponse = {
      success: true,
      data: [
        {
          binding_id: 'b1',
          member_user_id: 'usr-1',
          member_email: 'svc@t.test',
          machine_id: 'pc-1',
          hostname: 'PC-A',
          online: true,
          bound_at: '2026-06-22',
        },
      ],
      total: 1,
    };
    const fn = mockFetchOnce(body);
    const out = await listServiceAgents(TID, 'admin@zj.test');
    expect(out.data[0].member_user_id).toBe('usr-1');
    expect(out.data[0].member_email).toBe('svc@t.test');
    expect(fn.mock.calls[0][0]).toBe(`/api/tenant/${TID}/service-agents`);
  });
});

describe('bindDevice', () => {
  it('POST /service-agents/:userId/bind-device 绑真实成员', async () => {
    const fn = mockFetchOnce({ success: true, data: { binding_id: 'b1', member_user_id: 'usr-1', machine_id: 'pc-1' } });
    const out = await bindDevice(TID, 'usr-1', 'pc-1', 'admin@zj.test');
    expect(out.binding_id).toBe('b1');
    expect(fn.mock.calls[0][0]).toBe(`/api/tenant/${TID}/service-agents/usr-1/bind-device`);
  });
});
