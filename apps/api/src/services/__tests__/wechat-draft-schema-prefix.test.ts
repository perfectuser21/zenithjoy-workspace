/* eslint-disable @typescript-eslint/no-explicit-any -- 注入 mock deps，测试容忍 any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import pool from '../../db/connection';
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
 *
 * generateMomentDraft 已去飞书（决策 19e6480c，2026-07-14）：营销画像改读本地表
 * zenithjoy.wechat_marketing_profile，不再 mock 飞书 axios/env，直接 seed 本地表。
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
const queryMock = vi.mocked(pool.query);

/** 收集所有命中 wechat_publish_task 的 SQL 文本。 */
async function collectPublishTaskSql(): Promise<string[]> {
  return queryMock.mock.calls
    .map((c: any[]) => String(c[0]))
    .filter((sql: string) => /wechat_publish_task/.test(sql));
}

describe('wechat-draft schema 前缀回归 [BEHAVIOR]', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it('generateChatDraft 去飞书后不再落 wechat_publish_task（个人私聊自动直发，无审核台）', async () => {
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
    // 营销画像 3 字段齐全（本地表）→ 进入去重 SELECT + INSERT 路径
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('FROM zenithjoy.wechat_marketing_profile')) {
        return Promise.resolve({
          rows: [{ industry: '美业', audience: '宝妈', hook: '限时优惠' }],
        }) as any;
      }
      return Promise.resolve({ rows: [] }) as any;
    });
    vi.mocked(callOpenRouter).mockResolvedValue({ content: '今天也要元气满满～' } as any);

    const mod = await import('../wechat-draft');
    await mod.generateMomentDraft({ tenant_id: 'tenant-1', customer: '于瑾' });

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

describe('generateMomentDraft — 本地表驱动', () => {
  beforeEach(() => {
    queryMock.mockReset();
    vi.mocked(callOpenRouter).mockResolvedValue({ content: '好的，已收到' } as any);
  });

  it('本地画像存在 → 生成成功，不再调用 axios', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('FROM zenithjoy.wechat_marketing_profile')) {
        return Promise.resolve({
          rows: [{ industry: '教育', audience: '家长', hook: '不打骂也能让孩子主动写作业' }],
        }) as any;
      }
      if (sql.includes('SELECT task_id FROM zenithjoy.wechat_publish_task')) {
        return Promise.resolve({ rows: [] }) as any; // 未生成过
      }
      if (sql.includes('INSERT INTO zenithjoy.wechat_publish_task')) {
        return Promise.resolve({ rows: [] }) as any;
      }
      return Promise.resolve({ rows: [] }) as any;
    });
    vi.mocked(callOpenRouter).mockResolvedValue({ content: '家长们，作业难题有救了～' } as any);

    const mod = await import('../wechat-draft');
    const result = await mod.generateMomentDraft({ tenant_id: 'tenant-1', customer: '画像客户_1' });

    expect(result.ok).toBe(true);
    expect(mockedPost).not.toHaveBeenCalled(); // 不再调飞书 axios
  });

  it('本地画像不存在 → profile_missing', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('FROM zenithjoy.wechat_marketing_profile')) {
        return Promise.resolve({ rows: [] }) as any;
      }
      return Promise.resolve({ rows: [] }) as any;
    });

    const mod = await import('../wechat-draft');
    const result = await mod.generateMomentDraft({ tenant_id: 'tenant-1', customer: '无画像客户' });

    expect(result).toEqual({ ok: false, reason: 'profile_missing' });
  });

  it('当日去重 SELECT 带 tenant_id，避免跨租户同名客户误判 already_generated_today', async () => {
    let dupSql = '';
    let dupParams: unknown[] = [];
    queryMock.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('FROM zenithjoy.wechat_marketing_profile')) {
        return Promise.resolve({
          rows: [{ industry: '教育', audience: '家长', hook: '不打骂也能让孩子主动写作业' }],
        }) as any;
      }
      if (sql.includes('SELECT task_id FROM zenithjoy.wechat_publish_task')) {
        dupSql = sql;
        dupParams = params ?? [];
        return Promise.resolve({ rows: [] }) as any;
      }
      return Promise.resolve({ rows: [] }) as any;
    });

    const mod = await import('../wechat-draft');
    await mod.generateMomentDraft({ tenant_id: 'tenant-2', customer: '同名客户' });

    expect(dupSql).toMatch(/tenant_id\s*=\s*\$3/);
    expect(dupParams).toEqual(['moment', '同名客户', 'tenant-2']);
  });

  it('INSERT wechat_publish_task 携带 tenant_id，不落 NULL', async () => {
    let insertSql = '';
    let insertParams: unknown[] = [];
    queryMock.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('FROM zenithjoy.wechat_marketing_profile')) {
        return Promise.resolve({
          rows: [{ industry: '教育', audience: '家长', hook: '不打骂也能让孩子主动写作业' }],
        }) as any;
      }
      if (sql.includes('SELECT task_id FROM zenithjoy.wechat_publish_task')) {
        return Promise.resolve({ rows: [] }) as any;
      }
      if (sql.includes('INSERT INTO zenithjoy.wechat_publish_task')) {
        insertSql = sql;
        insertParams = params ?? [];
        return Promise.resolve({ rows: [] }) as any;
      }
      return Promise.resolve({ rows: [] }) as any;
    });

    const mod = await import('../wechat-draft');
    await mod.generateMomentDraft({ tenant_id: 'tenant-3', customer: '客户X' });

    expect(insertSql).toMatch(/tenant_id/);
    expect(insertParams).toContain('tenant-3');
  });
});
