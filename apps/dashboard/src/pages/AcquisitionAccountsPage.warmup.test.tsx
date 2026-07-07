import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { WarmupLivenessPanel } from './AcquisitionAccountsPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockFetch(body: unknown) {
  return vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response),
  ) as unknown as typeof fetch;
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

    await waitFor(() => expect(screen.getByText('大湖成长')).toBeTruthy());
    // 粉丝数展示
    expect(screen.getByText(/1196/)).toBeTruthy();
    // 掉线号 data-alive=false
    const offlineRow = screen.getByText('秦军').closest('[data-alive]');
    expect(offlineRow?.getAttribute('data-alive')).toBe('false');
    // 在线号 data-alive=true
    const aliveRow = screen.getByText('大湖成长').closest('[data-alive]');
    expect(aliveRow?.getAttribute('data-alive')).toBe('true');
  });

  it('无验活记录时不渲染面板（返回 null）', async () => {
    global.fetch = mockFetch({ success: true, data: { liveness: [] } });
    const { container } = render(<WarmupLivenessPanel agentId="a1" hostname="honor-100" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.querySelector('[data-alive]')).toBeNull();
  });
});
