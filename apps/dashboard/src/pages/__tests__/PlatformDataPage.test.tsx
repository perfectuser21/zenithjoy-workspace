import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PlatformDataPage from '../PlatformDataPage';
import * as platformDataApi from '../../api/platform-data.api';

// Mock the API
vi.mock('../../api/platform-data.api', () => ({
  fetchPlatformData: vi.fn(),
}));

describe('PlatformDataPage', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Default mock: return empty data successfully
    vi.mocked(platformDataApi.fetchPlatformData).mockResolvedValue({
      success: true,
      data: [],
    });
  });

  it('应该展示 7 个平台按钮', async () => {
    render(<PlatformDataPage />);

    // 等待组件渲染完成
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /抖音/ })).toBeInTheDocument();
    });

    // 验证 7 个平台都存在
    expect(screen.getByRole('button', { name: /抖音/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /快手/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /小红书/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /今日头条/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /微博/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /知乎/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /视频号/ })).toBeInTheDocument();
  });

  it('应该有刷新按钮', async () => {
    render(<PlatformDataPage />);

    await waitFor(() => {
      const refreshButton = screen.getByRole('button', { name: /刷新/ });
      expect(refreshButton).toBeInTheDocument();
    });
  });

  it('点击平台按钮应该切换平台', async () => {
    render(<PlatformDataPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /抖音/ })).toBeInTheDocument();
    });

    // 点击快手
    const kuaishouButton = screen.getByRole('button', { name: /快手/ });
    fireEvent.click(kuaishouButton);

    // 验证 API 被调用（切换平台会触发数据加载）
    await waitFor(() => {
      expect(platformDataApi.fetchPlatformData).toHaveBeenCalledWith('kuaishou');
    });
  });

  it('加载状态应该显示 loading', async () => {
    // Mock API 返回一个延迟的 Promise
    vi.mocked(platformDataApi.fetchPlatformData).mockImplementation(
      () => new Promise((resolve) => {
        setTimeout(() => resolve({ success: true, data: [] }), 100);
      })
    );

    render(<PlatformDataPage />);

    // 应该显示加载状态
    await waitFor(() => {
      expect(screen.getByText(/加载中.../)).toBeInTheDocument();
    });
  });

  it('错误状态应该显示错误信息', async () => {
    // Mock API 返回错误
    vi.mocked(platformDataApi.fetchPlatformData).mockResolvedValue({
      success: false,
      error: '网络错误',
      data: [],
    });

    render(<PlatformDataPage />);

    // 应该显示错误信息
    await waitFor(() => {
      expect(screen.getByText(/网络错误/)).toBeInTheDocument();
    });
  });
});
