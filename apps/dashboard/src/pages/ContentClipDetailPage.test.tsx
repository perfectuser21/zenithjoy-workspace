import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getClip, retryClip, type Clip } from '../api/content-clipper.api';
import ContentClipDetailPage from './ContentClipDetailPage';
vi.mock('../api/content-clipper.api', () => ({ getClip: vi.fn(), retryClip: vi.fn() }));
const clients: QueryClient[] = [];
const clip: Clip = {
  id: 'clip-1', user_id: 'user-1', url: 'https://example.test/video', platform: 'douyin', status: 'done', title: 'Fixture clip', content_type: '视频', transcript: null, ocr_text: null, images: [], author: null,
  like_count: null, cover_url: null, video_url: null, output_url: 'https://example.test/output', output_type: 'notion', output_status: 'pushed', error_msg: null, retry_count: 0, created_at: '2026-11-03T00:00:00Z', processed_at: null,
};
beforeEach(() => vi.clearAllMocks());
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });
function show(overrides: Partial<Clip> = {}) {
  vi.mocked(getClip).mockResolvedValue({ ...clip, ...overrides });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/clips/clip-1']}><Routes><Route path="/clips/:id" element={<ContentClipDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}
describe('ContentClipDetailPage real rendered data', () => {
  for (const [status, label] of [['pending', '待推送'], ['pushed', '已推送'], ['failed', '推送失败'], ['skipped', '无输出配置']]) {
    it(`renders the server output status ${status}`, async () => {
      show({ output_status: status });
      expect(await screen.findByText(`Notion · ${label}`)).toBeInTheDocument();
      expect(getClip).toHaveBeenCalledWith('clip-1');
    });
  }
  it('shows precisely 500 transcript characters and expands and collapses the actual text', async () => {
    const transcript = 'a'.repeat(500) + 'VISIBLE_ONLY_AFTER_EXPAND'; show({ transcript });
    const preview = await screen.findByText('a'.repeat(500) + '...');
    expect(preview.textContent).toBe('a'.repeat(500) + '...');
    expect(screen.queryByText(transcript)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `展开全文（${transcript.length} 字）` }));
    expect(screen.getByText(transcript)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(screen.getByText('a'.repeat(500) + '...')).toBeInTheDocument();
    expect(screen.queryByText(transcript)).not.toBeInTheDocument();
  });
  it('retries the exact failed clip and refreshes the rendered server state', async () => {
    show({ status: 'failed', error_msg: 'Fixture extraction failed' });
    expect(await screen.findByText('Fixture extraction failed')).toBeInTheDocument();
    vi.mocked(retryClip).mockResolvedValue({ ...clip, status: 'pending' });
    vi.mocked(getClip).mockResolvedValue({ ...clip, status: 'pending' });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('等待中')).toBeInTheDocument();
    expect(retryClip).toHaveBeenCalledTimes(1);
    expect(retryClip).toHaveBeenCalledWith('clip-1');
    expect(screen.queryByText('Fixture extraction failed')).not.toBeInTheDocument();
  });
});
