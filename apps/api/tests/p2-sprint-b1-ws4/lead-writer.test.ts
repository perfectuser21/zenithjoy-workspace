/**
 * WS4 — lead-writer.ts 调 multitenant Bitable writeRecord 写飞书 Lead 表 (CI 实跑落点)
 *
 * Path: apps/api/tests/p2-sprint-b1-ws4/ (3 deep) → ../../src/services/...
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/feishu-bitable-multitenant', () => ({
  writeRecord: vi.fn(),
  ProvisionFailedError: class extends Error {},
  BitableNotFoundError: class extends Error {},
}));

import { writeDmOutreachStatus } from '../../src/services/lead-writer';
import { writeRecord } from '../../src/services/feishu-bitable-multitenant';

const tenantId = '11111111-2222-3333-4444-555555555555';
const tableIdLeads = 'tbl_leads_xxx';

beforeEach(() => {
  (writeRecord as any).mockReset();
});

// writeLeadsFromComments（原「5 条评论 → 5 次 writeRecord 写 Lead 表」）测试已删除——
// 该函数是死代码，生产里没人调用（决策19e6480c，2026-07-14）。

describe('Path 2 抖音私信主动触达 — writeDmOutreachStatus [BEHAVIOR]', () => {
  const dmProfile = 'https://www.douyin.com/user/MS4wDM';

  it('sent → 触达状态=已私信 + 触达小号/触达时间非空 + 失败原因空', async () => {
    (writeRecord as any).mockResolvedValue({ record_id: 'rec_dm' });
    const r = await writeDmOutreachStatus({
      tenant_id: tenantId,
      table_id_leads: tableIdLeads,
      profile_url: dmProfile,
      account_label: '装修小号1',
      dm_status: 'sent',
    });
    expect(r.lead_write_status).toBe('success');
    const fields = (writeRecord as any).mock.calls[0][2];
    expect(fields['触达状态']).toBe('已私信');
    expect(fields['触达主页 URL']).toBe(dmProfile);
    expect((fields['触达小号'] as string).length).toBeGreaterThan(0);
    expect((fields['触达时间'] as string).length).toBeGreaterThan(0);
    expect(fields['失败原因']).toBe('');
  });

  it('limited → 触达状态=未送达-仅互关（禁止假 sent）', async () => {
    (writeRecord as any).mockResolvedValue({ record_id: 'rec_dm' });
    await writeDmOutreachStatus({
      tenant_id: tenantId,
      table_id_leads: tableIdLeads,
      profile_url: dmProfile,
      account_label: '装修小号1',
      dm_status: 'limited',
    });
    const fields = (writeRecord as any).mock.calls[0][2];
    expect(fields['触达状态']).toBe('未送达-仅互关');
    expect(fields['触达状态']).not.toBe('已私信');
  });

  it('failed → 触达状态=失败 + 失败原因=error_code', async () => {
    (writeRecord as any).mockResolvedValue({ record_id: 'rec_dm' });
    await writeDmOutreachStatus({
      tenant_id: tenantId,
      table_id_leads: tableIdLeads,
      profile_url: dmProfile,
      account_label: '装修小号1',
      dm_status: 'failed',
      error_code: 'SESSION_EXPIRED',
    });
    const fields = (writeRecord as any).mock.calls[0][2];
    expect(fields['触达状态']).toBe('失败');
    expect(fields['失败原因']).toBe('SESSION_EXPIRED');
  });

  it('writeRecord 抛错 → lead_write_status=failed', async () => {
    (writeRecord as any).mockRejectedValue(new Error('FEISHU_DOWN'));
    const r = await writeDmOutreachStatus({
      tenant_id: tenantId,
      table_id_leads: tableIdLeads,
      profile_url: dmProfile,
      account_label: '装修小号1',
      dm_status: 'sent',
    });
    expect(r.lead_write_status).toBe('failed');
    expect(r.error).toMatch(/FEISHU/);
  });
});
