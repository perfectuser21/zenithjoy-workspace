/**
 * Path 4 微信客服「中台配置」路由 — 集成测试（真 Postgres）。
 *
 * 真·端到端：真 zenithjoy_test（迁移 20260604_130000_create_wechat_cs_config.sql 由 global-setup
 * 自动应用），经 cs-config-store → zenithjoy.wechat_cs_config 落库。只 mock 一个外部 SaaS：
 *   - global.fetch（OpenRouter）：suggest-audience 返回 A1–A5 JSON
 *
 * 验三件事：
 *   1) PUT /persona → GET /persona 往返一致（落库 + 读回）
 *   2) PUT /business-kb → GET /business-kb 往返一致
 *   3) POST /business-kb/suggest-audience mock fetch 返回 A1–A5 → 断言返回 5 条 audience_segments
 *
 * 注：路由 mount 由 lead 在 app.ts 做；本测试自建 express app 挂 wechatConfigRouter，
 * superAdminGuard 在无 env（ADMIN_xxx / ZENITHJOY_INTERNAL_TOKEN 未设）时自动放行。
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { wechatConfigRouter } from '../../../src/routes/wechat-config';
import { testPool } from '../helpers';
import type { BusinessKB, Persona } from '../../../src/services/wechat/types';

const app = express();
app.use(express.json());
app.use('/api/wechat', wechatConfigRouter);

// setup-env.ts 给集成环境设了 ADMIN_FEISHU_OPENIDS / ZENITHJOY_INTERNAL_TOKEN，
// 故 superAdminGuard 不会自动放行 —— 请求需带白名单内的飞书 admin openid。
const ADMIN = process.env.ADMIN_FEISHU_OPENIDS?.split(',')[0]?.trim() || 'ou_admin_integration_001';
const INTERNAL_TOKEN = process.env.ZENITHJOY_INTERNAL_TOKEN || 'integration-test-token';
// 双保险：同时带飞书 admin openid + internal token，避免全量集成跑时 env 状态时序导致 superAdminGuard 偶发 401
const asAdmin = (r: request.Test) =>
  r.set('X-Feishu-User-Id', ADMIN).set('X-Internal-Token', INTERNAL_TOKEN);

const PERSONA: Persona = {
  self_name: '小米',
  address_style: '亲',
  tone: '热情专业',
  sentence_style: '短句，多拆行',
  use_emoji: '偶尔用 😊',
  banned_phrases: ['亲亲', '在的呢'],
  few_shot: [{ customer: '你们贵不贵', me: '看需求的哈，我帮你算笔账～' }],
};

const BUSINESS_KB: BusinessKB = {
  company: {
    name: 'ZenithJoy',
    what_we_do: '一人公司内容运营自动化',
    value_prop: '让创作者把精力放在创作上',
    contact: 'wx: zenithjoy',
  },
  products: [
    { name: '内容流水线', selling_points: '一键多平台发布', price: '¥299/月' },
    { name: 'AI 客服', selling_points: '私域自动接管' },
  ],
  audience_segments: [
    { code: 'A1', label: '独立创作者', desc: '一个人运营多个账号，时间紧' },
  ],
  qa_docs: [{ q: '支持哪些平台？', a: '抖音/小红书/公众号等 8 个平台' }],
};

describe('wechat-config 路由 — integration', () => {
  beforeAll(async () => {
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
    await testPool.query('TRUNCATE zenithjoy.wechat_cs_config CASCADE');
  });

  afterAll(async () => {
    await testPool.query('TRUNCATE zenithjoy.wechat_cs_config CASCADE');
    vi.restoreAllMocks();
  });

  it('PUT /persona 落库后 GET /persona 往返一致', async () => {
    const put = await asAdmin(request(app).put('/api/wechat/persona')).send(PERSONA);
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ success: true });

    // DB 真落了一行
    const { rows } = await testPool.query(
      `SELECT value FROM zenithjoy.wechat_cs_config WHERE key = 'persona'`,
    );
    expect(rows).toHaveLength(1);

    const get = await asAdmin(request(app).get('/api/wechat/persona'));
    expect(get.status).toBe(200);
    expect(get.body).toEqual(PERSONA);
  });

  it('PUT /business-kb 落库后 GET /business-kb 往返一致', async () => {
    const put = await asAdmin(request(app).put('/api/wechat/business-kb')).send(BUSINESS_KB);
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ success: true });

    const get = await asAdmin(request(app).get('/api/wechat/business-kb'));
    expect(get.status).toBe(200);
    expect(get.body).toEqual(BUSINESS_KB);
  });

  it('PUT /persona 非法 body → 400 INVALID_BODY', async () => {
    const res = await asAdmin(request(app).put('/api/wechat/persona')).send({
      self_name: '小米',
    }); // 缺一堆必填字段
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BODY');
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('POST /business-kb/suggest-audience mock fetch 返回 A1–A5 → 5 条', async () => {
    const segs = [
      { code: 'A1', label: '独立创作者', desc: '一个人运营多账号' },
      { code: 'A2', label: '小微电商', desc: '需要私域复购' },
      { code: 'A3', label: 'MCN 运营', desc: '批量管理达人' },
      { code: 'A4', label: '知识付费讲师', desc: '社群转化课程' },
      { code: 'A5', label: '本地实体店', desc: '到店引流' },
    ];
    const fetchSpy = vi.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ audience_segments: segs }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
        model: 'deepseek/deepseek-chat',
      }),
      text: async () => '',
    } as never);

    const res = await asAdmin(
      request(app).post('/api/wechat/business-kb/suggest-audience'),
    ).send({ industry: '内容运营 SaaS', products: '内容流水线', value_prop: '省时间' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.audience_segments)).toBe(true);
    expect(res.body.audience_segments).toHaveLength(5);
    expect(res.body.audience_segments[0]).toEqual({
      code: 'A1',
      label: '独立创作者',
      desc: '一个人运营多账号',
    });

    fetchSpy.mockRestore();
  });

  it('POST /business-kb/suggest-audience 模型返回乱码 → 400 PARSE_FAILED', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '我觉得这个行业的人群有很多种，无法一概而论。' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        model: 'deepseek/deepseek-chat',
      }),
      text: async () => '',
    } as never);

    const res = await asAdmin(
      request(app).post('/api/wechat/business-kb/suggest-audience'),
    ).send({ industry: '某行业' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PARSE_FAILED');

    fetchSpy.mockRestore();
  });

  it('POST /business-kb/suggest-audience 缺 industry → 400 INVALID_BODY', async () => {
    const res = await asAdmin(request(app).post('/api/wechat/business-kb/suggest-audience')).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BODY');
  });
});
