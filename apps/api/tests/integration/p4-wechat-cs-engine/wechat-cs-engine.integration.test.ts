/**
 * Path 4 微信客服回复引擎 Sprint A — 端到端 mock 集成测试。
 *
 * 真·端到端：真 Postgres（zenithjoy_test，迁移自动应用），只 mock 两个外部 SaaS：
 *   - axios（飞书 Bitable）：白名单命中 + 互动记录写入
 *   - global.fetch（OpenRouter）：reply 调用返回带 <think> + 客服腔；consolidate 调用返回 JSON facts
 *
 * 验四件事（对应用户三个诉求）：
 *   1) 风格净化：模型返回的 <think>…</think> 和禁用词被剥干净
 *   2) 跨轮长期记忆：第 1 轮说"对花生过敏"→ 固化进长期记忆 → 后续回复 prompt 里带着"花生"
 *   3) 三层落库：真 DB 里 wechat_messages 有 in/out 记录、wechat_contact_memory 有 facts
 *   4) 三口井：喂模型的内容同时含 人设(self_name) + 企业知识库 + 客户记忆
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// ── mock 飞书（axios）──────────────────────────────────────────────────────────
vi.mock('axios', () => ({
  default: { post: vi.fn() },
}));
import axios from 'axios';
const mockedAxios = vi.mocked(axios, true);

import pool from '../../../src/db/connection';
import {
  generateChatDraft,
  _resetFeishuTokenCache,
} from '../../../src/services/wechat-draft';
import {
  consolidate,
  getContactMemory,
} from '../../../src/services/wechat/contact-memory';

const SENDER = '客户A';
const WECHAT_ID = 'wx_cs_engine_e2e';
const CONTACT_KEY = WECHAT_ID; // generateChatDraft 用 wechat_id 当 contactKey

// fetch 请求体捕获，供断言"喂给模型的内容"
let fetchBodies: any[] = [];

function installFetchMock(): void {
  fetchBodies = [];
  global.fetch = vi.fn(async (_url: any, opts: any) => {
    const body = JSON.parse(opts.body);
    fetchBodies.push(body);
    const hasSystem = Array.isArray(body.messages)
      && body.messages.some((m: any) => m.role === 'system');
    let content: string;
    if (hasSystem) {
      // 回复调用：故意带 <think> 思考块 + 客服腔禁用词，测净化
      content =
        '<think>客户对花生过敏，注意别推含花生的套餐</think>给你推荐进阶版哈，挺合适的😊 亲 有什么可以帮您';
    } else {
      // consolidate 调用：返回 JSON facts
      content = JSON.stringify({
        summary: '客户提到对花生过敏，并咨询套餐推荐',
        facts: [{ category: '禁忌', content: '对花生过敏' }],
      });
    }
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        model: 'deepseek/deepseek-chat',
      }),
    } as any;
  }) as any;
}

beforeAll(async () => {
  process.env.FEISHU_APP_ID = 'test_app_id';
  process.env.FEISHU_APP_SECRET = 'test_secret';
  process.env.FEISHU_TEST_APP_TOKEN = 'mock_app_token';
  process.env.FEISHU_CUSTOMER_TABLE_ID = 'tbl_customer';
  process.env.FEISHU_INTERACTION_TABLE_ID = 'tbl_interaction';
  delete process.env.FEISHU_PROFILE_TABLE_ID;
  process.env.OPENROUTER_API_KEY = 'sk-test-mock';
  // 客服回复走 ToAPI（CS_LLM.apiKey=TOAPI_API_KEY）；fetch 已全局 mock，任意 key 都行，
  // 但 callOpenRouter 在自定义端点下会校验 apiKey 非空，故测试也要给个占位 key。
  process.env.TOAPI_API_KEY = 'sk-test-mock';
  process.env.NODE_ENV = 'test';
  delete process.env.OPENROUTER_FORCE_5XX;
  // 用仓库内置示例配置，保证人设/企业知识库有确定性数据
  // （loadPersona/loadBusinessKB 默认读 apps/api/config/*.json）
});

afterAll(async () => {
  await pool.query('DELETE FROM zenithjoy.wechat_messages WHERE contact_key = $1', [CONTACT_KEY]);
  await pool.query('DELETE FROM zenithjoy.wechat_contact_memory WHERE contact_key = $1', [CONTACT_KEY]);
});

beforeEach(async () => {
  vi.clearAllMocks();
  _resetFeishuTokenCache();
  installFetchMock();
  // 每个 it 从干净记忆起步
  await pool.query('DELETE FROM zenithjoy.wechat_messages WHERE contact_key = $1', [CONTACT_KEY]);
  await pool.query('DELETE FROM zenithjoy.wechat_contact_memory WHERE contact_key = $1', [CONTACT_KEY]);
  // 飞书 mock：token + 任意 search 命中白名单 + records.create 成功
  (mockedAxios.post as any).mockImplementation(async (url: string) => {
    if (url.includes('tenant_access_token')) {
      return { data: { code: 0, tenant_access_token: 'mock_token' } };
    }
    if (url.includes('/search')) {
      return {
        data: {
          code: 0,
          data: { items: [{ record_id: 'rec1', fields: { 客户名: SENDER, 微信号: WECHAT_ID } }] },
        },
      };
    }
    if (/\/records$/.test(url)) {
      return { data: { code: 0, data: { record: { record_id: 'rec_x' } } } };
    }
    return { data: { code: 0, data: { items: [] } } };
  });
});

describe('微信客服引擎 — 端到端 mock', () => {
  it('① 风格净化：回复剥掉 <think> 思考块 + 禁用客服腔', async () => {
    const res = await generateChatDraft({
      sender: SENDER,
      wechat_id: WECHAT_ID,
      content: '在吗',
      mode: 'auto',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.reply).toBeDefined();
      expect(res.reply).not.toMatch(/<think>/);
      expect(res.reply).not.toMatch(/思考过程|让我想想/);
      expect(res.reply).not.toContain('有什么可以帮您');
      expect(res.reply).not.toContain('亲');
    }
  });

  it('② 跨轮长期记忆 + ③ 三层落库 + ④ 三口井', async () => {
    // 第 1 轮：客户说对花生过敏
    await generateChatDraft({
      sender: SENDER,
      wechat_id: WECHAT_ID,
      content: '我对花生过敏，你们套餐里有花生吗',
      mode: 'auto',
    });
    // 强制固化，把"对花生过敏"抽进长期记忆（真 DB）
    await consolidate(CONTACT_KEY, { force: true });

    const mem = await getContactMemory(CONTACT_KEY);
    expect(JSON.stringify(mem.facts)).toContain('花生'); // 长期事实已落库

    // 第 2 轮：问推荐 —— 此时 prompt 必须带着"花生"这条跨轮记忆
    fetchBodies = [];
    const res2 = await generateChatDraft({
      sender: SENDER,
      wechat_id: WECHAT_ID,
      content: '给我推荐个套餐',
      mode: 'auto',
    });
    expect(res2.ok).toBe(true);

    // 找到"回复调用"（带 system 的那次）
    const replyCall = fetchBodies.find((b) =>
      Array.isArray(b.messages) && b.messages.some((m: any) => m.role === 'system'),
    );
    expect(replyCall).toBeTruthy();
    const sys = replyCall.messages.find((m: any) => m.role === 'system').content as string;
    const usr = replyCall.messages.find((m: any) => m.role === 'user').content as string;
    const whole = sys + '\n' + usr;

    // ④ 三口井：人设(self_name 小齐) + 企业知识库(公司名/资料) + 客户记忆(花生)
    expect(whole).toContain('小齐'); // 人设
    expect(whole).toMatch(/私域|ZenithJoy|套餐|进阶版|基础版/); // 企业知识库
    // ② 跨轮记忆：花生 出现在喂给模型的上下文里
    expect(whole).toContain('花生');

    // ③ 三层落库：真 DB 有逐条消息 + 长期记忆
    const msgs = await pool.query(
      'SELECT direction FROM zenithjoy.wechat_messages WHERE contact_key = $1',
      [CONTACT_KEY],
    );
    expect(msgs.rowCount).toBeGreaterThanOrEqual(3); // 至少 in/out/in
    expect(msgs.rows.some((r: any) => r.direction === 'in')).toBe(true);
    expect(msgs.rows.some((r: any) => r.direction === 'out')).toBe(true);

    const memRow = await pool.query(
      'SELECT facts FROM zenithjoy.wechat_contact_memory WHERE contact_key = $1',
      [CONTACT_KEY],
    );
    expect(memRow.rowCount).toBe(1);
  });
});
