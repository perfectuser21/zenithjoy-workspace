import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AcceptanceHistoryPage from './AcceptanceHistoryPage';

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: 'staff@test.com' } }) }));

describe('AcceptanceHistoryPage', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => vi.unstubAllGlobals());

  it('输入 GP id 查询后展示历史 run 列表，可展开看判定项', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true, availability: 'ready',
        runs: [{ run_key: 'r1', title: '被动接待 v1.21', version: '1.21', created_at: '2026-07-10', checks: [{ check_key: 'r1:001', name: 'x', result: '通过', note: 'ok' }] }],
      }),
    });
    render(<MemoryRouter><AcceptanceHistoryPage /></MemoryRouter>);
    fireEvent.change(screen.getByTestId('acceptance-history-gpid-input'), { target: { value: 'gp1' } });
    fireEvent.click(screen.getByTestId('acceptance-history-search'));
    await waitFor(() => expect(screen.getByTestId('acceptance-history-run-r1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('acceptance-history-run-r1'));
    expect(screen.getByText('ok')).toBeInTheDocument();
  });
});
