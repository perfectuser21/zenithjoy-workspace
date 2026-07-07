import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import AcquisitionAccountsPage, { WarmupLivenessPanel } from './AcquisitionAccountsPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockFetch(body: unknown) {
  return vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response),
  ) as unknown as typeof fetch;
}

function mockFetchByUrl(map: Record<string, unknown>) {
  return vi.fn((url: string) => {
    for (const [k, v] of Object.entries(map)) {
      if (url.includes(k)) return Promise.resolve({ ok: true, json: () => Promise.resolve(v) } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: {} }) } as Response);
  }) as unknown as typeof fetch;
}

describe('WarmupLivenessPanel — Line02 养号验活展示', () => {
  it('按真实昵称展示每号，掉线号标红(data-alive=false) + 粉丝展示', async () => {
    global.fetch = mockFetch({
      success: true,
      data: {
        liveness: [
          { nickname: '大湖成长', alive: true, followers: 1196, reason: 'ok', checked_at: '2026-07-07T02:00:00Z' },
          { nickname: '秦军', alive: false, followers: null, reason: 'profile_unreadable', checked_at: '2026-07-07T02:00:00Z' },
        ],
      },
    });

    render(<WarmupLivenessPanel agentId="a1" hostname="honor-100" />);

    // 昵称与 ✅/🔴 emoji 同一 span（"✅ 大湖成长"），故用 regex 子串匹配
    await waitFor(() => expect(screen.getByText(/大湖成长/)).toBeTruthy());
    // 粉丝数展示
    expect(screen.getByText(/1196/)).toBeTruthy();
    // 掉线号 data-alive=false
    const offlineRow = screen.getByText(/秦军/).closest('[data-alive]');
    expect(offlineRow?.getAttribute('data-alive')).toBe('false');
    // 在线号 data-alive=true
    const aliveRow = screen.getByText(/大湖成长/).closest('[data-alive]');
    expect(aliveRow?.getAttribute('data-alive')).toBe('true');
  });

  it('无验活记录时不渲染面板（返回 null）', async () => {
    global.fetch = mockFetch({ success: true, data: { liveness: [] } });
    const { container } = render(<WarmupLivenessPanel agentId="a1" hostname="honor-100" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.querySelector('[data-alive]')).toBeNull();
  });
});

describe('AcquisitionAccountsPage — 整页集成', () => {
  it('渲染小号表 + 该设备验活面板 + 绑定名校验', async () => {
    global.fetch = mockFetchByUrl({
      '/api/agent/burner/sessions': {
        success: true,
        data: {
          sessions: [
            {
              account_label: 'burner1', role: 'burner', status: 'active', bound_at: '2026-07-07',
              agent_id: 'a1', agent_hostname: 'honor-100', agent_status: 'online',
            },
          ],
        },
      },
      '/api/agent/burner/warmup-liveness': {
        success: true,
        data: { liveness: [{ nickname: '大湖', alive: true, followers: 1196, reason: 'ok', checked_at: '2026-07-07T00:00:00Z' }] },
      },
    });
    render(<AcquisitionAccountsPage />);
    // 小号表渲染（含 StatusBadge active）
    await waitFor(() => expect(screen.getByText('burner1')).toBeTruthy());
    expect(screen.getByText(/正常/)).toBeTruthy();
    // 该 agent 的养号验活面板（分组渲染 + 昵称）
    await waitFor(() => expect(screen.getByText(/养号验活/)).toBeTruthy());
    expect(screen.getByText(/大湖/)).toBeTruthy();
    // 绑定名校验分支：输入 default → 报错
    const input = screen.getByPlaceholderText(/account_label/);
    fireEvent.change(input, { target: { value: 'default' } });
    expect(screen.getByText(/不能用 default/)).toBeTruthy();
  });

  it('needs_rebind 小号 → 顶部登录过期告警', async () => {
    global.fetch = mockFetchByUrl({
      '/api/agent/burner/sessions': {
        success: true,
        data: { sessions: [{ account_label: 'b2', role: 'burner', status: 'needs_rebind', agent_id: null }] },
      },
    });
    render(<AcquisitionAccountsPage />);
    await waitFor(() => expect(screen.getByText(/有小号登录已过期/)).toBeTruthy());
  });
});
