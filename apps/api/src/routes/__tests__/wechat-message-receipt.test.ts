/* eslint-disable @typescript-eslint/no-explicit-any -- 测试注入 mock */
/**
 * 同目录单测（CI lint-test-pairing 配对）— POST /api/wechat/messages/:id/receipt 路由契约。
 *
 * agent 真送达后回执：把 draft out 行翻 delivered/failed。只验路由层——
 *   - 身份解析交给共用 resolveCsWechatIdentity（三段链行为在 cs-identity-resolve.test.ts 覆盖），本文件只验路由用它的返回值
 *   - 缺身份 → 403 NO_CS_IDENTITY（不回退、不翻任意行）
 *   - id 非正整数 → 400 BAD_MESSAGE_ID
 *   - 命中翻行 → 200 { ok:true, updated }
 * markMessageReceipt / resolveCsWechatIdentity 均 mock（服务层行为在各自单测覆盖）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../services/wechat/contact-memory', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  markMessageReceipt: vi.fn(),
}));

vi.mock('../../services/wechat/cs-identity-resolve', () => ({
  resolveCsWechatIdentity: vi.fn(),
}));

import { markMessageReceipt } from '../../services/wechat/contact-memory';
import { resolveCsWechatIdentity } from '../../services/wechat/cs-identity-resolve';
import { wechatRouter } from '../wechat';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/wechat', wechatRouter);
  return app;
}

const app = makeApp();

beforeEach(() => vi.clearAllMocks());

describe('POST /api/wechat/messages/:id/receipt', () => {
  it('身份解析出 cs_wechat_id + ok:true → 翻 delivered，200 { ok:true, updated:true }，透传原始 body 给解析器', async () => {
    (resolveCsWechatIdentity as any).mockResolvedValue('cs-x');
    (markMessageReceipt as any).mockResolvedValue(true);
    const r = await request(app)
      .post('/api/wechat/messages/42/receipt')
      .send({ ok: true, cs_wechat_id: 'cs-x' });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, updated: true });
    // 路由把 body 的 cs_wechat_id / agent_id 透传给共用解析链
    expect(resolveCsWechatIdentity).toHaveBeenCalledWith({ directCsWechatId: 'cs-x', agentId: undefined });
    expect(markMessageReceipt).toHaveBeenCalledWith(42, true, 'cs-x');
  });

  it('agent_id 走解析链解出身份 + ok:false → 翻 failed，200 { ok:true, updated:false }', async () => {
    (resolveCsWechatIdentity as any).mockResolvedValue('cs-resolved');
    (markMessageReceipt as any).mockResolvedValue(false);
    const r = await request(app)
      .post('/api/wechat/messages/42/receipt')
      .send({ ok: false, agent_id: 'agent-1' });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, updated: false });
    expect(resolveCsWechatIdentity).toHaveBeenCalledWith({ directCsWechatId: undefined, agentId: 'agent-1' });
    expect(markMessageReceipt).toHaveBeenCalledWith(42, false, 'cs-resolved');
  });

  it('解析链返回 null（无身份）→ 403 NO_CS_IDENTITY，不翻行', async () => {
    (resolveCsWechatIdentity as any).mockResolvedValue(null);
    const r = await request(app)
      .post('/api/wechat/messages/42/receipt')
      .send({ ok: true });

    expect(r.status).toBe(403);
    expect(r.body.error).toBe('NO_CS_IDENTITY');
    expect(markMessageReceipt).not.toHaveBeenCalled();
  });

  it('id 非法（abc）→ 400 BAD_MESSAGE_ID，不解析身份、不翻行', async () => {
    const r = await request(app)
      .post('/api/wechat/messages/abc/receipt')
      .send({ ok: true, cs_wechat_id: 'cs-x' });

    expect(r.status).toBe(400);
    expect(r.body.error).toBe('BAD_MESSAGE_ID');
    expect(resolveCsWechatIdentity).not.toHaveBeenCalled();
    expect(markMessageReceipt).not.toHaveBeenCalled();
  });

  it('id 非法（-1）→ 400 BAD_MESSAGE_ID', async () => {
    const r = await request(app)
      .post('/api/wechat/messages/-1/receipt')
      .send({ ok: true, cs_wechat_id: 'cs-x' });

    expect(r.status).toBe(400);
    expect(r.body.error).toBe('BAD_MESSAGE_ID');
    expect(markMessageReceipt).not.toHaveBeenCalled();
  });
});
