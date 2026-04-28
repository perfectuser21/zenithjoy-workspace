/**
 * Sprint A · WS2 — Dashboard 客户面板 /license
 *
 * BEHAVIOR 覆盖（合同 sprints/sprint-a-license-ui/contract-dod-ws2.md）:
 *  - LicensePage 在 license=null 时渲染 "暂无 License" 文案
 *  - LicensePage 在 license 存在时渲染 tier 文案
 *  - LicensePage 在 license 存在时渲染机器列表行（hostname）
 *  - LicensePage 点击 "申请续费" 按钮打开包含微信号的对话框
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LicensePage from '../LicensePage';
import * as licenseApi from '../../api/license.api';

vi.mock('../../api/license.api', () => ({
  fetchMyLicense: vi.fn(),
  listAllLicenses: vi.fn(),
  createLicense: vi.fn(),
  revokeLicense: vi.fn(),
}));

const LICENSE_FIXTURE = {
  id: '11111111-1111-1111-1111-111111111111',
  license_key: ['ZJ', 'M', 'ABCD1234'].join('-'),
  tier: 'matrix' as const,
  max_machines: 3,
  customer_id: 'ou_alice',
  customer_name: 'Alice',
  customer_email: 'alice@example.com',
  status: 'active' as const,
  issued_at: '2026-04-28T00:00:00Z',
  expires_at: '2027-04-28T00:00:00Z',
  revoked_at: null,
  notes: null,
  created_at: '2026-04-28T00:00:00Z',
  updated_at: '2026-04-28T00:00:00Z',
};

const MACHINE_FIXTURE = {
  id: '22222222-2222-2222-2222-222222222222',
  license_id: LICENSE_FIXTURE.id,
  machine_id: 'mac-alice-01',
  agent_id: 'agent-001',
  hostname: 'alice-MBP',
  first_seen: '2026-04-28T00:00:00Z',
  last_seen: '2026-04-28T01:00:00Z',
  status: 'active',
};

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('LicensePage [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('LicensePage 在 license=null 时渲染 "暂无 License" 文案', async () => {
    vi.mocked(licenseApi.fetchMyLicense).mockResolvedValue({
      license: null,
      machines: [],
    });

    render(<LicensePage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/暂无\s*License/)).toBeInTheDocument();
    });
  });

  it('LicensePage 在 license 存在时渲染 tier 文案', async () => {
    vi.mocked(licenseApi.fetchMyLicense).mockResolvedValue({
      license: LICENSE_FIXTURE,
      machines: [MACHINE_FIXTURE],
    });

    render(<LicensePage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/matrix/i)).toBeInTheDocument();
    });
  });

  it('LicensePage 在 license 存在时渲染机器列表行（hostname）', async () => {
    vi.mocked(licenseApi.fetchMyLicense).mockResolvedValue({
      license: LICENSE_FIXTURE,
      machines: [MACHINE_FIXTURE],
    });

    render(<LicensePage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('alice-MBP')).toBeInTheDocument();
    });
  });

  it('LicensePage 点击 "申请续费" 按钮打开包含微信号的对话框', async () => {
    vi.mocked(licenseApi.fetchMyLicense).mockResolvedValue({
      license: LICENSE_FIXTURE,
      machines: [MACHINE_FIXTURE],
    });

    render(<LicensePage />, { wrapper: createWrapper() });

    const renewBtn = await screen.findByRole('button', { name: /申请续费/ });
    fireEvent.click(renewBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText(/微信号/)).toBeInTheDocument();
  });
});
