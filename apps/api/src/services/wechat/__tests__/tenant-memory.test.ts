/* eslint-disable @typescript-eslint/no-explicit-any -- 测试注入 mock */
/**
 * 同目录单测（CI lint-test-pairing 配对）— Line04 三层对话记忆服务契约。
 *
 * 端到端真链路另在 apps/api/tests/integration/p4-line04-cs-memory/ 覆盖；
 * 本文件用 mock pool + mock openrouter 钉死服务级隔离/装配/降级契约：
 *  - 缺 tenant_id（写/取/收尾）→ 抛 MISSING_TENANT，绝不回退全量
 *  - getReplyContext 返回 {longterm, mid, short} 三层 + assembled，每条查询都带 tenant_id
 *  - 当天无短期消息 → daily_generated=false（不写空中期）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/connection', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../../../llm/openrouter', () => ({
  callOpenRouter: vi.fn(),
}));

import pool from '../../../db/connection';
import {
  appendTenantMessage,
  getReplyContext,
  runDailyConsolidation,
  MissingTenantError,
} from '../tenant-memory';

const mockedQuery = vi.mocked((pool as any).query);

beforeEach(() => {
  vi.clearAllMocks();
  mockedQuery.mockResolvedValue({ rows: [] });
});

describe('appendTenantMessage', () => {
  it('缺 tenant_id → 抛 MISSING_TENANT，不写库', async () => {
    await expect(
      appendTenantMessage({ tenantId: '', contact: 'c', role: 'in', text: 'hi' } as any),
    ).rejects.toThrow(/MISSING_TENANT/);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('正常写入：INSERT 进 cs_memory_messages 且参数含 tenant_id，返回 message_id', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    const r = await appendTenantMessage({
      tenantId: 'tenantA', contact: 'wxid_c', role: 'in', text: '你好',
    });
    const [sql, params] = mockedQuery.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO zenithjoy\.cs_memory_messages/);
    expect(params).toContain('tenantA');
    expect(r.message_id).toBe(42);
  });

  // ── Bug7 回归（1.0.108）：技术指令不写入记忆，防AI人设污染 ─────────────────
  it.each([
    ['$ sudo apt-get install curl', 'shell 命令（$前缀）'],
    ['```\ncurl https://example.com\n```', 'code block'],
    ['curl https://api.example.com/data', 'curl 命令'],
    ['sudo npm install -g pnpm', 'sudo 命令'],
    ['pip install requests', 'pip install'],
    ['npm run build', 'npm run'],
    ['python3 -c "import sys; print(sys.version)"', 'python3 -c'],
    ['{"key": "value", "nested": true}', 'JSON 对象'],
  ])('Bug7：技术指令 "%s" 不写入 cs_memory_messages（%s）', async (text) => {
    const r = await appendTenantMessage({
      tenantId: 'tenantA', contact: 'c', role: 'in', text,
    });
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(r.message_id).toBe(0);
  });

  it('Bug7：普通客户消息不受过滤影响（正常写库）', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 99 }] });
    const r = await appendTenantMessage({
      tenantId: 'tenantA', contact: 'c', role: 'in', text: '你好，我想咨询一下价格',
    });
    expect(mockedQuery).toHaveBeenCalled();
    expect(r.message_id).toBe(99);
  });

  it('Bug7：out 角色（AI 回复）不受技术指令过滤（即使含 curl 也写库）', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 101 }] });
    const r = await appendTenantMessage({
      tenantId: 'tenantA', contact: 'c', role: 'out', text: 'curl https://example.com',
    });
    expect(mockedQuery).toHaveBeenCalled();
    expect(r.message_id).toBe(101);
  });
});

describe('getReplyContext', () => {
  it('缺 tenant_id → 抛 MISSING_TENANT，不查库（不串租户）', async () => {
    await expect(
      getReplyContext({ tenantId: '', contact: 'c' } as any),
    ).rejects.toThrow(MissingTenantError);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('返回 longterm/mid/short 三层 + assembled；空记忆不报错；每条查询带 tenant_id', async () => {
    const ctx = await getReplyContext({ tenantId: 'tenantA', contact: 'wxid_c' });
    expect(ctx.context).toHaveProperty('longterm');
    expect(ctx.context).toHaveProperty('mid');
    expect(Array.isArray(ctx.context.short)).toBe(true);
    expect(typeof ctx.assembled).toBe('string');
    for (const call of mockedQuery.mock.calls) {
      expect(call[1]).toContain('tenantA');
    }
  });
});

describe('runDailyConsolidation', () => {
  it('缺 tenant_id → 抛 MISSING_TENANT', async () => {
    await expect(
      runDailyConsolidation({ tenantId: '', contact: 'c' } as any),
    ).rejects.toThrow(/MISSING_TENANT/);
  });

  it('当天无短期消息 → daily_generated=false，不写空中期', async () => {
    mockedQuery.mockResolvedValue({ rows: [] });
    const r = await runDailyConsolidation({ tenantId: 'tenantA', contact: 'wxid_c' });
    expect(r.daily_generated).toBe(false);
    expect(r.folded).toBe(false);
  });
});
