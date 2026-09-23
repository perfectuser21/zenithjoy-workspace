/**
 * 支付回调 —— 公网端点，无 tenantContext，验签即鉴权。
 *
 * 铁律：
 *   - 必须挂在全局 express.json() 之前，用 express.raw 保留原始字节（验签依赖）
 *   - 己方异常一律返回 5xx 让平台重试；绝不在未成功入账时返回 200
 *   - 只记 out_trade_no / status / 验签结果，不记回调原文
 */
import { createHash } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { getProvider } from '../services/payment/provider-registry';
import {
  deleteCallbackRecord,
  findOrderByOutTradeNo,
  markRefundPending,
  recordCallback,
  settleOrder,
} from '../services/payment/settlement.service';
import { SignatureError } from '../services/payment/types';

export const paymentCallbackRouter = Router();

paymentCallbackRouter.post('/:provider', async (req: Request, res: Response) => {
  const providerName = req.params.provider;

  let provider;
  try {
    provider = getProvider(providerName);
  } catch {
    res.status(404).json({ code: 'UNKNOWN_PROVIDER' });
    return;
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''));

  let event;
  try {
    event = provider.verifyCallback(rawBody, req.headers as Record<string, string | undefined>);
  } catch (err) {
    if (err instanceof SignatureError) {
      console.warn('[payment] 回调验签失败', { provider: providerName });
      res.status(403).json({ code: 'SIGNATURE_INVALID' });
      return;
    }
    console.error('[payment] 回调解析失败', { provider: providerName });
    res.status(400).json({ code: 'MALFORMED_CALLBACK' });
    return;
  }

  const digest = createHash('sha256').update(rawBody).digest('hex');

  // I-1：审计去重闸（recordCallback）排在结算之前。首次投递若后续处理抛错返 5xx，
  // 平台重推时 recordCallback 会命中 UNIQUE 返回 false，路由直接判"重复"返 200——
  // 结算被永久跳过。first 记录本次是否真的是首次插入，只有它为 true 时，5xx 分支
  // 才需要把本次刚插入的审计行删掉，让平台重推能重新走完整流程。
  let first = false;
  try {
    // 先定位订单：审计行要带上 tenant 归属（租户隔离铁律）。
    // 对不上任何订单的回调（伪造 / 乱序）仍要记审计，此时两列为 null。
    const order = await findOrderByOutTradeNo(providerName, event.outTradeNo);

    first = await recordCallback(
      providerName,
      event.providerTransactionId,
      event.eventType,
      digest,
      order?.id ?? null,
      order?.tenantId ?? null
    );
    if (!first) {
      // 重复投递：已处理过，直接确认，避免平台无限重推
      res.status(200).json({ code: 'SUCCESS', note: 'duplicate' });
      return;
    }

    if (event.eventType === 'refunded') {
      // 退款绝不自动扣回积分（会撞 balance>=0 的 CHECK），落待人工
      if (order) await markRefundPending(order.id);
      console.warn('[payment] 收到退款回调，已落 refund_pending 待人工', {
        provider: providerName, out_trade_no: event.outTradeNo,
      });
      res.status(200).json({ code: 'SUCCESS' });
      return;
    }

    if (event.eventType === 'closed') {
      // 交易关闭（超时未付/主动取消）：既非成功支付也非退款，审计已在上面 recordCallback
      // 记过，这里不结算、不落 refund_pending，直接确认，避免平台无限重推。
      console.info('[payment] 收到交易关闭回调，仅记审计不做资金动作', {
        provider: providerName, out_trade_no: event.outTradeNo,
      });
      res.status(200).json({ code: 'SUCCESS' });
      return;
    }

    // 所有业务结论一律 200（含 credit_conflict / amount_mismatch / not_paid /
    // order_not_found）——见本 task 的 outcome→HTTP 映射表。只有抛异常才 5xx。
    const result = await settleOrder(event.outTradeNo, providerName);
    console.info('[payment] 回调结算完成', {
      provider: providerName, out_trade_no: event.outTradeNo, outcome: result.outcome,
    });
    res.status(200).json({ code: 'SUCCESS' });
  } catch (err) {
    // 己方问题：必须让平台重试。若本次是首次插入审计行，把它删掉——否则平台重推时
    // recordCallback 命中 UNIQUE 会被误判为"重复投递"，结算从此永久跳过。
    if (first) {
      try {
        await deleteCallbackRecord(providerName, event.providerTransactionId, event.eventType);
      } catch (delErr) {
        console.error('[payment] 删除审计行失败，重复投递可能被误判为已处理', {
          provider: providerName, out_trade_no: event.outTradeNo,
          error: (delErr as Error).message,
        });
      }
    }
    console.error('[payment] 回调处理失败，返回 5xx 请求平台重试', {
      provider: providerName, out_trade_no: event.outTradeNo,
      error: (err as Error).message,
    });
    res.status(500).json({ code: 'INTERNAL_ERROR' });
  }
});
