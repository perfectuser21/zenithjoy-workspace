/* eslint-disable @typescript-eslint/no-explicit-any -- 测试注入 mock */
/**
 * TDD Red — Line04 三层对话记忆服务契约（unit，mock pool + openrouter）。
 * 现在 `apps/api/src/services/wechat/tenant-memory` 尚不存在 → import 失败 → 全红。
 * 端到端真链路在 apps/api/tests/integration/p4-line04-cs-memory/ 另有覆盖。
 *
 * 钉死契约：
 *  - 缺 tenant_id（写/取/收尾）→ 抛 MISSING_TENANT，绝不回退全量
 *  - getReplyContext 返回 {longterm, mid, short} 三层 + assembled
 *  - 所有 DB 查询都带 tenant_id 作为参数（隔离按 tenant_id × contact）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../apps/api/src/db/connection', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../../../apps/api/src/llm/openrouter', () => ({
  callOpenRouter: vi.fn(),
}));

import pool from '../../../apps/api/src/db/connection';
import {
  appendTenantMessage,
  getReplyContext,
  runDailyConsolidation,
} from '../../../apps/api/src/services/wechat/tenant-memory';

const mockedQuery = vi.mocked((pool as any).query);

beforeEach(() => {
  vi.clearAllMocks();
  mockedQuery.mockResolvedValue({ rows: [] });
});

describe('appendTenantMessage [BEHAVIOR]', () => {
  it('缺 tenant_id → 抛 MISSING_TENANT，不写库', async () => {
    await expect(
      appendTenantMessage({ tenantId: '', contact: 'c', role: 'in', text: 'hi' } as any),
    ).rejects.toThrow(/MISSING_TENANT/);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('正常写入：INSERT 进 cs_memory_messages 且参数含 tenant_id', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    const r = await appendTenantMessage({
      tenantId: 'tenantA', contact: 'wxid_c', role: 'in', text: '你好',
    } as any);
    const [sql, params] = mockedQuery.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO zenithjoy\.cs_memory_messages/);
    expect(params).toContain('tenantA');
    expect(r.message_id).toBe(42);
  });
});

describe('getReplyContext [BEHAVIOR]', () => {
  it('缺 tenant_id → 抛 MISSING_TENANT，不查库（不串租户）', async () => {
    await expect(
      getReplyContext({ tenantId: '', contact: 'c' } as any),
    ).rejects.toThrow(/MISSING_TENANT/);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('返回 longterm/mid/short 三层 + assembled；空记忆不报错', async () => {
    const ctx = await getReplyContext({ tenantId: 'tenantA', contact: 'wxid_c' } as any);
    expect(ctx.context).toHaveProperty('longterm');
    expect(ctx.context).toHaveProperty('mid');
    expect(Array.isArray(ctx.context.short)).toBe(true);
    expect(typeof ctx.assembled).toBe('string');
    // 每条 DB 查询都必须带 tenant_id 参数（隔离）
    for (const call of mockedQuery.mock.calls) {
      expect(call[1]).toContain('tenantA');
    }
  });
});

describe('runDailyConsolidation [BEHAVIOR]', () => {
  it('缺 tenant_id → 抛 MISSING_TENANT', async () => {
    await expect(
      runDailyConsolidation({ tenantId: '', contact: 'c' } as any),
    ).rejects.toThrow(/MISSING_TENANT/);
  });

  it('当天无短期消息 → daily_generated=false，不写空中期', async () => {
    mockedQuery.mockResolvedValue({ rows: [] });
    const r = await runDailyConsolidation({ tenantId: 'tenantA', contact: 'wxid_c' } as any);
    expect(r.daily_generated).toBe(false);
  });
});
