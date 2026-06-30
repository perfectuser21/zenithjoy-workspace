/* eslint-disable @typescript-eslint/no-explicit-any -- 注入 mock deps，测试容忍 any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { callOpenRouter } from '../../llm/openrouter';

/**
 * 遗留③回归测试：wechat_publish_task 的 SQL 必须带 `zenithjoy.` schema 前缀。
 *
 * 真机现象：staging(zenithjoy_test) 反复刷
 *   `[wechat-draft] DB INSERT wechat_publish_task : error: relation "wechat_publish_task" does not exist`
 * 根因：表在 `zenithjoy` schema 而非 public；pool 没设 search_path（默认 `$user,public`），
 *   wechat-draft.ts 的 3 处 SQL（INSERT chat / SELECT 当日去重 / INSERT moment）漏了 `zenithjoy.` 前缀
 *   → 在 public 找不到 → does not exist（被 try/catch 吞成 warn，审核台记录没落库）。
 *
 * 本测试 mock pool.query 捕获所有对 wechat_publish_task 的 SQL，断言全部带 `zenithjoy.` 限定。
 * 修复前为红（裸表名），修复后为绿（zenithjoy.wechat_publish_task）。
 */

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock('../../llm/openrouter', () => ({
  callOpenRouter: vi.fn(),
}));

vi.mock('axios', () => ({
  default: { post: vi.fn(), get: vi.fn() },
}));

vi.mock('../wechat/cs-config-store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getAutoAgentConfig: vi.fn().mockResolvedValue({
      auto_agent_enabled: true,
      business_hours_start: '00:00',
      business_hours_end: '24:00',
      key_contact_wechat: '',
      daily_limit: 0,
    }),
  };
});

const mockedPost = vi.mocked(axios.post);

/** 飞书 mock：名单内 1 客户 + 空互动历史。 */
function setupFeishuMock(customers: any[] = [{ record_id: 'cust1', fields: { 客户名: '于瑾' } }]) {
  mockedPost.mockReset();
  mockedPost.mockImplementation((url: any) => {
    const u = String(url);
    if (u.includes('/auth/v3/tenant_access_token/internal')) {
      return Promise.resolve({
        data: { code: 0, tenant_access_token: 'mock_token', expire: 7200 },
      }) as any;
    }
    if (u.includes('/records/search')) {
      const searchCalls = mockedPost.mock.calls.filter((c) =>
        String(c[0]).includes('/records/search'),
      ).length;
      if (searchCalls <= 1) {
        return Promise.resolve({ data: { code: 0, data: { items: customers } } }) as any;
      }
      return Promise.resolve({ data: { code: 0, data: { items: [] } } }) as any;
    }
    if (u.includes('/records')) {
      return Promise.resolve({
        data: { code: 0, data: { record: { record_id: 'rec_mock_123' } } },
      }) as any;
    }
    return Promise.resolve({ data: { code: 0 } }) as any;
  });
}

/** 收集所有命中 wechat_publish_task 的 SQL 文本。 */
async function collectPublishTaskSql(): Promise<string[]> {
  const conn: any = await import('../../db/connection');
  const queryMock = conn.default.query as ReturnType<typeof vi.fn>;
  return queryMock.mock.calls
    .map((c: any[]) => String(c[0]))
    .filter((sql: string) => /wechat_publish_task/.test(sql));
}

describe('wechat-draft schema 前缀回归 [BEHAVIOR]', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../wechat-draft');
    mod._resetFeishuTokenCache?.();
    process.env.FEISHU_APP_ID = 'mock_app_id';
    process.env.FEISHU_APP_SECRET = 'mock_app_secret';
    process.env.FEISHU_TEST_APP_TOKEN = 'mock_app_token';
    process.env.FEISHU_CUSTOMER_TABLE_ID = 'tbl_customer';
    process.env.FEISHU_INTERACTION_TABLE_ID = 'tbl_interaction';
    process.env.FEISHU_SCHEDULE_TABLE_ID = 'tbl_schedule';
    process.env.FEISHU_PROFILE_TABLE_ID = 'tbl_profile';
  });

  it('generateChatDraft 去飞书后不再落 wechat_publish_task（个人私聊自动直发，无审核台）', async () => {
    setupFeishuMock();
    vi.mocked(callOpenRouter).mockResolvedValue({ content: '好的，已收到' } as any);

    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '于瑾',
      wechat_id: 'wxid_yujin',
      content: '你好',
      mode: 'auto',
    } as any);

    expect(result.status).toBe('sent');
    expect(result.reply).toBe('好的，已收到');

    // 去飞书：chat 路径不再 INSERT wechat_publish_task（不落 pending_review）
    const sqls = await collectPublishTaskSql();
    const insertSql = sqls.find((s) => /INSERT\s+INTO/i.test(s));
    expect(insertSql, 'chat 去飞书后不应再写 wechat_publish_task').toBeUndefined();
  });

  it('generateMomentDraft 的当日去重 SELECT 与 INSERT 均须带 zenithjoy. 前缀', async () => {
    // 营销画像 3 字段齐全 → 进入去重 SELECT + INSERT 路径
    mockedPost.mockReset();
    mockedPost.mockImplementation((url: any) => {
      const u = String(url);
      if (u.includes('/auth/v3/tenant_access_token/internal')) {
        return Promise.resolve({
          data: { code: 0, tenant_access_token: 'mock_token', expire: 7200 },
        }) as any;
      }
      if (u.includes('/records/search')) {
        return Promise.resolve({
          data: {
            code: 0,
            data: {
              items: [
                { record_id: 'p1', fields: { 行业: '美业', 受众: '宝妈', 钩子文案: '限时优惠' } },
              ],
            },
          },
        }) as any;
      }
      if (u.includes('/records')) {
        return Promise.resolve({
          data: { code: 0, data: { record: { record_id: 'rec_mock_456' } } },
        }) as any;
      }
      return Promise.resolve({ data: { code: 0 } }) as any;
    });
    vi.mocked(callOpenRouter).mockResolvedValue({ content: '今天也要元气满满～' } as any);

    const mod = await import('../wechat-draft');
    await mod.generateMomentDraft({ customer: '于瑾' } as any);

    const sqls = await collectPublishTaskSql();
    expect(sqls.length, 'moment 路径应至少有去重 SELECT + INSERT').toBeGreaterThanOrEqual(2);
    for (const sql of sqls) {
      expect(sql, `SQL 必须带 zenithjoy. 前缀: ${sql.slice(0, 60)}`).toMatch(
        /zenithjoy\.wechat_publish_task/i,
      );
      expect(sql, '不允许出现裸表名（未带 schema 限定）').not.toMatch(
        /(?<!zenithjoy\.)\bwechat_publish_task\b/i,
      );
    }
  });
});
