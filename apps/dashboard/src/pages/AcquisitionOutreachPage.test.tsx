import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import AcquisitionOutreachPage from './AcquisitionOutreachPage';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('历史触达记录', () => {
  it('renders actual historical records from the authenticated history API', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: {
      total: 1, items: [{ id: 'history-1', lead_nickname: '历史客户', account_label: '旧账号', status: 'sent', scheduled_for: null, sent_at: null }],
    } }) });
    vi.stubGlobal('fetch', fetcher);
    render(<AcquisitionOutreachPage />);
    expect(await screen.findByText('历史客户')).toBeTruthy();
    expect(screen.getByText('旧账号')).toBeTruthy();
    expect(screen.getByText('已发送')).toBeTruthy();
    expect(String(fetcher.mock.calls[0][0])).toContain('/api/acquisition/outreach-history');
    expect(fetcher.mock.calls[0][1].credentials).toBe('include');
  });

  it('shows a retrieval failure rather than pretending that history is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<AcquisitionOutreachPage />);
    expect(await screen.findByText('加载触达记录失败，请稍后重试')).toBeTruthy();
    expect(screen.queryByText(/暂无触达记录/)).toBeNull();
  });
});
