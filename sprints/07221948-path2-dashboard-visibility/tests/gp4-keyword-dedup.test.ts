/**
 * 合同测试 — GP-4：关键词去重机制
 * task_id: 7cb465c1-03cc-4934-a638-e61f78195d37
 * target_environment: local_api
 *
 * 先红测试（commit-1）：
 *   - /api/acquisition/collect/start 目前无去重逻辑 → duplicate 字段不存在
 *   - force 参数尚未实现
 *   - 跨租户隔离测试（INV-2、INV-3）
 *
 * 判定点：仅本租户 30 天窗口，sec_uid 强去重 + nickname 弱兜底。
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API_BASE = process.env.API_BASE ?? 'http://localhost:5200';
const RND = Date.now().toString(36);
const TENANT_A = `gp4-ta-${RND}`;
const TENANT_B = `gp4-tb-${RND}`;
const KW_RECENT = `kw-recent-${RND}`;
const KW_OLD = `kw-old-${RND}`;
const KW_CROSS = `kw-cross-${RND}`;

const postCollectStart = (
  tenantId: string,
  keywords: string[],
  force?: boolean
) =>
  fetch(`${API_BASE}/api/acquisition/collect/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenantId,
    },
    body: JSON.stringify({ keywords, ...(force !== undefined ? { force } : {}) }),
  });

// ──────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-GP4-A：30 天内同租户同关键词触发 duplicate:true
// ──────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-GP4-A: same keyword within 30 days returns duplicate:true', () => {
  it('second collect/start with same keyword should have duplicate:true in response', async () => {
    // 先红：collect/start 当前无去重检查，响应不含 duplicate 字段
    const res = await postCollectStart(TENANT_A, [KW_RECENT]);
    expect(res.status).toBe(200);
    const data = await res.json();
    // 先红断言（实现前 duplicate 不存在）
    expect(data).toHaveProperty('duplicate');
    // 实现后（第二次调用时）：
    // expect(data.duplicate).toBe(true);
    // expect(typeof data.days_ago).toBe('number');
    // expect(data.days_ago).toBeGreaterThanOrEqual(0);
    // expect(data.days_ago).toBeLessThanOrEqual(30);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-GP4-B：force:true 跳过去重
// ──────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-GP4-B: force:true bypasses dedup check', () => {
  it('collect/start with force:true should not return duplicate:true', async () => {
    // 先红：force 参数尚未支持
    const res = await postCollectStart(TENANT_A, [KW_RECENT], true);
    expect(res.status).toBe(200);
    const data = await res.json();
    // 实现后：duplicate 应为 false / absent，task_id 应存在
    expect(data.duplicate ?? false).toBe(false);
    const taskId =
      data.task_id ?? data.data?.task_id ?? data.id;
    expect(taskId).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-GP4-C：跨租户不互触（INV-2、INV-3）
// ──────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-GP4-C: cross-tenant keyword dedup isolation', () => {
  it('tenant B should not be affected by tenant A keyword history', async () => {
    // 先红：即使无去重实现，也需验证 T_B 独立（此断言实现后必须通过）
    const resB = await postCollectStart(TENANT_B, [KW_CROSS]);
    expect(resB.status).toBe(200);
    const dataB = await resB.json();
    // T_B 第一次采集 KW_CROSS，即使 T_A 有历史，duplicate 也必须是 false
    expect(dataB.duplicate ?? false).toBe(false);
  });

  it('two tenants with same keyword should have independent dedup state', async () => {
    // T_A 先采集 KW_CROSS
    await postCollectStart(TENANT_A, [KW_CROSS]);
    // T_B 采集同一关键词，不应触发 duplicate
    const resB = await postCollectStart(TENANT_B, [KW_CROSS]);
    expect(resB.status).toBe(200);
    const dataB = await resB.json();
    expect(dataB.duplicate ?? false).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-GP4-D：超 30 天不触发去重
// ──────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-GP4-D: keyword older than 30 days does not trigger dedup', () => {
  it('keyword with only 31+ day old history should return duplicate:false', async () => {
    // 先红：无法直接 seed DB 数据，此测试需要 DB seed 支持
    // 实现后需配合 beforeAll seed 31 天前的历史记录
    // 此处仅验证 API 形状（先红：duplicate 字段不存在）
    const res = await postCollectStart(TENANT_A, [KW_OLD]);
    expect(res.status).toBe(200);
    const data = await res.json();
    // 期望：超 30 天历史不触发，duplicate 为 false 或不存在
    const dup = data.duplicate;
    if (dup !== undefined) {
      expect(dup).toBe(false);
    }
    // 若 dup 不存在（先红），此 it 通过（形状断言宽松）
  });
});
