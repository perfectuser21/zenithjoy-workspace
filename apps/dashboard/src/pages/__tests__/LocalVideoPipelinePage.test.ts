import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios from 'axios';
import { fetchAccountMe } from '../../api/account.api';
import LocalVideoPipelinePage from '../LocalVideoPipelinePage';
vi.mock('../../api/account.api', () => ({ fetchAccountMe: vi.fn() }));
vi.mock('axios', () => ({ default: { post: vi.fn(), isAxiosError: () => false } }));
const clients: QueryClient[] = [];
const streams: FixtureEventSource[] = [];
class FixtureEventSource {
  static CLOSED = 2;
  readyState = 1;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn(() => { this.readyState = FixtureEventSource.CLOSED; });
  constructor(readonly url: string) { streams.push(this); }
  emit(status: string, error?: string) {
    act(() => this.onmessage?.({ data: JSON.stringify({ id: 'job-123', status, progress: status === 'completed' ? 100 : 35, error }) } as MessageEvent));
  }
}
beforeEach(() => {
  vi.clearAllMocks(); streams.length = 0;
  vi.stubGlobal('EventSource', FixtureEventSource);
  vi.mocked(fetchAccountMe).mockResolvedValue({ user: { id: 'user-1', email: 'user@example.test', name: 'Test user' }, license: { license_key: 'fixture-license', tier: 'free', max_machines: 1, expires_at: '2099-01-01' } });
  vi.mocked(axios.post).mockResolvedValue({ data: { job: { id: 'job-123' } } });
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
async function submit() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(React.createElement(QueryClientProvider, { client }, React.createElement(LocalVideoPipelinePage)));
  fireEvent.change(screen.getByPlaceholderText(/my-video\.mp4/), { target: { value: 'C:\\Videos\\input.mp4' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '开始处理' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '开始处理' }));
  await waitFor(() => expect(streams).toHaveLength(1)); return streams[0];
}
describe('LocalVideoPipelinePage real job lifecycle', () => {
  it('submits the entered file and exposes both actual download links after completion', async () => {
    const stream = await submit();
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith('/api/ai-video/jobs', expect.objectContaining({ local_path: 'C:\\Videos\\input.mp4' }), { headers: { Authorization: 'Bearer fixture-license' } });
    expect(stream.url).toBe('/api/ai-video/jobs/job-123/sse');
    stream.emit('completed');
    expect(screen.getByText('处理完成')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '下载 9:16 竖屏' })).toHaveAttribute('href', '/api/ai-video/jobs/job-123/output/9_16.mp4');
    expect(screen.getByRole('link', { name: '下载 16:9 横屏' })).toHaveAttribute('href', '/api/ai-video/jobs/job-123/output/16_9.mp4');
    expect(stream.close).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '处理新视频' }));
    expect(screen.queryByRole('link', { name: /下载/ })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/my-video\.mp4/)).toHaveValue('');
  });
  it('shows a failed job and its real error without offering a download', async () => {
    const stream = await submit(); stream.emit('failed', 'Fixture encoder failed');
    expect(screen.getByText('处理失败')).toBeInTheDocument();
    expect(screen.getByText('Fixture encoder failed')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /下载/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始处理' })).toBeEnabled();
    expect(stream.close).toHaveBeenCalledTimes(1);
  });
  for (const [status, label] of [['queued', '排队中…'], ['pending', '等待 Agent 处理…'], ['processing', 'Agent 处理中 35%']]) {
    it(`keeps ${status} jobs busy and prevents a second submission`, async () => {
      const stream = await submit(); stream.emit(status);
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '处理中，请等待…' })).toBeDisabled();
      expect(screen.queryByRole('link', { name: /下载/ })).not.toBeInTheDocument();
      expect(stream.close).not.toHaveBeenCalled();
    });
  }
});
