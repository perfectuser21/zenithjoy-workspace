import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
const fixture = vi.hoisted(() => ({ auth: { user: null as null | { email: string }, authLoading: true }, navigate: vi.fn() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => fixture.auth }));
vi.mock('react-router-dom', () => ({ useNavigate: () => fixture.navigate }));
import OperatorPage from '../OperatorPage';

beforeEach(() => {
  fixture.auth = { user: null, authLoading: true };
  fixture.navigate.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () =>
    url.startsWith('http://127.0.0.1:') ? { agent_id: 'aaaaaaaa-1111-2222-3333-444444444444' } : [] })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('operator page actual auth readiness and platform actions', () => {
  it('waits for auth before redirect or session fetch, then admits the operator', async () => {
    const view = render(<OperatorPage />);
    expect(screen.getByText('加载中…')).toBeInTheDocument();
    expect(fixture.navigate).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/operator/'))).toBe(false);
    fixture.auth = { user: { email: 'xuxiao21xx@icloud.com' }, authLoading: false };
    view.rerender(<OperatorPage />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/operator/sessions'));
    expect(fixture.navigate).not.toHaveBeenCalled();
    for (const label of ['抖音', '快手', '小红书', '视频号', '头条', '微博', '知乎', '公众号']) {
      expect(screen.getByRole('cell', { name: label })).toBeInTheDocument();
    }
  });
  it('redirects a resolved non-operator without fetching protected sessions', () => {
    fixture.auth = { user: { email: 'customer@example.test' }, authLoading: false };
    render(<OperatorPage />);
    expect(fixture.navigate).toHaveBeenCalledWith('/', { replace: true });
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/operator/'))).toBe(false);
  });
  it('binding includes selected platform, real discovered agent id and operator identity', async () => {
    fixture.auth = { user: { email: 'xuxiao21xx@icloud.com' }, authLoading: false };
    render(<OperatorPage />);
    await screen.findByText('🟢 本机 Agent 已就绪');
    const row = screen.getByRole('cell', { name: '快手' }).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: '登录' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/operator/sessions/trigger-bind', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Email': 'xuxiao21xx@icloud.com' },
      body: JSON.stringify({ platform: 'kuaishou', agent_id: 'aaaaaaaa-1111-2222-3333-444444444444' }),
    }));
  });
});
