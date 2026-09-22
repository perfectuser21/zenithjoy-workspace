/**
 * CreditsPage — 积分自助充值页（Task 10）
 *
 * 余额卡 + 档位选择 + 渠道按钮 + 二维码 + 我已支付 + 积分流水。
 * 二维码必须本地生成（qrcode.react），order.qrCodeUrl 是微信支付的 code_url，
 * 绝不能发给任何第三方图片服务。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  createOrder,
  fetchBalance,
  fetchTiers,
  fetchTransactions,
  syncOrder,
  type Balance,
  type CreatedOrder,
  type Tier,
  type Tx,
} from '../api/credits.api';

// 三个 outcome 都代表积分已到账：credited（本次落账）、already_credited（幂等重复确认）、
// credit_conflict（并发落账冲突但积分已在别处到账）——不能只认 credited，否则会漏报成功。
const CREDITED_OUTCOMES = new Set(['credited', 'already_credited', 'credit_conflict']);

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(Math.ceil(ms / 1000), 0);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function CreditsPage() {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = useCallback(async () => {
    setBalance(await fetchBalance());
    setTxs(await fetchTransactions());
  }, []);

  useEffect(() => {
    void reload();
    void fetchTiers().then(setTiers);
  }, [reload]);

  const check = useCallback(
    async (orderId: string) => {
      try {
        const r = await syncOrder(orderId);
        if (CREDITED_OUTCOMES.has(r.outcome)) {
          setMessage('充值成功');
          setOrder(null);
          if (timer.current) {
            clearInterval(timer.current);
            timer.current = null;
          }
          await reload();
        } else if (r.outcome === 'not_settlable') {
          // C-2：CAS 未命中但当前状态不是 credited（如订单已过期）——钱可能已收但
          // 订单无法正常结算，绝不能当成功处理，也不刷新余额，提示用户联系客服。
          setMessage('订单状态异常，请联系客服核实');
        }
      } catch {
        // 不把原始错误码甩给用户；网络抖动/后端 5xx 时给可重试提示，而不是让
        // Promise 静默 reject（那样手动点「我已支付」的用户会以为按钮坏了）
        setMessage('查询失败，请稍后重试');
      }
    },
    [reload]
  );

  // 轮询：5 秒一次，页面隐藏时暂停，避免后台标签空转；组件卸载 / 订单结清时清掉定时器
  useEffect(() => {
    if (!order) return;
    timer.current = setInterval(() => {
      if (document.visibilityState === 'visible') void check(order.orderId);
    }, 5000);
    return () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [order, check]);

  // 倒计时：每秒刷新剩余时间，归零时收口——停止轮询、清空订单退回选档位状态，
  // 并提示用户重新下单（不自动重新下单，下单会在后端真的创建订单记录）
  useEffect(() => {
    if (!order) {
      setRemainingMs(null);
      return;
    }
    const expireTs = new Date(order.expireAt).getTime();
    const tick = () => {
      const remain = expireTs - Date.now();
      if (remain <= 0) {
        setRemainingMs(0);
        if (countdownTimer.current) {
          clearInterval(countdownTimer.current);
          countdownTimer.current = null;
        }
        if (timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
        setOrder(null);
        setMessage('二维码已过期，请重新下单');
        return;
      }
      setRemainingMs(remain);
    };
    tick();
    countdownTimer.current = setInterval(tick, 1000);
    return () => {
      if (countdownTimer.current) {
        clearInterval(countdownTimer.current);
        countdownTimer.current = null;
      }
    };
  }, [order]);

  async function pay(provider: 'wechat' | 'alipay') {
    if (!selected) return;
    setMessage(null);
    try {
      setOrder(await createOrder(selected, provider));
    } catch {
      // 不把原始错误码甩给用户
      setMessage('生成二维码失败，请重试');
    }
  }

  return (
    <div className="p-6 space-y-6">
      <section>
        <h1 className="text-xl font-semibold">积分充值</h1>
        <p className="text-3xl mt-2">{balance?.balance ?? '—'}</p>
        <p className="text-sm text-muted-foreground">当前可用积分</p>
      </section>

      <section className="flex gap-3 flex-wrap">
        {tiers.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelected(t.id)}
            className={
              selected === t.id
                ? 'border-2 border-primary p-4 rounded'
                : 'border p-4 rounded'
            }
          >
            {t.credits} 积分 · ¥{(t.amountFen / 100).toFixed(2)}
          </button>
        ))}
      </section>

      <section className="flex gap-3">
        <button onClick={() => void pay('wechat')} disabled={!selected}>
          微信支付
        </button>
        <button onClick={() => void pay('alipay')} disabled={!selected}>
          支付宝
        </button>
      </section>

      {message && <p>{message}</p>}

      {order && (
        <section className="space-y-2">
          <div role="img" aria-label="支付二维码">
            <QRCodeSVG value={order.qrCodeUrl} size={220} />
          </div>
          <p className="text-sm">请使用手机扫码支付 ¥{(order.amountFen / 100).toFixed(2)}</p>
          {remainingMs !== null && (
            <p className="text-sm text-muted-foreground">剩余 {formatRemaining(remainingMs)}</p>
          )}
          <button onClick={() => void check(order.orderId)}>我已支付</button>
        </section>
      )}

      <section>
        <h2 className="font-medium mb-2">积分流水</h2>
        <table className="w-full text-sm">
          <tbody>
            {txs.map((t) => (
              <tr key={t.id}>
                <td>{new Date(t.created_at).toLocaleString()}</td>
                <td>{t.reason}</td>
                <td className={t.amount > 0 ? 'text-green-600' : 'text-red-600'}>
                  {t.amount > 0 ? `+${t.amount}` : t.amount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
