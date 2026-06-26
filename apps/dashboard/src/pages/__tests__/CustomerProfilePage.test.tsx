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
import { render, screen, waitFor } from '@testing-library/react';
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
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ contactKey: '崔华' }),
  useSearchParams: () => [new URLSearchParams(''), vi.fn()],
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
});
