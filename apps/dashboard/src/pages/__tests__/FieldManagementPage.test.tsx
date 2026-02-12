import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FieldManagementPage from '../FieldManagementPage';
import * as fieldsApi from '../../api/fields.api';

// Mock the API
vi.mock('../../api/fields.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/fields.api')>();
  return {
    ...actual,
    getFields: vi.fn(),
    createField: vi.fn(),
    updateField: vi.fn(),
    deleteField: vi.fn(),
    reorderFields: vi.fn(),
  };
});

// Helper function to render with Router and QueryClient
function renderWithProviders(component: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        {component}
      </QueryClientProvider>
    </BrowserRouter>
  );
}

describe('FieldManagementPage', () => {
  it('应该展示页面标题', async () => {
    vi.mocked(fieldsApi.getFields).mockResolvedValue([]);

    renderWithProviders(<FieldManagementPage />);

    // 等待加载完成后，标题应该存在
    expect(await screen.findByText('字段管理')).toBeInTheDocument();
  });

  it('应该有返回按钮', async () => {
    vi.mocked(fieldsApi.getFields).mockResolvedValue([]);

    renderWithProviders(<FieldManagementPage />);

    // 等待加载完成后，返回按钮应该存在
    expect(await screen.findByText('返回')).toBeInTheDocument();
  });

  it('应该有新增字段按钮', async () => {
    vi.mocked(fieldsApi.getFields).mockResolvedValue([]);

    renderWithProviders(<FieldManagementPage />);

    // 等待加载完成后，新增按钮应该存在
    expect(await screen.findByRole('button', { name: /新增字段/ })).toBeInTheDocument();
  });

  it('加载时应该显示 Loader', () => {
    // Mock 返回一个永远不 resolve 的 Promise 来保持加载状态
    vi.mocked(fieldsApi.getFields).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<FieldManagementPage />);

    // 加载时应该显示 Loader（通过 aria-label 或 class 检测）
    const loader = document.querySelector('.animate-spin');
    expect(loader).toBeInTheDocument();
  });
});
