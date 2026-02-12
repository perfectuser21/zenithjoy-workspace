import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorksListPage from '../WorksListPage';
import * as worksApi from '../../api/works.api';

// Mock the API
vi.mock('../../api/works.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/works.api')>();
  return {
    ...actual,
    getWorks: vi.fn(),
    createWork: vi.fn(),
    deleteWork: vi.fn(),
  };
});

// Helper function to render with QueryClient
function renderWithQueryClient(component: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {component}
    </QueryClientProvider>
  );
}

describe('WorksListPage', () => {
  beforeEach(() => {
    // Mock API to return empty data
    vi.mocked(worksApi.getWorks).mockResolvedValue({
      data: [],
      total: 0,
    });
  });

  it('应该展示页面标题', () => {
    renderWithQueryClient(<WorksListPage />);

    expect(screen.getByText('作品管理')).toBeInTheDocument();
  });

  it('应该有搜索框', () => {
    renderWithQueryClient(<WorksListPage />);

    // 搜索框应该存在
    const searchInput = screen.getByPlaceholderText(/搜索/);
    expect(searchInput).toBeInTheDocument();
  });

  it('应该有筛选下拉框', () => {
    renderWithQueryClient(<WorksListPage />);

    // 应该有三个筛选下拉框：类型、状态、账号
    // 通过检查 option 文本来验证
    expect(screen.getByText('全部类型')).toBeInTheDocument();
    expect(screen.getByText('全部状态')).toBeInTheDocument();
    expect(screen.getByText('全部账号')).toBeInTheDocument();
  });

  it('应该有创建按钮', () => {
    renderWithQueryClient(<WorksListPage />);

    // 创建按钮应该存在（"新建作品"）
    const createButton = screen.getByRole('button', { name: /新建作品/ });
    expect(createButton).toBeInTheDocument();
  });
});
