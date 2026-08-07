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
    { id: 'c2', check_key: 'r1:002', kind: 'Invariant', name: 'Step 1: 不重复回复', device: null, result: '通过', note: 'ok', detail: null },
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

  it('提交 body 带 run_key（Brain 侧写入必须限定单个 run 作用域，缺了直接 400）', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, availability: 'ready', runs: [RUN] }) });
    renderPage();
    await waitFor(() => screen.getByTestId('acceptance-check-r1:001'));
    fireEvent.change(screen.getByTestId('acceptance-result-r1:001'), { target: { value: '通过' } });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { updated: 1, runs: [] } }) });
    fireEvent.click(screen.getByTestId('acceptance-submit'));

    await waitFor(() => expect(screen.getByTestId('acceptance-submit-success')).toBeInTheDocument());
    const submitCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST'
    );
    expect(submitCall).toBeDefined();
    const body = JSON.parse((submitCall![1] as RequestInit).body as string);
    expect(body.run_key).toBe('r1');
    expect(body.results).toHaveLength(1);
  });

  it('不同大小写/空格写法的Step前缀会被归一化合并到同一分组', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('acceptance-matrix'));
    // 矩阵表格只应该有一行数据行（加表头共2行 tr），不应该因为"Step1"和"Step 1"写法不同产生两行
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2); // 1 表头 + 1 数据行
  });
});

describe('stepOf 归一化', () => {
  it('Step1/Step 1/step1 归一化成同一个 key', async () => {
    const { stepOf } = await import('./AcceptanceDetailPage');
    expect(stepOf('Step1: x')).toBe('Step 1');
    expect(stepOf('Step 1: x')).toBe('Step 1');
    expect(stepOf('step1: x')).toBe('Step 1');
    expect(stepOf('没有step前缀')).toBe('未分组');
  });
});
