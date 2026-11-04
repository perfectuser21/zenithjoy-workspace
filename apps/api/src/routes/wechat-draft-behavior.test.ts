/** Actual HTTP router + actual draft service; isolated DB and model transport. */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Server } from 'node:http';
import { listenLoopback, closeLoopback } from '../../tests/helpers/loopback-server';
const { query, llm } = vi.hoisted(() => ({ query: vi.fn(), llm: vi.fn() }));
vi.mock('../db/connection', () => ({ default: { query, connect: vi.fn(), end: vi.fn() } }));
vi.mock('../llm/openrouter', () => ({ callOpenRouter: llm }));
import { wechatRouter } from './wechat';
const app = express(); app.use(express.json()); app.use('/api/wechat', wechatRouter);
let server: Server;
beforeAll(async () => { server = await listenLoopback(app); });
afterAll(async () => { await closeLoopback(server); });
beforeEach(() => { query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 }); llm.mockReset().mockResolvedValue({ content: '收到，您好。' }); });
const payload = { sender: 'fixture-contact', wechat_id: 'fixture-wxid', tenant_id: 'fixture-tenant', content: '在吗', mode: 'auto' };
it('successful auto draft requires actual sent status and nonempty model reply', async () => {
  const response = await request(server).post('/api/wechat/draft-generate').send(payload);
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ ok: true, status: 'sent', reply: '收到，您好。' });
  expect(llm).toHaveBeenCalled();
  expect(query.mock.calls.filter(([sql]) => /INSERT INTO zenithjoy.wechat_publish_task/.test(sql))).toHaveLength(0);
});
it('HTTP200 model failure is explicitly ai_failed with no reply, never a successful send', async () => {
  llm.mockRejectedValue(new Error('fixture model unavailable'));
  const response = await request(server).post('/api/wechat/draft-generate').send(payload);
  expect(response.status).toBe(200);
  expect(response.body.status).toBe('ai_failed');
  expect(response.body.reply).toBeUndefined();
  expect(response.body.status).not.toBe('sent');
});
it('group gating refuses to generate/send, without touching model transport', async () => {
  const response = await request(server).post('/api/wechat/draft-generate').send({ ...payload, is_group: true });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ status: 'skipped', skip_reason: 'group' });
  expect(response.body.reply).toBeUndefined(); expect(llm).not.toHaveBeenCalled();
});
it('missing tenant and invalid mode fail before a model call', async () => {
  expect((await request(server).post('/api/wechat/draft-generate').send({ ...payload, tenant_id: undefined })).status).toBe(400);
  expect((await request(server).post('/api/wechat/draft-generate').send({ ...payload, mode: 'bogus' })).status).toBe(400);
  expect(llm).not.toHaveBeenCalled();
});
