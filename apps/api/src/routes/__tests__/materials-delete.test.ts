/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 删素材端点契约。
 *
 * 删是不可逆的，所以这里的每一条都比「能删掉」更重要：
 *
 * ① **租户隔离**：只能删自己的。别人的素材必须表现得像不存在（404），
 *    不能回 403——403 等于告诉对方「这个 id 是存在的」，白送一个探测接口。
 * ② **删了就是删了**：DB 行没了，COS 对象也要没。只删一半 = 要么留孤儿文件
 *    一直烧存储费，要么留一条指向空气的记录。
 * ③ **已发布的作品用到的素材不许删**：删掉会把已经发出去的帖子打断。
 *    拒绝时要说清是哪个作品挡着，否则用户不知道该怎么办。
 * ④ **先删存储再删库**：反过来的话，存储删失败就再也找不到这个 key 了
 *    （库里的记录已经没了），必然留下永久孤儿。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../services/walking-skeleton.service', () => ({ validateLicense: vi.fn() }));
vi.mock('../../db/connection', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));

import { validateLicense } from '../../services/walking-skeleton.service';
import pool from '../../db/connection';
import { InMemoryMaterialStorage } from '../../services/material-storage';
import { createMaterialsRouter } from '../materials';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN_A = 'ZJ-F-AAAA1111';
const MAT_ID = '11111111-1111-4111-8111-111111111111';
const KEY = `${TENANT_A}/${MAT_ID}/a.jpg`;

let storage: InMemoryMaterialStorage;

function makeApp() {
  storage = new InMemoryMaterialStorage();
  const app = express();
  app.use(express.json());
  app.use('/api/materials', createMaterialsRouter({ storage }));
  return app;
}

const licenseOk = (tenantId: string) => ({
  ok: true as const,
  license: { id: 'lic', license_key: TOKEN_A, tenant_id: tenantId, status: 'active', expires_at: '2099-01-01T00:00:00Z' },
});

/**
 * 假 DB。
 * @param found     SELECT 素材时返回的行（null = 查无此条 / 不是你的）
 * @param blockers  挡着不让删的非草稿作品
 */
function stubDb(
  found: { id: string; storage_key: string } | null,
  blockers: Array<{ id: string; title: string | null; status: string }> = [],
) {
  (pool.query as any).mockImplementation(async (sql: string) => {
    if (/DELETE\s+FROM\s+zenithjoy\.materials/i.test(sql)) return { rows: found ? [{ id: found.id }] : [] };
    if (/DELETE/i.test(sql)) return { rows: [] };
    if (/FROM\s+zenithjoy\.contents/i.test(sql)) return { rows: blockers };
    if (/FROM\s+zenithjoy\.materials/i.test(sql)) return { rows: found ? [found] : [] };
    return { rows: [] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (validateLicense as any).mockResolvedValue(licenseOk(TENANT_A));
});

describe('DELETE /api/materials/:id — 鉴权', () => {
  it('没有凭据 → 401，存储一个字节都不动', async () => {
    stubDb({ id: MAT_ID, storage_key: KEY });
    const app = makeApp();
    await storage.putObject({ key: KEY, filePath: __filename });

    const r = await request(app).delete(`/api/materials/${MAT_ID}`);

    expect(r.status).toBe(401);
    expect(storage.size()).toBe(1);
  });

  it('凭据无效 → 401', async () => {
    (validateLicense as any).mockResolvedValue({ ok: false, code: 'INVALID_LICENSE', message: 'x' });
    stubDb({ id: MAT_ID, storage_key: KEY });
    const app = makeApp();

    const r = await request(app).delete(`/api/materials/${MAT_ID}`).set('X-Upload-Token', TOKEN_A);
    expect(r.status).toBe(401);
  });
});

describe('DELETE /api/materials/:id — 租户隔离', () => {
  it('删别人的素材 → 404，绝不能是 403', async () => {
    // 403 等于确认「这个 id 存在」，白送一个探测别人素材 id 的接口。
    // SELECT 带 tenant_id，别人的素材查出来就是 0 行，和不存在无法区分——这正是要的。
    stubDb(null);
    const app = makeApp();

    const r = await request(app).delete(`/api/materials/${MAT_ID}`).set('X-Upload-Token', TOKEN_A);

    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });

  it('查素材的 SQL 必须带 tenant_id —— 少了它就是越权删', async () => {
    stubDb({ id: MAT_ID, storage_key: KEY });
    const app = makeApp();
    await request(app).delete(`/api/materials/${MAT_ID}`).set('X-Upload-Token', TOKEN_A);

    const selectCall = (pool.query as any).mock.calls
      .find((c: any[]) => /SELECT[\s\S]*FROM\s+zenithjoy\.materials/i.test(c[0]));
    expect(selectCall).toBeDefined();
    expect(selectCall[0]).toMatch(/tenant_id\s*=\s*\$/i);
    expect(selectCall[1]).toContain(TENANT_A);
  });
});

describe('DELETE /api/materials/:id — 删干净', () => {
  it('删成功 → COS 对象没了，DB 行也没了', async () => {
    stubDb({ id: MAT_ID, storage_key: KEY });
    const app = makeApp();
    await storage.putObject({ key: KEY, filePath: __filename });
    expect(storage.size()).toBe(1);

    const r = await request(app).delete(`/api/materials/${MAT_ID}`).set('X-Upload-Token', TOKEN_A);

    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(storage.size()).toBe(0);
    const del = (pool.query as any).mock.calls
      .find((c: any[]) => /DELETE\s+FROM\s+zenithjoy\.materials/i.test(c[0]));
    expect(del).toBeDefined();
  });

  it('先删存储再删库 —— 反过来存储删失败就永远找不到这个 key 了', async () => {
    const app = makeApp();
    await storage.putObject({ key: KEY, filePath: __filename });

    const order: string[] = [];
    const realDelete = storage.deleteObject.bind(storage);
    vi.spyOn(storage, 'deleteObject').mockImplementation(async (k: string) => {
      order.push('storage');
      return realDelete(k);
    });
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/DELETE\s+FROM\s+zenithjoy\.materials/i.test(sql)) { order.push('db'); return { rows: [{ id: MAT_ID }] }; }
      if (/FROM\s+zenithjoy\.contents/i.test(sql)) return { rows: [] };
      if (/FROM\s+zenithjoy\.materials/i.test(sql)) return { rows: [{ id: MAT_ID, storage_key: KEY }] };
      return { rows: [] };
    });

    await request(app).delete(`/api/materials/${MAT_ID}`).set('X-Upload-Token', TOKEN_A);

    expect(order).toEqual(['storage', 'db']);
  });

  it('存储删失败 → 500，且 DB 行原样保留（宁可留着也不留孤儿文件）', async () => {
    stubDb({ id: MAT_ID, storage_key: KEY });
    const app = makeApp();
    vi.spyOn(storage, 'deleteObject').mockRejectedValue(new Error('COS 503'));

    const r = await request(app).delete(`/api/materials/${MAT_ID}`).set('X-Upload-Token', TOKEN_A);

    expect(r.status).toBe(500);
    const del = (pool.query as any).mock.calls
      .find((c: any[]) => /DELETE\s+FROM\s+zenithjoy\.materials/i.test(c[0]));
    expect(del).toBeUndefined();
  });
});

describe('DELETE /api/materials/:id — 已发布的不许删', () => {
  it('素材被已发布作品用着 → 409，且说清是哪个作品挡着', async () => {
    stubDb({ id: MAT_ID, storage_key: KEY }, [{ id: 'c-9', title: '十一月的湖', status: 'published' }]);
    const app = makeApp();
    await storage.putObject({ key: KEY, filePath: __filename });

    const r = await request(app).delete(`/api/materials/${MAT_ID}`).set('X-Upload-Token', TOKEN_A);

    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('IN_USE');
    expect(r.body.error.message).toContain('十一月的湖');
    // 拦下来就一个字节都不能动
    expect(storage.size()).toBe(1);
  });

  it('只被草稿用着 → 照删不误（草稿本来就是传上来自动建的）', async () => {
    stubDb({ id: MAT_ID, storage_key: KEY }, []);
    const app = makeApp();
    await storage.putObject({ key: KEY, filePath: __filename });

    const r = await request(app).delete(`/api/materials/${MAT_ID}`).set('X-Upload-Token', TOKEN_A);

    expect(r.status).toBe(200);
    expect(storage.size()).toBe(0);
  });
});

describe('DELETE /api/materials/:id — 入参', () => {
  it('id 不是 UUID → 400，不去查库', async () => {
    stubDb(null);
    const app = makeApp();

    const r = await request(app).delete('/api/materials/not-a-uuid').set('X-Upload-Token', TOKEN_A);

    expect(r.status).toBe(400);
    expect((pool.query as any).mock.calls.length).toBe(0);
  });
});
