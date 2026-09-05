/**
 * 落库层单测。用假 pool 打桩，只验「写了什么」，不连真库——真链路由 smoke 验。
 * 这层的价值是：直传和老端点共用它，两个入口的落库行为不可能漂移。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../../db/connection', () => ({ default: { query } }));

const BASE = {
  tenantId: 'tenant-a',
  licenseId: 'lic-1',
  contentType: 'image' as const,
  title: '标题',
  body: null,
  platforms: ['douyin'],
};

function itemsOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    materialId: `m${i}`,
    storageKey: `tenant-a/m${i}/f${i}.jpg`,
    fileName: `f${i}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 100 + i,
    takenAt: undefined,
    dedupeKey: `dk${i}`,
  }));
}

describe('persistMaterials', () => {
  beforeEach(() => { query.mockReset(); });

  it('每个素材插一条 materials，并写入 uploaded_by_license_id', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO zenithjoy.materials')) return { rows: [{ id: 'new-id' }] };
      if (sql.includes('INSERT INTO zenithjoy.contents')) return { rows: [{ id: 'content-1' }] };
      return { rows: [] };
    });
    const { persistMaterials } = await import('../material-persist');
    const out = await persistMaterials({ ...BASE, items: itemsOf(2) });

    const matInserts = query.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT INTO zenithjoy.materials'));
    expect(matInserts).toHaveLength(2);
    // 参数顺序：id, tenant_id, storage_key, file_name, mime_type, size_bytes,
    //           dedupe_key, taken_at, uploaded_by_license_id
    expect(matInserts[0][1][8]).toBe('lic-1');
    expect(out.contentId).toBe('content-1');
    expect(out.materials.every((m) => m.deduped === false)).toBe(true);
  });

  it('命中去重时拿回已有 id 并标 deduped，不再插第二条', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO zenithjoy.materials')) return { rows: [] };
      if (sql.includes('SELECT id FROM zenithjoy.materials')) return { rows: [{ id: 'existing' }] };
      if (sql.includes('INSERT INTO zenithjoy.contents')) return { rows: [{ id: 'content-1' }] };
      return { rows: [] };
    });
    const { persistMaterials } = await import('../material-persist');
    const out = await persistMaterials({ ...BASE, items: itemsOf(1) });
    expect(out.materials[0]).toMatchObject({ id: 'existing', deduped: true });
  });

  it('建一条 contents 并按顺序挂满关联', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO zenithjoy.materials')) return { rows: [{ id: 'x' }] };
      if (sql.includes('INSERT INTO zenithjoy.contents')) return { rows: [{ id: 'c1' }] };
      return { rows: [] };
    });
    const { persistMaterials } = await import('../material-persist');
    await persistMaterials({ ...BASE, items: itemsOf(3) });
    const links = query.mock.calls.filter((c) => String(c[0]).includes('content_materials'));
    expect(links).toHaveLength(3);
    expect(links.map((l) => l[1][2])).toEqual([0, 1, 2]);
  });

  it('去重回查必须带 tenant_id —— 绝不能跨租户拿回别人的素材 id', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO zenithjoy.materials')) return { rows: [] };
      if (sql.includes('SELECT id FROM zenithjoy.materials')) return { rows: [{ id: 'existing' }] };
      if (sql.includes('INSERT INTO zenithjoy.contents')) return { rows: [{ id: 'c1' }] };
      return { rows: [] };
    });
    const { persistMaterials } = await import('../material-persist');
    await persistMaterials({ ...BASE, items: itemsOf(1) });
    const sel = query.mock.calls.find((c) => String(c[0]).includes('SELECT id FROM zenithjoy.materials'));
    expect(String(sel[0])).toContain('tenant_id');
    expect(sel[1]).toContain('tenant-a');
  });

  it('materials 的 INSERT 不再写 content_hash（内容哈希已废弃）', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO zenithjoy.materials')) return { rows: [{ id: 'x' }] };
      if (sql.includes('INSERT INTO zenithjoy.contents')) return { rows: [{ id: 'c1' }] };
      return { rows: [] };
    });
    const { persistMaterials } = await import('../material-persist');
    await persistMaterials({ ...BASE, items: itemsOf(1) });
    const ins = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO zenithjoy.materials'));
    expect(String(ins[0])).not.toContain('content_hash');
  });
});
