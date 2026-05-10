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

import { writeLeadsFromComments } from '../../src/services/lead-writer';
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
