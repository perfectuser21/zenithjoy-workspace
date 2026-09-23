/**
 * app.ts 挂载顺序 —— 真行为验证
 *
 * 守的事情：支付回调路由必须挂在全局 express.json() 之前、用 express.raw 接收，
 * 因为微信支付 APIv3 验签基于原始字节，body 一旦被 json 中间件解析，
 * 原始串无法还原，验签必然失败。
 *
 * 用真实 app（import 自 ../../src/app，不是自搭 express()）+ 注入替身 provider，
 * 在 verifyCallback 里捕获收到的 rawBody，断言它是逐字节保留的 Buffer——
 * 而不是去读源码文本正则匹配（那种写法挂载顺序真的错了也测不出来）。
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { __setProviderForTest } from '../../src/services/payment/provider-registry';
import { SignatureError, type PaymentProvider } from '../../src/services/payment/types';

vi.mock('../../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn(), connect: vi.fn() },
}));

describe('app.ts 挂载顺序', () => {
  it('支付回调路由挂在 express.json() 之前：provider 收到未被解析的原始字节', async () => {
    let capturedRaw: Buffer | undefined;
    let capturedHeaders: Record<string, string | undefined> | undefined;

    // 替身 provider：只捕获 rawBody/headers，然后抛 SignatureError 短路，
    // 不走到需要真实 DB 的结算路径——这条测试只关心"路由收到的是不是原始字节"。
    const capturingProvider: PaymentProvider = {
      name: 'mock',
      async createOrder() {
        throw new Error('not used in this test');
      },
      verifyCallback(rawBody, headers) {
        capturedRaw = rawBody;
        capturedHeaders = headers;
        throw new SignatureError('capture-only，本测试不验证签名结果');
      },
      async queryOrder() {
        throw new Error('not used in this test');
      },
    };
    __setProviderForTest('mock', capturingProvider);

    const payload = { out_trade_no: 'mount-order-check', transaction_id: 'txn-x', event_type: 'paid' };
    const rawSent = JSON.stringify(payload);

    const res = await request(app)
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .send(rawSent);

    // verifyCallback 里抛的 SignatureError 被路由捕获后统一转 403
    expect(res.status).toBe(403);

    expect(capturedHeaders).toBeDefined();
    expect(Buffer.isBuffer(capturedRaw)).toBe(true);
    // 逐字节一致：若回调路由被挪到 express.json() 之后，req.body 会先被 JSON.parse
    // 成普通对象，payment-callback.ts 里 Buffer.from(String(req.body)) 只会拿到
    // "[object Object]"，下面这条断言必然失败。
    expect(capturedRaw!.toString('utf8')).toBe(rawSent);
  });

  it('反向断言：其余路由仍走 express.json()，body 被正常解析成对象（证明未破坏全局 json 中间件）', async () => {
    // /__test/llm-mode 是 DEV-only fake-LLM 替身端点，无鉴权，挂在 express.json() 之后。
    // 若请求体被正确解析为对象，handler 读 req.body.mode 成功会返回 200 + 回显 mode；
    // 若 body 仍是未解析的 Buffer/字符串，req.body?.mode 是 undefined，会落入 400 分支。
    const res = await request(app)
      .post('/__test/llm-mode')
      .set('Content-Type', 'application/json')
      .send({ mode: 'ok' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, mode: 'ok' });
  });
});
