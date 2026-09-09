/**
 * 「我的作品」页组件契约。
 *
 * 六个用例照 task-2-brief：卡片渲染+回执徽章 / 空态 / 编辑保存 / 草稿发布 /
 * failed 重发失败平台子集（关键断言，禁止整单重派）/ queued 发布按钮 disabled。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/my-contents.api', () => ({
  listMyContents: vi.fn(),
  updateMyContent: vi.fn(),
  publishMyContent: vi.fn(),
}));
import { listMyContents, updateMyContent, publishMyContent } from '../../api/my-contents.api';
import MyWorksPage from '../MyWorksPage';

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MyWorksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('MyWorksPage', () => {
  it('渲染两张卡片：一张已发含 douyin✅ 徽章、一张草稿', async () => {
    (listMyContents as any).mockResolvedValue({
      items: [
        {
          id: 'c1',
          title: '傍晚的调色盘',
          body: '文案',
          type: 'video',
          platforms: ['douyin'],
          status: 'published',
          created_at: '2026-09-09T10:00:00Z',
          materials: [{ file_name: 'a.jpg', preview_url: 'https://x/a.jpg' }],
          receipts: [{ platform: 'douyin', status: 'done' }],
        },
        {
          id: 'c2',
          title: '草稿标题',
          body: '',
          type: 'video',
          platforms: [],
          status: 'draft',
          created_at: '2026-09-09T11:00:00Z',
          materials: [],
          receipts: [],
        },
      ],
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('傍晚的调色盘')).toBeInTheDocument());
    expect(screen.getByText('草稿标题')).toBeInTheDocument();
    expect(screen.getByText('✅')).toBeInTheDocument();
  });

  it('没有作品 → 空态文案', async () => {
    (listMyContents as any).mockResolvedValue({ items: [] });

    renderPage();

    await waitFor(() => expect(screen.getByText(/还没有作品/)).toBeInTheDocument());
  });

  it('点草稿卡→编辑面板→改标题保存→updateMyContent 被调', async () => {
    (listMyContents as any).mockResolvedValue({
      items: [
        {
          id: 'c2',
          title: '草稿标题',
          body: '原文案',
          type: 'video',
          platforms: ['douyin'],
          status: 'draft',
          created_at: '2026-09-09T11:00:00Z',
          materials: [],
          receipts: [],
        },
      ],
    });
    (updateMyContent as any).mockResolvedValue(undefined);

    renderPage();

    await waitFor(() => expect(screen.getByText('草稿标题')).toBeInTheDocument());
    fireEvent.click(screen.getByText('草稿标题'));

    const titleInput = await screen.findByDisplayValue('草稿标题');
    fireEvent.change(titleInput, { target: { value: '新标题' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() =>
      expect(updateMyContent).toHaveBeenCalledWith('c2', expect.objectContaining({ title: '新标题' })),
    );
  });

  it('草稿点发布→publishMyContent(id, undefined)——整单按原平台发布', async () => {
    (listMyContents as any).mockResolvedValue({
      items: [
        {
          id: 'c2',
          title: '草稿标题',
          body: '',
          type: 'video',
          platforms: ['douyin'],
          status: 'draft',
          created_at: '2026-09-09T11:00:00Z',
          materials: [],
          receipts: [],
        },
      ],
    });
    (publishMyContent as any).mockResolvedValue({});

    renderPage();

    await waitFor(() => expect(screen.getByText('草稿标题')).toBeInTheDocument());
    fireEvent.click(screen.getByText('发布'));

    await waitFor(() => expect(publishMyContent).toHaveBeenCalledWith('c2', undefined));
  });

  it('failed 作品（douyin done + weibo failed）点「重发失败平台」→ publishMyContent(id, [失败子集])', async () => {
    (listMyContents as any).mockResolvedValue({
      items: [
        {
          id: 'c3',
          title: '失败作品',
          body: '',
          type: 'video',
          platforms: ['douyin', 'weibo'],
          status: 'failed',
          created_at: '2026-09-09T11:00:00Z',
          materials: [],
          receipts: [
            { platform: 'douyin', status: 'done' },
            { platform: 'weibo', status: 'failed' },
          ],
        },
      ],
    });
    (publishMyContent as any).mockResolvedValue({});

    renderPage();

    await waitFor(() => expect(screen.getByText('失败作品')).toBeInTheDocument());
    fireEvent.click(screen.getByText('重发失败平台'));

    // 关键断言：绝不整单重派，只传 status≠'done' 的平台子集（这里只有 weibo）。
    await waitFor(() => expect(publishMyContent).toHaveBeenCalledWith('c3', ['weibo']));
  });

  it('queued 卡片发布按钮 disabled', async () => {
    (listMyContents as any).mockResolvedValue({
      items: [
        {
          id: 'c4',
          title: '排队中作品',
          body: '',
          type: 'video',
          platforms: ['douyin'],
          status: 'queued',
          created_at: '2026-09-09T11:00:00Z',
          materials: [],
          receipts: [],
        },
      ],
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('排队中作品')).toBeInTheDocument());
    expect(screen.getByText('发布中…')).toBeDisabled();
  });
});
