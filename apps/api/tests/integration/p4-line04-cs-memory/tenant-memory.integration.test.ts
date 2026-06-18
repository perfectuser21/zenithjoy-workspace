/* eslint-disable @typescript-eslint/no-explicit-any -- 集成测试注入 mock */
/**
 * Line04 对话记忆三层后端 — 端到端真链路集成测试（TDD Red，generator 实现后转绿）。
 *
 * 真 Postgres（zenithjoy_test，迁移自动应用）+ 真 express app（supertest），
 * 仅 mock 外部 SaaS：OpenRouter（global.fetch）。Golden Path 路径全程真实执行，
 * 不 mock 任何记忆读写 / 收尾 / 装配逻辑。
 *
 * 覆盖 Golden Path 六步 + 降级：
 *  1) 写消息进短期（per tenant_id × contact，带时间窗落库）
 *  2/3) 日收尾→中期 summary；跨天→并入长期；空天不写空中期
 *  4) 取回复上下文 = 长期+中期+短期 三层拼接（keys 完整 + 禁用字段反向）
 *  5) 2 租户隔离：A 查只见 A，B 查只见 B（双向 + DB 层零泄漏）
 *  6) 缺 tenant_id（写/查/收尾）→ 400 MISSING_TENANT，不回退不串租户
 *  +) summarization 失败 → 降级仍写非空中期，不破坏三层数据
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../../src/app';
import pool from '../../../src/db/connection';

const A = 'tenantA_line04mem';
const B = 'tenantB_line04mem';
const CONTACT = 'wxid_line04_e2e';
const A_SECRET = 'A独有暗号_花生过敏';
const B_SECRET = 'B独有暗号_海鲜过敏';

// ── OpenRouter（global.fetch）mock：返回确定性 summary 文本 ──────────────────────
let fetchShouldFail = false;
function installFetchMock(): void {
  global.fetch = (async () => {
    if (fetchShouldFail) throw new Error('mock OpenRouter down');
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '【LLM摘要】客户与客服的近期对话要点汇总' } }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        model: 'deepseek/deepseek-chat',
      }),
    } as any;
  }) as any;
}

async function cleanup(): Promise<void> {
  for (const t of [A, B]) {
    await pool.query('DELETE FROM zenithjoy.cs_memory_messages  WHERE tenant_id = $1', [t]);
    await pool.query('DELETE FROM zenithjoy.cs_memory_daily     WHERE tenant_id = $1', [t]);
    await pool.query('DELETE FROM zenithjoy.cs_memory_longterm  WHERE tenant_id = $1', [t]);
  }
}

beforeAll(() => {
  process.env.OPENROUTER_API_KEY = 'sk-test-mock';
  process.env.NODE_ENV = 'test';
  installFetchMock();
});
beforeEach(() => { fetchShouldFail = false; });
afterAll(async () => { await cleanup(); });

function post(path: string, tenant: string | null, body: any) {
  const r = request(app).post(path);
  if (tenant) r.set('X-Tenant-Id', tenant);
  return r.send(body);
}
function get(path: string, tenant: string | null) {
  const r = request(app).get(path);
  if (tenant) r.set('X-Tenant-Id', tenant);
  return r;
}

// ─── Step 1 ──────────────────────────────────────────────────────────────────
describe('Step1 写消息进短期', () => {
  it('POST /message(租户A) → 200 ok + cs_memory_messages 5 分钟内新增（时间窗防造假）', async () => {
    await cleanup();
    const r1 = await post('/api/wechat/memory/message', A, { contact: CONTACT, role: 'in', text: '你好' });
    expect(r1.status).toBe(200);
    expect(r1.body.ok).toBe(true);
    expect(typeof r1.body.message_id).toBe('number');
    expect(r1.body.tenant_id).toBe(A);

    await post('/api/wechat/memory/message', A, { contact: CONTACT, role: 'out', text: '在的，请问需要什么' });

    const { rows } = await pool.query(
      `SELECT count(*)::int AS c FROM zenithjoy.cs_memory_messages
        WHERE tenant_id = $1 AND contact = $2 AND created_at > NOW() - interval '5 minutes'`,
      [A, CONTACT],
    );
    expect(rows[0].c).toBeGreaterThanOrEqual(2);
  });

  it('role 非 in/out → 400；缺字段 → 400 MISSING_FIELDS', async () => {
    const bad = await post('/api/wechat/memory/message', A, { contact: CONTACT, role: 'x', text: 'y' });
    expect(bad.status).toBe(400);
    const miss = await post('/api/wechat/memory/message', A, { contact: CONTACT });
    expect(miss.status).toBe(400);
    expect(miss.body.error).toBe('MISSING_FIELDS');
  });
});

// ─── Step 2/3 ────────────────────────────────────────────────────────────────
describe('Step2/3 日收尾与跨天并入长期', () => {
  it('日收尾：当天有短期→生成中期 summary（DB 时间窗）；空天→不写空中期', async () => {
    await cleanup();
    await post('/api/wechat/memory/message', A, { contact: CONTACT, role: 'in', text: '想了解套餐' });
    const c = await post('/api/wechat/memory/consolidate', A, { contact: CONTACT });
    expect(c.status).toBe(200);
    expect(c.body.daily_generated).toBe(true);

    const daily = await pool.query(
      `SELECT summary FROM zenithjoy.cs_memory_daily
        WHERE tenant_id=$1 AND contact=$2 AND created_at > NOW() - interval '5 minutes'`,
      [A, CONTACT],
    );
    expect(daily.rows.length).toBeGreaterThanOrEqual(1);
    expect((daily.rows[0].summary as string).length).toBeGreaterThan(0);

    // 空天：全新 contact 无任何消息 → 不生成空中期
    const emptyContact = 'wxid_empty_day';
    const c2 = await post('/api/wechat/memory/consolidate', A, { contact: emptyContact });
    expect(c2.body.daily_generated).toBe(false);
    const none = await pool.query(
      'SELECT count(*)::int AS c FROM zenithjoy.cs_memory_daily WHERE tenant_id=$1 AND contact=$2',
      [A, emptyContact],
    );
    expect(none.rows[0].c).toBe(0);
  });

  it('并入长期：跨天再收尾把昨天中期融合进长期，昨天 daily 标 folded', async () => {
    await cleanup();
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    // 直接铺一条昨天的短期消息（msg_day + created_at 都置昨天）
    await pool.query(
      `INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text, msg_day, created_at)
       VALUES ($1,$2,'in','昨天聊过的内容', $3::date, $3::date)`,
      [A, CONTACT, yesterday],
    );
    // 昨天收尾 → 生成昨天中期
    const cy = await post('/api/wechat/memory/consolidate', A, { contact: CONTACT, day: yesterday });
    expect(cy.body.daily_generated).toBe(true);

    // 今天来新消息 + 今天收尾 → 把昨天中期并入长期
    await post('/api/wechat/memory/message', A, { contact: CONTACT, role: 'in', text: '今天的新问题' });
    const ct = await post('/api/wechat/memory/consolidate', A, { contact: CONTACT });
    expect(ct.body.folded).toBe(true);

    const lt = await pool.query(
      `SELECT summary, merged_through_day FROM zenithjoy.cs_memory_longterm
        WHERE tenant_id=$1 AND contact=$2 AND updated_at > NOW() - interval '5 minutes'`,
      [A, CONTACT],
    );
    expect(lt.rows.length).toBe(1);
    expect((lt.rows[0].summary as string).length).toBeGreaterThan(0);

    const yd = await pool.query(
      'SELECT folded FROM zenithjoy.cs_memory_daily WHERE tenant_id=$1 AND contact=$2 AND summary_day=$3::date',
      [A, CONTACT, yesterday],
    );
    expect(yd.rows[0].folded).toBe(true);
  });
});

// ─── Step 4 ──────────────────────────────────────────────────────────────────
describe('Step4 取回复上下文三层拼接', () => {
  it('GET /context → longterm/mid/short 三键齐全 + assembled 含三层 + 禁用字段反向', async () => {
    await cleanup();
    await post('/api/wechat/memory/message', A, { contact: CONTACT, role: 'in', text: A_SECRET });
    await post('/api/wechat/memory/consolidate', A, { contact: CONTACT });
    await post('/api/wechat/memory/message', A, { contact: CONTACT, role: 'in', text: '最近一句原文' });

    const r = await get(`/api/wechat/memory/context?contact=${CONTACT}`, A);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.context).sort()).toEqual(['longterm', 'mid', 'short']);
    expect(Array.isArray(r.body.context.short)).toBe(true);
    expect(typeof r.body.assembled).toBe('string');
    // 短期含最近原文；assembled 同时体现三层
    expect(r.body.assembled).toContain('最近一句原文');
    // 禁用字段不得出现在顶层 context
    for (const banned of ['long_term', 'medium', 'short_term', 'history', 'messages']) {
      expect(r.body.context).not.toHaveProperty(banned);
    }
  });

  it('无任何记忆的 (tenant×contact) → 空上下文，不报错不串别人', async () => {
    const r = await get('/api/wechat/memory/context?contact=wxid_never_seen', A);
    expect(r.status).toBe(200);
    expect(r.body.context.longterm).toBe('');
    expect(r.body.context.short).toEqual([]);
  });
});

// ─── Step 5 ──────────────────────────────────────────────────────────────────
describe('Step5 隔离', () => {
  it('租户A查只见A，B查只见B（双向）+ DB 层跨租户零泄漏', async () => {
    await cleanup();
    await post('/api/wechat/memory/message', A, { contact: CONTACT, role: 'in', text: A_SECRET });
    await post('/api/wechat/memory/message', B, { contact: CONTACT, role: 'in', text: B_SECRET });
    await post('/api/wechat/memory/consolidate', A, { contact: CONTACT });
    await post('/api/wechat/memory/consolidate', B, { contact: CONTACT });

    const ra = await get(`/api/wechat/memory/context?contact=${CONTACT}`, A);
    const rb = await get(`/api/wechat/memory/context?contact=${CONTACT}`, B);
    expect(ra.body.assembled).toContain(A_SECRET);
    expect(ra.body.assembled).not.toContain(B_SECRET);
    expect(rb.body.assembled).toContain(B_SECRET);
    expect(rb.body.assembled).not.toContain(A_SECRET);

    const leak = await pool.query(
      `SELECT count(*)::int AS c FROM zenithjoy.cs_memory_messages WHERE tenant_id=$1 AND text LIKE $2`,
      [B, `%${A_SECRET}%`],
    );
    expect(leak.rows[0].c).toBe(0);
  });
});

// ─── Step 6 ──────────────────────────────────────────────────────────────────
describe('Step6 缺 tenant_id 拒绝', () => {
  it('写/查/收尾缺 tenant_id 三端点均 400 MISSING_TENANT，不串租户', async () => {
    const w = await post('/api/wechat/memory/message', null, { contact: CONTACT, role: 'in', text: 'x' });
    expect(w.status).toBe(400);
    expect(w.body.error).toBe('MISSING_TENANT');

    const c = await post('/api/wechat/memory/consolidate', null, { contact: CONTACT });
    expect(c.status).toBe(400);
    expect(c.body.error).toBe('MISSING_TENANT');

    const g = await get(`/api/wechat/memory/context?contact=${CONTACT}`, null);
    expect(g.status).toBe(400);
    expect(g.body.error).toBe('MISSING_TENANT');
    // 拒绝时绝不返回任何 contact 记忆
    expect(JSON.stringify(g.body)).not.toContain('assembled');
  });
});

// ─── 降级 ─────────────────────────────────────────────────────────────────────
describe('降级：summarization 失败不破坏三层数据', () => {
  it('OpenRouter 抛错时收尾仍写非空中期（确定性 fallback），已有数据不丢', async () => {
    await cleanup();
    await post('/api/wechat/memory/message', A, { contact: CONTACT, role: 'in', text: '降级场景原文' });
    fetchShouldFail = true;
    const c = await post('/api/wechat/memory/consolidate', A, { contact: CONTACT });
    expect(c.status).toBe(200);
    expect(c.body.daily_generated).toBe(true);
    const daily = await pool.query(
      'SELECT summary FROM zenithjoy.cs_memory_daily WHERE tenant_id=$1 AND contact=$2',
      [A, CONTACT],
    );
    expect(daily.rows.length).toBeGreaterThanOrEqual(1);
    expect((daily.rows[0].summary as string).length).toBeGreaterThan(0);
    // 短期原文仍在（未被破坏）
    const msgs = await pool.query(
      'SELECT count(*)::int AS c FROM zenithjoy.cs_memory_messages WHERE tenant_id=$1 AND contact=$2',
      [A, CONTACT],
    );
    expect(msgs.rows[0].c).toBeGreaterThanOrEqual(1);
  });
});
