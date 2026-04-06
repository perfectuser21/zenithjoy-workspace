import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorksGalleryPage from '../WorksGalleryPage';
import * as worksApi from '../../api/works.api';

// Mock getWorks API
vi.mock('../../api/works.api', () => ({
  getWorks: vi.fn(),
}));

const mockWorks = [
  {
    id: 'work-1',
    title: '别把存档当成学会',
    content_type: 'image' as const,
    status: 'published' as const,
    account: 'XXIP' as const,
    content_text: '你的收藏夹里躺着几十篇干货。',
    media_files: [{ url: '/img/01.png', type: 'image' as const }],
    custom_fields: { keyword: '认知' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'work-2',
    title: '礼貌的暴政',
    content_type: 'text' as const,
    status: 'published' as const,
    account: 'XXAI' as const,
    content_text: '你明明不想去那个聚局。',
    media_files: [],
    custom_fields: { keyword: '社交' },
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('WorksGalleryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('API 有数据时应该展示作品卡片', async () => {
    vi.mocked(worksApi.getWorks).mockResolvedValue({
      data: mockWorks,
      total: 2,
      limit: 100,
      offset: 0,
    });

    render(<WorksGalleryPage />, { wrapper: createWrapper() });

    // 等待数据加载
    await waitFor(() => {
      expect(screen.getByText('别把存档当成学会')).toBeInTheDocument();
    });

    expect(screen.getByText('礼貌的暴政')).toBeInTheDocument();
    expect(screen.getByText('2 件作品')).toBeInTheDocument();
  });

  it('API 返回空数据时应该显示空状态提示', async () => {
    vi.mocked(worksApi.getWorks).mockResolvedValue({
      data: [],
      total: 0,
      limit: 100,
      offset: 0,
    });

    render(<WorksGalleryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/作品库暂无内容，Cecelia 生成内容后将自动显示/)).toBeInTheDocument();
    });
  });

  it('数据加载时应该显示 spinner', () => {
    vi.mocked(worksApi.getWorks).mockReturnValue(new Promise(() => {})); // 永不 resolve

    render(<WorksGalleryPage />, { wrapper: createWrapper() });

    // 加载中显示"加载中…"文字
    expect(screen.getByText(/加载中/)).toBeInTheDocument();
  });

  it('有多种 content_type 时应该显示动态筛选按钮', async () => {
    vi.mocked(worksApi.getWorks).mockResolvedValue({
      data: mockWorks,
      total: 2,
      limit: 100,
      offset: 0,
    });

    render(<WorksGalleryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      // image → 图文，text → 文本
      expect(screen.getByRole('button', { name: '图文' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '文本' })).toBeInTheDocument();
    });
  });

  it('点击筛选按钮后应该出现"清除"按钮', async () => {
    vi.mocked(worksApi.getWorks).mockResolvedValue({
      data: mockWorks,
      total: 2,
      limit: 100,
      offset: 0,
    });

    render(<WorksGalleryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '图文' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '图文' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '清除' })).toBeInTheDocument();
    });
  });
});
