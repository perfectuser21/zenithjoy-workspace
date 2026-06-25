/**
 * CustomerListPage（per-operator 重做；2026-06-25 契约）BEHAVIOR 覆盖：
 *  - 普通运营登录即看自己客户：CRM 请求走普通 session fetch（credentials:'include'），
 *    **不带 X-User-Email 超管头**、**不带 ?cs_wechat_id**（后端按 req.tenantId 自动 scope）。
 *  - **没有「选客服机」下拉**：单微信直接显示；写接口用后端回的 cs_wechat_id 作目标。
 *  - 「立即扫好友」按钮显眼，POST /api/crm/friend-scan/trigger 用后端回的 cs_wechat_id，回显提示。
 *  - 客户列表只有客户行（姓名/状态/最后联系/接管），**不含人设名「小苏」那类客服机信息**。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CustomerListPage from '../CustomerListPage';

const mockAuth = vi.hoisted(() => ({
  isSuperAdmin: false,
  user: { id: 'ou_op', name: '于姐', email: 'yujie@zenjoymedia.media' },
  token: 'tok',
  isAuthenticated: true,
  authLoading: false,
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

const CS_WID = 'cs-yujie';

// 记录每次 fetch 调用（url + init），供断言「无超管头/无 cs_wechat_id」
type FetchCall = { url: string; init?: RequestInit };
let fetchCalls: FetchCall[] = [];

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

// per-operator：所有 CRM 请求走普通 fetch（带 credentials:'include'，无 X-User-Email）。
// GET /customers 不带 cs_wechat_id；后端按租户 scope，回 cs_wechat_id 供写接口作目标 key。
function mockFetchRouting() {
  global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init });
    if (url.startsWith('/api/crm/customers')) {
      return Promise.resolve(
        jsonRes({
          customers: [
            { name: '客户甲', contact: '客户甲', wechat_id: null, status: 'A1', last_contact_at: null, managed: true },
          ],
          total: 1,
          cs_wechat_id: CS_WID,
        }),
      );
    }
    if (url.startsWith('/api/crm/onboarding/')) {
      return Promise.resolve(
        jsonRes({
          step_o1_online: 'ok',
          step_o2_scanned: 'ok',
          scanned_count: 1,
          step_o3_roster: 'ok',
          blacklist_count: 0,
          step_o4_realpublish: 'pending',
          step_o5_replied: 'pending',
        }),
      );
    }
    if (url.startsWith('/api/crm/friend-scan/trigger')) {
      return Promise.resolve(jsonRes({ ok: true, requested_at: '2026-06-25T00:00:00Z' }));
    }
    return Promise.resolve(jsonRes({}));
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchCalls = [];
  mockFetchRouting();
});

describe('CustomerListPage [per-operator BEHAVIOR]', () => {
  it('运营登录即看自己客户：GET /customers 走普通 session fetch，无超管头、无 cs_wechat_id', async () => {
    render(<CustomerListPage />);
    await screen.findByText('客户甲');

    const call = fetchCalls.find((c) => c.url.startsWith('/api/crm/customers'));
    expect(call).toBeDefined();
    // 不带 ?cs_wechat_id（后端按 req.tenantId 自动 scope）
    expect(call!.url).not.toContain('cs_wechat_id');
    // 带 credentials:'include' 让 better-auth session cookie 随行
    expect(call!.init?.credentials).toBe('include');
    // 绝不注入 X-User-Email 超管头
    const headers = (call!.init?.headers ?? {}) as Record<string, string>;
    expect(headers['X-User-Email']).toBeUndefined();
  });

  it('没有「选客服机」下拉——单微信直接显示客户', async () => {
    render(<CustomerListPage />);
    await screen.findByText('客户甲');
    expect(screen.queryByTestId('crm-cs-machine-select')).toBeNull();
  });

  it('客户列表只含客户行，不含人设名「小苏」那类客服机信息', async () => {
    render(<CustomerListPage />);
    await screen.findByText('客户甲');
    // 列表内不出现客服机人设名（小苏小助手等），那块挪到「我的客服机」卡
    expect(screen.queryByText(/小苏/)).toBeNull();
    // 也没有「选客服机」下拉（人设名在线状态曾随下拉显示）
    expect(screen.queryByTestId('crm-cs-machine-select')).toBeNull();
  });

  it('「立即扫好友」按钮显眼且文案直白', async () => {
    render(<CustomerListPage />);
    const btn = await screen.findByTestId('crm-force-scan-btn');
    expect(btn).toBeVisible();
    // 文案对运营直白：提示这是「扫微信好友导入客户」的主动作
    expect(btn.textContent).toMatch(/扫.*好友/);
  });

  it('点「立即扫好友」→ POST /friend-scan/trigger 用后端回的 cs_wechat_id，回显提示', async () => {
    render(<CustomerListPage />);
    // 等列表加载完，拿到后端回的 cs_wechat_id
    await screen.findByText('客户甲');
    const btn = await screen.findByTestId('crm-force-scan-btn');
    fireEvent.click(btn);
    await waitFor(() => {
      const call = fetchCalls.find((c) => c.url.startsWith('/api/crm/friend-scan/trigger'));
      expect(call).toBeDefined();
      expect(call!.init?.method).toBe('POST');
      expect(call!.init?.credentials).toBe('include');
      expect(JSON.parse(call!.init?.body as string)).toEqual({ cs_wechat_id: CS_WID });
    });
    await screen.findByText(/已通知客服机/);
  });
});
