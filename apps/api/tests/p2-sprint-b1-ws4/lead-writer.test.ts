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

import { writeLeadsFromComments, writeDmOutreachStatus } from '../../src/services/lead-writer';
import { writeRecord } from '../../src/services/feishu-bitable-multitenant';

const tenantId = '11111111-2222-3333-4444-555555555555';
const tableIdLeads = 'tbl_leads_xxx';
const videoUrl = 'https://www.douyin.com/video/7000000000000000001';

const sampleComments = Array.from({ length: 5 }, (_, i) => ({
  commenter_id: `@u_${i}`,
  text: `求联系 ${i}`,
  publish_time: '2026-05-10T10:00:00Z',
}));

beforeEach(() => {
  (writeRecord as any).mockReset();
});

describe('Workstream 4 — writeLeadsFromComments [BEHAVIOR]', () => {
  it('5 条评论 → 5 次 writeRecord 调用', async () => {
    (writeRecord as any).mockResolvedValue({ record_id: 'rec_xxx' });
    const result = await writeLeadsFromComments({
      tenant_id: tenantId,
      table_id_leads: tableIdLeads,
      video_url: videoUrl,
      comments: sampleComments,
    });
    expect((writeRecord as any).mock.calls.length).toBe(5);
    expect(result.lead_write_status).toBe('success');
    expect(result.written_count).toBe(5);
  });

  it('每条 record 含 5 个飞书字段（评论者抖音 ID / 评论内容 / 来源视频 URL / 抓取时间 / 状态）', async () => {
    (writeRecord as any).mockResolvedValue({ record_id: 'rec_xxx' });
    await writeLeadsFromComments({
      tenant_id: tenantId,
      table_id_leads: tableIdLeads,
      video_url: videoUrl,
      comments: sampleComments,
    });
    const firstCall = (writeRecord as any).mock.calls[0];
    const fields = firstCall[2];
    expect(fields).toHaveProperty('评论者抖音 ID');
    expect(fields).toHaveProperty('评论内容');
    expect(fields).toHaveProperty('来源视频 URL');
    expect(fields).toHaveProperty('抓取时间');
    expect(fields).toHaveProperty('状态', '已抓取');
  });

  it('评论数 0 → 早 return + 不调 writeRecord', async () => {
    const result = await writeLeadsFromComments({
      tenant_id: tenantId,
      table_id_leads: tableIdLeads,
      video_url: videoUrl,
      comments: [],
    });
    expect((writeRecord as any).mock.calls.length).toBe(0);
    expect(result.written_count).toBe(0);
    expect(result.lead_write_status).toBe('success'); // 0 条也算成功
  });

  it('writeRecord 第一次抛错第二次成功 → 完成 + 返 success', async () => {
    let callCount = 0;
    (writeRecord as any).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('FEISHU_TIMEOUT');
      return { record_id: 'rec_retry_ok' };
    });
    const result = await writeLeadsFromComments({
      tenant_id: tenantId,
      table_id_leads: tableIdLeads,
      video_url: videoUrl,
      comments: [sampleComments[0]],
    });
    expect(result.lead_write_status).toBe('success');
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('writeRecord 重试 2 次后仍失败 → 返 lead_write_status=failed', async () => {
    (writeRecord as any).mockRejectedValue(new Error('FEISHU_DOWN'));
    const result = await writeLeadsFromComments({
      tenant_id: tenantId,
      table_id_leads: tableIdLeads,
      video_url: videoUrl,
      comments: [sampleComments[0]],
    });
    expect(result.lead_write_status).toBe('failed');
    expect(result.error).toMatch(/FEISHU/);
  });
});

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
