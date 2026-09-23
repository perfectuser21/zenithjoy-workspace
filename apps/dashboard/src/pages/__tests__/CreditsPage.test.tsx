import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import CreditsPage from '../CreditsPage';
import * as api from '../../api/credits.api';

// 用纯 microtask flush 推进由 mock promise 触发的状态更新，不碰计时器
// （倒计时那组测试要用 fake timers，这个 flush 在 fake/real 计时器下都能用）
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

vi.mock('../../api/credits.api');

beforeEach(() => {
  // 低成本顺手项：此前只靠单条用例内的 mockClear 兜住跨用例 mock 调用历史累加，
  // 是脆弱平衡——顶层统一 clearAllMocks 更稳妥。
  vi.clearAllMocks();
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

  // F1：credit_conflict 语义是"积分确已入账，只是订单状态曾滞后（账实分叉已自愈）"，
  // 必须和 credited / already_credited 一样当成功处理。这条测试专门守住这个分支，
  // 防止未来有人把 CREDITED_OUTCOMES 从 Set 重构成 if/else 时静默丢掉它
  // ——那样后果是商家钱已扣、积分已到账，页面却一直显示"未完成"。
  it('查单返回 credit_conflict 时视为成功，刷新余额并提示（不能被误判为未完成）', async () => {
    vi.mocked(api.syncOrder).mockResolvedValue({ outcome: 'credit_conflict' });
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

  // C-2：CAS 未命中的真实原因不一定是"已入账"。settleOrder 现在会为这种情况返回
  // not_settlable（而不是谎报 already_credited）。前端绝不能把它当成功：不刷新余额、
  // 不提示"充值成功"，而是提示订单状态异常、联系客服。
  it('C-2：查单返回 not_settlable 时显示订单状态异常提示，不刷新余额、不提示充值成功', async () => {
    vi.mocked(api.syncOrder).mockResolvedValue({ outcome: 'not_settlable' });

    render(<CreditsPage />);
    await waitFor(() => screen.getByText(/100 积分/));
    fireEvent.click(screen.getByText(/100 积分/));
    fireEvent.click(screen.getByRole('button', { name: /微信支付/ }));
    await waitFor(() => screen.getByLabelText('支付二维码'));
    fireEvent.click(screen.getByRole('button', { name: /我已支付/ }));

    await waitFor(() =>
      expect(screen.getByText(/订单状态异常.*联系客服/)).toBeInTheDocument()
    );
    expect(screen.queryByText('充值成功')).not.toBeInTheDocument();
    // 余额没有被刷新过第二次（fetchBalance 只在初次加载时调用一次）
    expect(api.fetchBalance).toHaveBeenCalledTimes(1);
  });

  // F2：手动点「我已支付」这条路径原来没有 try/catch，syncOrder 抛错时是一个
  // 未捕获的 Promise rejection——界面不报错不提示，用户只会反复点按钮。
  it('点「我已支付」查单失败时显示可重试提示，不产生未捕获的 Promise rejection', async () => {
    const onUnhandledRejection = vi.fn();
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      vi.mocked(api.syncOrder).mockRejectedValue(new Error('SYNC_FAILED'));
      render(<CreditsPage />);
      await waitFor(() => screen.getByText(/100 积分/));
      fireEvent.click(screen.getByText(/100 积分/));
      fireEvent.click(screen.getByRole('button', { name: /微信支付/ }));
      await waitFor(() => screen.getByLabelText('支付二维码'));
      fireEvent.click(screen.getByRole('button', { name: /我已支付/ }));

      await waitFor(() =>
        expect(screen.getByText('查询失败，请稍后重试')).toBeInTheDocument()
      );
      // 给事件循环一个 tick，确认真的没有 unhandledRejection 冒出来
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onUnhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  // F3：expireAt 拿到手却完全没用——没有倒计时 UI，也没有用它停止轮询。
  // 用户开着二维码不动、不切标签页，会无限轮询下去。团队已拍板：倒计时要做。
  describe('倒计时与过期收口', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('倒计时随时间变化，到期后停止轮询并提示过期', async () => {
      const start = Date.now();
      vi.mocked(api.createOrder).mockResolvedValue({
        orderId: 'o-1',
        qrCodeUrl: 'https://pay.example/qr',
        amountFen: 10000,
        credits: 100,
        // 3s 后过期，短于 5s 轮询周期——这样"到期后轮询停止"的断言不会和
        // "本来就该在到期前发生"的正常轮询调用混在一起
        expireAt: new Date(start + 3000).toISOString(),
      });

      render(<CreditsPage />);
      await flush();

      fireEvent.click(screen.getByText(/100 积分/));
      fireEvent.click(screen.getByRole('button', { name: /微信支付/ }));
      await flush();

      expect(screen.getByLabelText('支付二维码')).toBeInTheDocument();
      expect(screen.getByText('剩余 0:03')).toBeInTheDocument();

      // 清掉下单前那几条测试用例积累的调用记录（本文件顶层 beforeEach 没有
      // clearAllMocks，mock 调用历史跨用例累加），只关心这条用例自己的轮询行为
      vi.mocked(api.syncOrder).mockClear();

      // ① 倒计时文案随时间推进变化
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByText('剩余 0:02')).toBeInTheDocument();

      // 推进到到期时刻（累计 3000ms）
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      // ③ 过期提示 + 二维码收口
      expect(screen.queryByLabelText('支付二维码')).not.toBeInTheDocument();
      expect(screen.getByText('二维码已过期，请重新下单')).toBeInTheDocument();

      // ② 再推进超过一个轮询周期（5s），确认轮询确实停了，syncOrder 全程未被调用
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      expect(api.syncOrder).not.toHaveBeenCalled();
    });
  });
});
