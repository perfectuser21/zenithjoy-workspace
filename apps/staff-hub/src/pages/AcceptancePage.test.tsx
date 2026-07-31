import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AcceptancePage from './AcceptancePage';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'staff@test.com' } }),
}));

describe('AcceptancePage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('渲染待验收列表', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        availability: 'ready',
        runs: [{ run_key: 'r1', title: '被动接待验收', status: 'in_review', checks: [{ result: null }, { result: '通过' }] }],
      }),
    });
    render(<MemoryRouter><AcceptancePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('acceptance-run-r1')).toBeInTheDocument());
    expect(screen.getByText('被动接待验收')).toBeInTheDocument();
  });

  it('Brain 降级时展示提示，不崩溃', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, availability: 'degraded', runs: [], message: 'Brain: timeout' }),
    });
    render(<MemoryRouter><AcceptancePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('acceptance-degraded-banner')).toBeInTheDocument());
  });
});
