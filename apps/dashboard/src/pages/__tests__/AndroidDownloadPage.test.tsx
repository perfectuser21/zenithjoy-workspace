import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AndroidDownloadPage from '../AndroidDownloadPage';
import * as walkingSkeleton1Api from '../../api/walking-skeleton-1.api';

// Mock the API（照 FieldManagementPage.test.tsx 既有风格：importOriginal + 覆盖目标函数）
vi.mock('../../api/walking-skeleton-1.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/walking-skeleton-1.api')>();
  return {
    ...actual,
    getAndroidInstallPack: vi.fn(),
  };
});

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

describe('AndroidDownloadPage', () => {
  it('渲染下载按钮、二维码、激活码', async () => {
    vi.mocked(walkingSkeleton1Api.getAndroidInstallPack).mockResolvedValue({
      apk_url: 'https://cos.example.com/zenithjoy-agent.apk',
      deeplink: 'zenithjoy://bind?license=ZJ-F-A1B2C3D4&api=wss%3A%2F%2Fx',
      license_key: 'ZJ-F-A1B2C3D4',
      version: '1.0.1',
    });

    renderWithProviders(<AndroidDownloadPage />);

    const dl = await screen.findByRole('link', { name: /下载安卓客户端/ });
    expect(dl).toHaveAttribute('href', 'https://cos.example.com/zenithjoy-agent.apk');
    expect(await screen.findByText('ZJ-F-A1B2C3D4')).toBeInTheDocument();
    // 二维码：QRCodeSVG 渲染成 <svg>，断言存在
    expect(document.querySelector('svg')).toBeTruthy();
  });
});
