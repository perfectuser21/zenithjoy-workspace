import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import CreditsPage from '../CreditsPage';
import * as api from '../../api/credits.api';

vi.mock('../../api/credits.api');

beforeEach(() => {
  vi.mocked(api.fetchBalance).mockResolvedValue({
    balance: 250, total_recharged: 500, total_consumed: 250,
  });
  vi.mocked(api.fetchTiers).mockResolvedValue([
    { id: 'tier_100', amountFen: 10000, credits: 100 },
  ]);
  vi.mocked(api.fetchTransactions).mockResolvedValue([
    { id: 'tx-1', amount: 100, reason: 'recharge', created_at: '2026-09-22T10:00:00Z' },
  ]);
  vi.mocked(api.createOrder).mockResolvedValue({
    orderId: 'o-1', qrCodeUrl: 'https://pay.example/qr', amountFen: 10000,
    credits: 100, expireAt: new Date(Date.now() + 60000).toISOString(),
  });
  vi.mocked(api.syncOrder).mockResolvedValue({ outcome: 'not_paid' });
});

describe('CreditsPage', () => {
  it('展示当前余额', async () => {
    render(<CreditsPage />);
    await waitFor(() => expect(screen.getByText('250')).toBeInTheDocument());
  });

  it('选档位下单后显示二维码', async () => {
    render(<CreditsPage />);
    await waitFor(() => screen.getByText(/100 积分/));
    fireEvent.click(screen.getByText(/100 积分/));
    fireEvent.click(screen.getByRole('button', { name: /微信支付/ }));
    // 二维码本地生成，断言它确实渲染出来了（内容正确性由 createOrder 的返回值保证，
    // 不去断言 SVG 内部结构——那是 qrcode.react 的实现细节）
    await waitFor(() => expect(screen.getByLabelText('支付二维码')).toBeInTheDocument());
  });

  it('点「我已支付」触发主动查单', async () => {
    render(<CreditsPage />);
    await waitFor(() => screen.getByText(/100 积分/));
    fireEvent.click(screen.getByText(/100 积分/));
    fireEvent.click(screen.getByRole('button', { name: /微信支付/ }));
    await waitFor(() => screen.getByLabelText('支付二维码'));
    fireEvent.click(screen.getByRole('button', { name: /我已支付/ }));
    await waitFor(() => expect(api.syncOrder).toHaveBeenCalledWith('o-1'));
  });

  it('查单返回 credited 时刷新余额并提示成功', async () => {
    vi.mocked(api.syncOrder).mockResolvedValue({ outcome: 'credited' });
    vi.mocked(api.fetchBalance)
      .mockResolvedValueOnce({ balance: 250, total_recharged: 500, total_consumed: 250 })
      .mockResolvedValue({ balance: 350, total_recharged: 600, total_consumed: 250 });

    render(<CreditsPage />);
    await waitFor(() => screen.getByText(/100 积分/));
    fireEvent.click(screen.getByText(/100 积分/));
    fireEvent.click(screen.getByRole('button', { name: /微信支付/ }));
    await waitFor(() => screen.getByLabelText('支付二维码'));
    fireEvent.click(screen.getByRole('button', { name: /我已支付/ }));

    await waitFor(() => expect(screen.getByText('充值成功')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('350')).toBeInTheDocument());
  });

  it('下单失败显示可重试提示', async () => {
    vi.mocked(api.createOrder).mockRejectedValue(new Error('CREATE_ORDER_FAILED'));
    render(<CreditsPage />);
    await waitFor(() => screen.getByText(/100 积分/));
    fireEvent.click(screen.getByText(/100 积分/));
    fireEvent.click(screen.getByRole('button', { name: /微信支付/ }));
    await waitFor(() =>
      expect(screen.getByText('生成二维码失败，请重试')).toBeInTheDocument()
    );
  });
});
