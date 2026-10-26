/**
 * CustomerProfilePage 回归测试（2026-06-27）。
 *
 * BUG 复现：路由定义参数名是 `:contactKey`（navigation.config.ts），
 * 但组件 useParams 读的是 `contact` → 永远 undefined →
 * loadProfile 里 `if (!contact) return` 提前返回、不清 loading →
 * 页面永远卡「加载中…」，profile 数据虽 200 也不渲染。
 *
 * 本测试用真实路由参数名 `{ contactKey }` mock useParams，断言客户画像真渲染出来。
 * 修复前：读不到 contactKey → 卡加载 → 找不到客户名 → FAIL。
 * 修复后：正确读 contactKey → 加载 profile → 渲染客户名 → PASS。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CustomerProfilePage from '../CustomerProfilePage';

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).ResizeObserver = class {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
  };
});

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

// 关键：路由定义的参数名是 contactKey（不是 contact）。用真实参数名 mock。
const route = vi.hoisted(() => ({ contactKey: '崔华', query: '' }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ contactKey: route.contactKey }),
  useSearchParams: () => [new URLSearchParams(route.query), vi.fn()],
}));

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const PROFILE = {
  name: '崔华',
  contact: '崔华',
  wechat_id: 'cuihua_wx',
  status: 'A1',
  managed: true,
  last_contact_at: null,
  portrait: { need: '想做抖音获客', budget: '5000', concern: '怕封号' },
  timeline: [],
  dailies: [],
  messages: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  route.contactKey = '崔华'; route.query = '';
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes('/profile')) return Promise.resolve(jsonRes({ profile: PROFILE }));
    return Promise.resolve(jsonRes({}));
  }) as unknown as typeof fetch;
});

describe('CustomerProfilePage [回归：路由参数 contactKey]', () => {
  it('用真实路由参数名 contactKey → 加载并渲染客户画像（不卡在「加载中」）', async () => {
    render(<CustomerProfilePage />);
    // 修复前 contactKey 读不到 → 卡「加载中…」→ 客户名永不出现 → 此处超时失败
    await waitFor(() => {
      expect(screen.getByTestId('crm-profile-name')).toHaveTextContent('崔华');
    });
    // 确认不再停留在加载态
    expect(screen.queryByText('加载中…')).toBeNull();
  });

  it('profile 接口被请求的 URL 含 contactKey 段（证明读到了路由参数）', async () => {
    render(<CustomerProfilePage />);
    await waitFor(() => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      const called = fetchMock.mock.calls.some(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('/profile'),
      );
      expect(called).toBe(true);
    });
  });

  it.each(['success', 'unauthorized', 'failure'])('切换客户后丢弃旧资料请求的%s响应，不将A客户身份带入B补录', async outcome => {
    let resolveA!: (v: Response) => void;
    let rejectA!: (e: Error) => void;
    route.contactKey = '客户A'; route.query = 'cs=cs-a';
    const fetchMock = vi.fn((url: string) => {
      if (url.includes(encodeURIComponent('客户A') + '/profile')) return new Promise<Response>((resolve, reject) => { resolveA = resolve; rejectA = reject; });
      if (url.includes('/profile')) return Promise.resolve(jsonRes({ profile: { ...PROFILE, customer_id: '22', name: '客户B', contact: '客户B' } }));
      if (url.endsWith('/preview')) return Promise.resolve(jsonRes({ error: { message: '只验证目标' } }, 503));
      return Promise.resolve(jsonRes({ records: [] }));
    });
    global.fetch = fetchMock as typeof fetch;
    const { rerender } = render(<CustomerProfilePage />);
    route.contactKey = '客户B'; route.query = 'cs=cs-b';
    rerender(<CustomerProfilePage />);
    await waitFor(() => expect(screen.getByTestId('crm-profile-name')).toHaveTextContent('客户B'));
    await act(async () => {
      if (outcome === 'failure') rejectA(new Error('旧A失败'));
      else resolveA(outcome === 'unauthorized' ? jsonRes({}, 401) : jsonRes({ profile: { ...PROFILE, customer_id: '11', name: '客户A' } }));
    });
    expect(screen.getByTestId('crm-profile-name')).toHaveTextContent('客户B');
    expect(screen.queryByTestId('crm-profile-auth-expired')).not.toBeInTheDocument();
    expect(screen.queryByText('错误：旧A失败')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '补录聊天记录' }));
    fireEvent.change(screen.getByLabelText('聊天记录'), { target: { value: '需要样品' } });
    fireEvent.click(screen.getByRole('button', { name: '整理并预览' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[0].endsWith('/preview'))).toBe(true));
    const call = fetchMock.mock.calls.find(c => c[0].endsWith('/preview')) as unknown as [string, RequestInit];
    expect(JSON.parse(call[1].body as string)).toMatchObject({ customer_id: '22', cs_wechat_id: 'cs-b' });
  });
});
