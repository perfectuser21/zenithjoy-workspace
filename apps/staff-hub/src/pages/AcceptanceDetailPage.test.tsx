import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AcceptanceDetailPage from './AcceptanceDetailPage';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'staff@test.com' } }),
}));

const RUN = {
  run_key: 'r1', title: '被动接待验收', status: 'in_review', pass_rate: null,
  checks: [
    { id: 'c1', check_key: 'r1:001', kind: 'FR', name: 'Step1: 用户发消息', device: '手机A', result: null, note: null, detail: { op: ['打开APP'], exp: '收到回复' } },
    { id: 'c2', check_key: 'r1:002', kind: 'Invariant', name: 'Step1: 不重复回复', device: null, result: '通过', note: 'ok', detail: null },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/acceptance/r1']}>
      <Routes><Route path="/acceptance/:runKey" element={<AcceptanceDetailPage />} /></Routes>
    </MemoryRouter>
  );
}

describe('AcceptanceDetailPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, availability: 'ready', runs: [RUN] }),
    }));
  });

  it('渲染矩阵总览 + 按 Step 分组的判定项行', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('acceptance-matrix')).toBeInTheDocument());
    expect(screen.getByTestId('acceptance-check-r1:001')).toBeInTheDocument();
    expect(screen.getByTestId('acceptance-check-r1:002')).toBeInTheDocument();
  });

  it('点击行展开工作卡', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('acceptance-check-r1:001'));
    fireEvent.click(screen.getByTestId('acceptance-expand-r1:001'));
    expect(screen.getByTestId('acceptance-workcard-r1:001')).toBeInTheDocument();
  });

  it('选择结果后提交，调用 submit 端点', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, availability: 'ready', runs: [RUN] }) });
    renderPage();
    await waitFor(() => screen.getByTestId('acceptance-check-r1:001'));
    fireEvent.change(screen.getByTestId('acceptance-result-r1:001'), { target: { value: '通过' } });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { updated: 1, runs: [{ run_key: 'r1', status: 'passed', pass_rate: 1 }] } }) });
    fireEvent.click(screen.getByTestId('acceptance-submit'));
    await waitFor(() => expect(screen.getByTestId('acceptance-submit-success')).toBeInTheDocument());
  });
});
