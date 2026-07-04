/* eslint-disable @typescript-eslint/no-explicit-any -- 测试注入 mock */
/**
 * 同目录单测（CI lint-test-pairing 配对）— POST /api/wechat/messages/:id/receipt 路由契约。
 *
 * agent 真送达后回执：把 draft out 行翻 delivered/failed。只验路由层——
 *   - 身份解析链（body.cs_wechat_id 直传 > body.agent_id 走 resolveCsWechatIdByAgentId），与 draft-generate 一致
 *   - 缺身份 → 403 NO_CS_IDENTITY（不回退、不翻任意行）
 *   - id 非正整数 → 400 BAD_MESSAGE_ID
 *   - 命中翻行 → 200 { ok:true, updated }
 * markMessageReceipt / resolveCsWechatIdByAgentId 均 mock（服务层行为在 contact-memory.test.ts 覆盖）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../services/wechat/contact-memory', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  markMessageReceipt: vi.fn(),
}));

vi.mock('../../services/wechat/cs-account-config-store', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  resolveCsWechatIdByAgentId: vi.fn(),
}));

import { markMessageReceipt } from '../../services/wechat/contact-memory';
import { resolveCsWechatIdByAgentId } from '../../services/wechat/cs-account-config-store';
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
  it('直传 cs_wechat_id + ok:true → 翻 delivered，200 { ok:true, updated:true }', async () => {
    (markMessageReceipt as any).mockResolvedValue(true);
    const r = await request(app)
      .post('/api/wechat/messages/42/receipt')
      .send({ ok: true, cs_wechat_id: 'cs-x' });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, updated: true });
    expect(markMessageReceipt).toHaveBeenCalledWith(42, true, 'cs-x');
    // 直传身份优先，不走 agent_id 解析
    expect(resolveCsWechatIdByAgentId).not.toHaveBeenCalled();
  });

  it('无直传但有 agent_id → 走 resolveCsWechatIdByAgentId 解析身份', async () => {
    (resolveCsWechatIdByAgentId as any).mockResolvedValue('cs-resolved');
    (markMessageReceipt as any).mockResolvedValue(false);
    const r = await request(app)
      .post('/api/wechat/messages/42/receipt')
      .send({ ok: false, agent_id: 'agent-1' });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, updated: false });
    expect(resolveCsWechatIdByAgentId).toHaveBeenCalledWith('agent-1');
    expect(markMessageReceipt).toHaveBeenCalledWith(42, false, 'cs-resolved');
  });

  it('无身份（无 cs_wechat_id 无 agent_id）→ 403 NO_CS_IDENTITY，不翻行', async () => {
    const r = await request(app)
      .post('/api/wechat/messages/42/receipt')
      .send({ ok: true });

    expect(r.status).toBe(403);
    expect(r.body.error).toBe('NO_CS_IDENTITY');
    expect(markMessageReceipt).not.toHaveBeenCalled();
  });

  it('agent_id 解析不到身份 → 403 NO_CS_IDENTITY，不翻行', async () => {
    (resolveCsWechatIdByAgentId as any).mockResolvedValue(null);
    const r = await request(app)
      .post('/api/wechat/messages/42/receipt')
      .send({ ok: true, agent_id: 'agent-unknown' });

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
    expect(resolveCsWechatIdByAgentId).not.toHaveBeenCalled();
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
