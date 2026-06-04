/* eslint-disable @typescript-eslint/no-explicit-any -- 测试注入 mock，容忍 any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '../../../db/connection';
import { callOpenRouter } from '../../../llm/openrouter';
import {
  appendMessage,
  getShortTerm,
  getContactMemory,
  consolidate,
} from '../contact-memory';

/**
 * contact-memory.ts 单测 —— **mock 掉 db connection + openrouter**，不连真实 DB/网络。
 *
 * 覆盖：
 *  - appendMessage 发 INSERT
 *  - getShortTerm 取 limit 且最终 ASC（DESC 查询 → reverse）
 *  - getContactMemory 解析 facts（含 jsonb 字符串）
 *  - consolidate 阈值未到不触发 / force 触发 / facts 去重合并 / LLM 非法 JSON 静默跳过
 */

vi.mock('../../../db/connection', () => ({
  default: { query: vi.fn() },
}));

vi.mock('../../../llm/openrouter', () => ({
  callOpenRouter: vi.fn(),
}));

const mockedQuery = vi.mocked(pool.query as any);
const mockedLLM = vi.mocked(callOpenRouter as any);

beforeEach(() => {
  vi.clearAllMocks();
  // 默认每条 query 都返回空 rows（各 case 按需覆盖）
  mockedQuery.mockResolvedValue({ rows: [] });
  delete process.env.WECHAT_SHORT_TERM_LIMIT;
  delete process.env.WECHAT_CONSOLIDATE_THRESHOLD;
  delete process.env.WECHAT_FEISHU_FACTS_SYNC;
});

// ─── appendMessage ─────────────────────────────────────────────────────────────

describe('appendMessage', () => {
  it('发一条 INSERT 到 wechat_messages，带正确参数', async () => {
    await appendMessage('wxid_1', '于瑾', 'in', '你好');

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO zenithjoy\.wechat_messages/);
    expect(params).toEqual(['wxid_1', '于瑾', 'in', '你好']);
  });

  it('DB 失败时 console.warn 不抛', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('db down'));
    await expect(
      appendMessage('wxid_1', '于瑾', 'out', '收到'),
    ).resolves.toBeUndefined();
  });
});

// ─── getShortTerm ──────────────────────────────────────────────────────────────

describe('getShortTerm', () => {
  it('用默认 limit=12 查询，且 DESC 结果被翻转成 ASC（最旧→最新）', async () => {
    // DB 按 created_at DESC 返回（最新在前）
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { direction: 'in', content: '第三条', created_at: '2026-06-04T00:03:00Z' },
        { direction: 'out', content: '第二条', created_at: '2026-06-04T00:02:00Z' },
        { direction: 'in', content: '第一条', created_at: '2026-06-04T00:01:00Z' },
      ],
    });

    const result = await getShortTerm('wxid_1');

    // SQL 是 DESC + LIMIT，limit 参数默认 12
    const [sql, params] = mockedQuery.mock.calls[0];
    expect(String(sql)).toMatch(/ORDER BY created_at DESC/);
    expect(String(sql)).toMatch(/LIMIT \$2/);
    expect(params).toEqual(['wxid_1', 12]);

    // 最终按 ASC：最旧在前
    expect(result.map((m) => m.content)).toEqual(['第一条', '第二条', '第三条']);
  });

  it('传入 limit 覆盖默认值', async () => {
    await getShortTerm('wxid_1', 5);
    expect(mockedQuery.mock.calls[0][1]).toEqual(['wxid_1', 5]);
  });

  it('env WECHAT_SHORT_TERM_LIMIT 覆盖默认', async () => {
    process.env.WECHAT_SHORT_TERM_LIMIT = '3';
    await getShortTerm('wxid_1');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['wxid_1', 3]);
  });

  it('Date 类型 created_at 被转成 ISO 字符串', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { direction: 'in', content: 'x', created_at: new Date('2026-06-04T00:01:00Z') },
      ],
    });
    const result = await getShortTerm('wxid_1');
    expect(result[0].created_at).toBe('2026-06-04T00:01:00.000Z');
  });

  it('DB 失败返回空数组不抛', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('boom'));
    await expect(getShortTerm('wxid_1')).resolves.toEqual([]);
  });
});

// ─── getContactMemory ──────────────────────────────────────────────────────────

describe('getContactMemory', () => {
  it('无记录返回 {summary:"", facts:[]}', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const m = await getContactMemory('wxid_new');
    expect(m).toEqual({ summary: '', facts: [] });
  });

  it('facts 已是数组（node-pg jsonb 自动解析）时正确返回', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          summary: '老客户，关系良好',
          facts: [
            { category: '禁忌', content: '对花生过敏' },
            { category: '称呼', content: '叫他于总' },
          ],
        },
      ],
    });
    const m = await getContactMemory('wxid_1');
    expect(m.summary).toBe('老客户，关系良好');
    expect(m.facts).toHaveLength(2);
    expect(m.facts[0]).toEqual({ category: '禁忌', content: '对花生过敏' });
  });

  it('facts 是 jsonb 字符串时解析成数组', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          summary: 's',
          facts: '[{"category":"偏好","content":"喜欢晚上聊"}]',
        },
      ],
    });
    const m = await getContactMemory('wxid_1');
    expect(m.facts).toEqual([{ category: '偏好', content: '喜欢晚上聊' }]);
  });

  it('facts 非法（缺字段/非数组）时过滤为空', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ summary: 's', facts: [{ category: '偏好' }, 'garbage', null] }],
    });
    const m = await getContactMemory('wxid_1');
    expect(m.facts).toEqual([]);
  });

  it('DB 失败降级为空记忆不抛', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('db err'));
    await expect(getContactMemory('wxid_1')).resolves.toEqual({
      summary: '',
      facts: [],
    });
  });
});

// ─── consolidate ───────────────────────────────────────────────────────────────

describe('consolidate', () => {
  /** 造 n 条未固化消息 */
  function pendingRows(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      sender_name: '于瑾',
      direction: i % 2 === 0 ? 'in' : 'out',
      content: `msg-${i + 1}`,
      created_at: `2026-06-04T00:0${i}:00Z`,
    }));
  }

  it('未固化消息数未达阈值且非 force → 不调 LLM、不写库', async () => {
    process.env.WECHAT_CONSOLIDATE_THRESHOLD = '8';
    // 第 1 个 query = 读未固化消息（只有 3 条 < 8）
    mockedQuery.mockResolvedValueOnce({ rows: pendingRows(3) });

    await consolidate('wxid_1');

    expect(mockedLLM).not.toHaveBeenCalled();
    // 只发生了 1 次 query（读未固化），没有 upsert / update
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('没有未固化消息 → 直接返回（force 也不触发 LLM）', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    await consolidate('wxid_1', { force: true });
    expect(mockedLLM).not.toHaveBeenCalled();
  });

  it('force=true 即使消息少也触发：调 LLM + upsert memory + 标记 consolidated', async () => {
    mockedQuery
      // 1) 读未固化消息（2 条）
      .mockResolvedValueOnce({ rows: pendingRows(2) })
      // 2) getContactMemory 读现有（无记录）
      .mockResolvedValueOnce({ rows: [] })
      // 3) upsert wechat_contact_memory
      .mockResolvedValueOnce({ rows: [] })
      // 4) UPDATE 标记 consolidated
      .mockResolvedValueOnce({ rows: [] });

    mockedLLM.mockResolvedValueOnce({
      content: '{"summary":"新摘要","facts":[{"category":"禁忌","content":"对花生过敏"}]}',
    });

    await consolidate('wxid_1', { force: true });

    expect(mockedLLM).toHaveBeenCalledTimes(1);
    // purpose 正确
    expect(mockedLLM.mock.calls[0][0].purpose).toBe('wechat_consolidate');

    // 找到 upsert 调用
    const upsert = mockedQuery.mock.calls.find((c) =>
      /INSERT INTO zenithjoy\.wechat_contact_memory/.test(String(c[0])),
    );
    expect(upsert).toBeTruthy();
    const upsertParams = upsert![1];
    expect(upsertParams[0]).toBe('wxid_1'); // contact_key
    expect(upsertParams[2]).toBe('新摘要'); // summary
    const factsJson = JSON.parse(upsertParams[3]);
    expect(factsJson).toEqual([{ category: '禁忌', content: '对花生过敏' }]);

    // 标记 consolidated 的 UPDATE 存在
    const markUpdate = mockedQuery.mock.calls.find((c) =>
      /UPDATE zenithjoy\.wechat_messages\s+SET consolidated = TRUE/.test(String(c[0])),
    );
    expect(markUpdate).toBeTruthy();
    expect(markUpdate![1][0]).toBe('wxid_1');
    expect(markUpdate![1][1]).toEqual([1, 2]); // ids
  });

  it('facts 去重合并：新 facts 与旧 facts 按 (category+content) 去重', async () => {
    mockedQuery
      // 1) 未固化消息
      .mockResolvedValueOnce({ rows: pendingRows(2) })
      // 2) getContactMemory：已有一条 fact
      .mockResolvedValueOnce({
        rows: [
          {
            summary: '旧摘要',
            facts: [{ category: '禁忌', content: '对花生过敏' }],
          },
        ],
      })
      // 3) upsert
      .mockResolvedValueOnce({ rows: [] })
      // 4) update
      .mockResolvedValueOnce({ rows: [] });

    // LLM 返回一条重复 + 一条新的
    mockedLLM.mockResolvedValueOnce({
      content:
        '{"summary":"新摘要","facts":[{"category":"禁忌","content":"对花生过敏"},{"category":"称呼","content":"叫他于总"}]}',
    });

    await consolidate('wxid_1', { force: true });

    const upsert = mockedQuery.mock.calls.find((c) =>
      /INSERT INTO zenithjoy\.wechat_contact_memory/.test(String(c[0])),
    );
    const facts = JSON.parse(upsert![1][3]);
    // 去重后只剩 2 条（花生过敏不重复）
    expect(facts).toEqual([
      { category: '禁忌', content: '对花生过敏' },
      { category: '称呼', content: '叫他于总' },
    ]);
  });

  it('LLM 返回非法 JSON → 静默跳过，不 upsert、不标记', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: pendingRows(2) }) // 未固化消息
      .mockResolvedValueOnce({ rows: [] }); // getContactMemory

    mockedLLM.mockResolvedValueOnce({ content: '这不是 JSON，只是模型瞎说' });

    await consolidate('wxid_1', { force: true });

    // 没有任何 INSERT/UPDATE memory 发生
    const wrote = mockedQuery.mock.calls.some(
      (c) =>
        /INSERT INTO zenithjoy\.wechat_contact_memory/.test(String(c[0])) ||
        /UPDATE zenithjoy\.wechat_messages/.test(String(c[0])),
    );
    expect(wrote).toBe(false);
  });

  it('LLM 输出带 ```json 围栏也能解析', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: pendingRows(2) })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    mockedLLM.mockResolvedValueOnce({
      content: '```json\n{"summary":"围栏摘要","facts":[]}\n```',
    });

    await consolidate('wxid_1', { force: true });

    const upsert = mockedQuery.mock.calls.find((c) =>
      /INSERT INTO zenithjoy\.wechat_contact_memory/.test(String(c[0])),
    );
    expect(upsert![1][2]).toBe('围栏摘要');
  });

  it('LLM 调用抛错 → 静默跳过不抛', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: pendingRows(10) })
      .mockResolvedValueOnce({ rows: [] });
    mockedLLM.mockRejectedValueOnce(new Error('openrouter 5xx'));

    await expect(consolidate('wxid_1')).resolves.toBeUndefined();
    const wrote = mockedQuery.mock.calls.some((c) =>
      /INSERT INTO zenithjoy\.wechat_contact_memory/.test(String(c[0])),
    );
    expect(wrote).toBe(false);
  });
});
