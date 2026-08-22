/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 刀2a 路由层测试：POST /api/agent/burner/locator-assist。
 * 校验必填、64KB 服务端截断、fail-open 响应形状。后端逻辑在 locator-assist.test.ts。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db/connection', () => ({ default: { query: vi.fn() } }));
vi.mock('../middleware/tenant-context', () => ({
  tenantContext: (_req: any, _res: any, next: any) => next(),
  tenantContextOptional: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../middleware/agent-context', () => ({
  agentContext: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../services/locator-assist', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../services/locator-assist')>();
  return { ...orig, requestLocatorAssist: vi.fn() };
});

import pool from '../db/connection';
import { requestLocatorAssist } from '../services/locator-assist';
import router from './agent-burner';

function app() {
  const a = express();
  a.use(express.json({ limit: '256kb' }));
  a.use('/api/agent/burner', router);
  return a;
}

describe('POST /locator-assist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (pool.query as any).mockResolvedValue({ rows: [], rowCount: 0 });
    (requestLocatorAssist as any).mockResolvedValue({
      status: 'ok', cacheHit: false, backend: 'tree-llm',
      candidates: [{ line: 1, view_id: 'x', text: null, content_desc: null, bounds: '[0,0][1,1]' }],
    });
  });

  it('step/target_desc/ui_tree_snapshot 缺一返回 400', async () => {
    const res = await request(app())
      .post('/api/agent/burner/locator-assist')
      .send({ step: 'dm_search_input', target_desc: '搜索输入框' });
    expect(res.status).toBe(400);
  });

  it('合法请求透传给 service 并返回候选', async () => {
    const res = await request(app())
      .post('/api/agent/burner/locator-assist')
      .send({
        step: 'dm_search_input',
        target_desc: '搜索输入框',
        ui_tree_snapshot: 'd0 android.widget.FrameLayout id=- text="-"',
        device_model: 'HONOR ANY-AN00',
        os_version: 'Android 12',
        douyin_version: '28.5.0',
        app_version: '2.1.36',
      });
    expect(res.status).toBe(200);
    expect(res.body.data.candidates[0].view_id).toBe('x');
    const arg = (requestLocatorAssist as any).mock.calls[0][0];
    expect(arg.step).toBe('dm_search_input');
    expect(arg.douyinVersion).toBe('28.5.0');
  });

  it('超长树服务端截断到 64KB 再进 service——不信任客户端', async () => {
    await request(app())
      .post('/api/agent/burner/locator-assist')
      .send({
        step: 's', target_desc: 't',
        ui_tree_snapshot: 'x'.repeat(80_000),
      });
    const arg = (requestLocatorAssist as any).mock.calls[0][0];
    expect(arg.uiTree.length).toBeLessThanOrEqual(65536);
  });

  it('service 返回 unavailable 时响应 200 + assist unavailable（fail-open，安卓端走原失败路径）', async () => {
    (requestLocatorAssist as any).mockResolvedValue({ status: 'unavailable', reason: 'llm_timeout' });
    const res = await request(app())
      .post('/api/agent/burner/locator-assist')
      .send({ step: 's', target_desc: 't', ui_tree_snapshot: 'd0 x' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('unavailable');
    expect(res.body.data.reason).toBe('llm_timeout');
  });
});

// ── 刀2b：assist_id 返回 + verified 回执端点 ──────────────────────────────
// 安卓端用完候选要回执"验证闸过没过"，刀3 周报靠 verified 判 AI 在该格子的答案
// 稳不稳、能不能固化进定位器。没有 assist_id 就没法回执。
describe('POST /locator-assist assist_id 与 /locator-assist/verify 回执', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (pool.query as any).mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('assist 响应必须带 assist_id 供后续回执', async () => {
    (requestLocatorAssist as any).mockResolvedValue({
      status: 'ok', cacheHit: false, backend: 'tree-llm', assistId: 'aid-777',
      candidates: [{ line: 1, view_id: 'x', text: null, content_desc: null, bounds: null }],
    });
    const res = await request(app())
      .post('/api/agent/burner/locator-assist')
      .send({ step: 's', target_desc: 't', ui_tree_snapshot: 'd0 x' });
    expect(res.status).toBe(200);
    expect(res.body.data.assist_id).toBe('aid-777');
  });

  it('verify 回执写 verified 列', async () => {
    const res = await request(app())
      .post('/api/agent/burner/locator-assist/verify')
      .send({ assist_id: 'b2222222-2222-4222-8222-222222222222', verified: true });
    expect(res.status).toBe(200);
    const calls = (pool.query as any).mock.calls as Array<[string, unknown[]?]>;
    const upd = calls.find(([sql]) =>
      /UPDATE\s+zenithjoy\.rpa_locator_assist/i.test(sql) && /verified/i.test(sql));
    expect(upd, '缺 verified UPDATE').toBeTruthy();
    expect(upd![1]).toEqual(expect.arrayContaining(['b2222222-2222-4222-8222-222222222222', true]));
  });

  it('verify 缺 assist_id 返回 400', async () => {
    const res = await request(app())
      .post('/api/agent/burner/locator-assist/verify')
      .send({ verified: true });
    expect(res.status).toBe(400);
  });
});
