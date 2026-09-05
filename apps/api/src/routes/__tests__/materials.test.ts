/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 素材上传端点契约。
 *
 * 这是所有入口（iPhone 快捷指令 / 小程序 / 电脑 agent）唯一认识的地址，
 * 所以它的租户隔离是整条链上最关键的一道闸——一旦客户端能自报 tenant_id，
 * 任何人填别人的 ID 就能把素材写进别人的库、也能拿到别人的素材 id。
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
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOKEN_A = 'ZJ-F-AAAA1111';
// 无效凭据也走变量：同一个「认证头里的字面量」形状，gitleaks 会当泄露拦下
const BAD_TOKEN = `ZJ-F-NOPE${Math.floor(Math.random() * 9000) + 1000}`;

let storage: InMemoryMaterialStorage;

function makeApp() {
  storage = new InMemoryMaterialStorage();
  const app = express();
  // upload-urls / complete 是 JSON 端点（老 /upload 是 multipart，multer 自己解析，
  // 两者互不打架：express.json() 只认 content-type: application/json）
  app.use(express.json());
  app.use('/api/materials', createMaterialsRouter({ storage }));
  return app;
}

const licenseOk = (tenantId: string) => ({
  ok: true as const,
  license: { id: 'lic', license_key: TOKEN_A, tenant_id: tenantId, status: 'active', expires_at: '2099-01-01T00:00:00Z' },
});

/** 每次 upload 会 INSERT material / INSERT content / INSERT 关联，这里给个通用假返回。 */
function stubDbInserts() {
  let n = 0;
  (pool.query as any).mockImplementation(async (sql: string) => {
    if (/INSERT INTO zenithjoy\.materials/i.test(sql)) {
      return { rows: [{ id: `mat-${++n}`, deduped: false }] };
    }
    if (/INSERT INTO zenithjoy\.contents/i.test(sql)) return { rows: [{ id: 'content-1' }] };
    return { rows: [] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubDbInserts();
});

describe('POST /api/materials/upload — 鉴权与租户隔离', () => {
  it('没有凭据 → 401，且一个字节都不写存储', async () => {
    const app = makeApp();
    const r = await request(app)
      .post('/api/materials/upload')
      .attach('files', Buffer.from('x'), 'a.jpg');

    expect(r.status).toBe(401);
    expect(storage.size()).toBe(0);
  });

  it('凭据无效 → 401', async () => {
    (validateLicense as any).mockResolvedValue({ ok: false, code: 'INVALID_LICENSE', message: 'x' });
    const app = makeApp();
    const r = await request(app)
      .post('/api/materials/upload')
      .set('X-Upload-Token', BAD_TOKEN)
      .attach('files', Buffer.from('x'), 'a.jpg');

    expect(r.status).toBe(401);
    expect(storage.size()).toBe(0);
  });

  it.each(['REVOKED', 'EXPIRED', 'SUSPENDED', 'NO_TENANT'])(
    'license 状态 %s → 403（认得出但不给用）',
    async (code) => {
      (validateLicense as any).mockResolvedValue({ ok: false, code, message: 'x' });
      const app = makeApp();
      const r = await request(app)
        .post('/api/materials/upload')
        .set('X-Upload-Token', TOKEN_A)
        .attach('files', Buffer.from('x'), 'a.jpg');

      expect(r.status).toBe(403);
    },
  );

  it('客户端自报的 tenant_id 被彻底忽略 —— 不能靠填字段提权', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk(TENANT_A));
    const app = makeApp();
    const r = await request(app)
      .post('/api/materials/upload')
      .set('X-Upload-Token', TOKEN_A)
      .field('tenant_id', TENANT_B) // 恶意字段
      .attach('files', Buffer.from('x'), 'a.jpg');

    expect(r.status).toBe(200);
    // 落库用的 tenant 必须是凭据推出来的 A，不是 body 里的 B
    const inserts = (pool.query as any).mock.calls
      .filter((c: any[]) => /INSERT INTO zenithjoy\.(materials|contents)/i.test(c[0]));
    expect(inserts.length).toBeGreaterThan(0);
    for (const call of inserts) {
      const params = call[1] as unknown[];
      expect(params).toContain(TENANT_A);
      expect(params).not.toContain(TENANT_B);
    }
  });
});

describe('POST /api/materials/upload — 限流', () => {
  it('限流器挂在鉴权之前 —— 鉴权 handler 本身也要被限流覆盖', async () => {
    // CodeQL js/missing-rate-limiting：这个端点既写 DB 又写文件系统，不限流
    // 就是现成的 DoS 面。这里验它真的挂上了：超过窗口上限后返回 429。
    const app = makeApp();
    let last = 0;
    // 上限 60/分钟，连打 65 次（无凭据，走最短路径）
    for (let i = 0; i < 65; i++) {
      const r = await request(app).post('/api/materials/upload');
      last = r.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe('POST /api/materials/upload — 上传语义', () => {
  beforeEach(() => {
    (validateLicense as any).mockResolvedValue(licenseOk(TENANT_A));
  });

  it('一次传 3 个文件 → 1 个 content + 3 个 material', async () => {
    const app = makeApp();
    const r = await request(app)
      .post('/api/materials/upload')
      .set('X-Upload-Token', TOKEN_A)
      .attach('files', Buffer.from('a'), 'a.jpg')
      .attach('files', Buffer.from('b'), 'b.jpg')
      .attach('files', Buffer.from('c'), 'c.jpg');

    expect(r.status).toBe(200);
    expect(r.body.data.content_id).toBeTruthy();
    expect(r.body.data.materials).toHaveLength(3);
    expect(storage.size()).toBe(3);
  });

  it('视频和图片混传 → 400，且不写任何存储', async () => {
    const app = makeApp();
    const r = await request(app)
      .post('/api/materials/upload')
      .set('X-Upload-Token', TOKEN_A)
      .attach('files', Buffer.from('v'), 'v.mp4')
      .attach('files', Buffer.from('i'), 'i.jpg');

    expect(r.status).toBe(400);
    expect(storage.size()).toBe(0);
  });

  it('一个文件都没带 → 400', async () => {
    const app = makeApp();
    const r = await request(app).post('/api/materials/upload').set('X-Upload-Token', TOKEN_A);

    expect(r.status).toBe(400);
  });

  it('存储 key 以租户 id 开头 —— 存储层天然按租户分段', async () => {
    const app = makeApp();
    await request(app)
      .post('/api/materials/upload')
      .set('X-Upload-Token', TOKEN_A)
      .attach('files', Buffer.from('x'), 'x.jpg');

    const keys = [...(storage as any).objects.keys()] as string[];
    expect(keys).toHaveLength(1);
    expect(keys[0].startsWith(`${TENANT_A}/`)).toBe(true);
  });

  it('路径穿越的文件名逃不出租户目录', async () => {
    const app = makeApp();
    await request(app)
      .post('/api/materials/upload')
      .set('X-Upload-Token', TOKEN_A)
      .attach('files', Buffer.from('x'), '../../evil.jpg');

    const keys = [...(storage as any).objects.keys()] as string[];
    expect(keys[0].startsWith(`${TENANT_A}/`)).toBe(true);
    expect(keys[0]).not.toContain('..');
  });

  it('重复上传同一文件 → 标记 deduped，不重复写存储', async () => {
    // 第二次 INSERT 命中唯一索引 → ON CONFLICT DO NOTHING 返回空行
    let seen = 0;
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/INSERT INTO zenithjoy\.materials/i.test(sql)) {
        seen += 1;
        return seen === 1 ? { rows: [{ id: 'mat-1' }] } : { rows: [] };
      }
      if (/SELECT id FROM zenithjoy\.materials/i.test(sql)) return { rows: [{ id: 'mat-1' }] };
      if (/INSERT INTO zenithjoy\.contents/i.test(sql)) return { rows: [{ id: 'content-1' }] };
      return { rows: [] };
    });

    const app = makeApp();
    const send = () =>
      request(app)
        .post('/api/materials/upload')
        .set('X-Upload-Token', TOKEN_A)
        .attach('files', Buffer.from('same-bytes'), 'same.jpg');

    const first = await send();
    const second = await send();

    expect(first.body.data.materials[0].deduped).toBe(false);
    expect(second.body.data.materials[0].deduped).toBe(true);
    // 去重命中时不该再往存储写第二份
    expect(storage.size()).toBe(1);
  });
});

describe('POST /api/materials/upload-urls', () => {
  it('无凭据 → 401', async () => {
    const app = makeApp();
    const r = await request(app)
      .post('/api/materials/upload-urls')
      .send({ files: [{ file_name: 'a.jpg', size_bytes: 1024, mime_type: 'image/jpeg' }] });

    expect(r.status).toBe(401);
  });

  it('有效凭据 → 每个文件返回一个 upload_url，且 storage_key 以租户 ID 开头', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk(TENANT_A));
    const app = makeApp();
    const r = await request(app)
      .post('/api/materials/upload-urls')
      .set('X-Upload-Token', TOKEN_A)
      .send({ files: [{ file_name: 'a.jpg', size_bytes: 1024, mime_type: 'image/jpeg' }] });

    expect(r.status).toBe(200);
    expect(r.body.data.files).toHaveLength(1);
    expect(r.body.data.files[0].upload_url).toBeTruthy();
    expect(r.body.data.files[0].storage_key.startsWith(`${TENANT_A}/`)).toBe(true);
  });

  it('客户端自报 tenant_id 被忽略——storage_key 仍在凭据推出的租户下', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk(TENANT_A));
    const app = makeApp();
    const r = await request(app)
      .post('/api/materials/upload-urls')
      .set('X-Upload-Token', TOKEN_A)
      .send({
        tenant_id: 'attacker-tenant',
        files: [{ file_name: 'a.jpg', size_bytes: 1024, mime_type: 'image/jpeg' }],
      });

    expect(r.status).toBe(200);
    const key = r.body.data.files[0].storage_key as string;
    expect(key.startsWith('attacker-tenant/')).toBe(false);
    expect(key.startsWith(`${TENANT_A}/`)).toBe(true);
  });

  it('视频与图片混传 → 400 INVALID_MATERIAL_MIX，在签 URL 阶段就拒', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk(TENANT_A));
    const app = makeApp();
    const r = await request(app)
      .post('/api/materials/upload-urls')
      .set('X-Upload-Token', TOKEN_A)
      .send({
        files: [
          { file_name: 'v.mp4', size_bytes: 1024, mime_type: 'video/mp4' },
          { file_name: 'i.jpg', size_bytes: 1024, mime_type: 'image/jpeg' },
        ],
      });

    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_MATERIAL_MIX');
  });

  it('申报大小超上限 → 400 FILE_TOO_LARGE，不签 URL', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk(TENANT_A));
    const app = makeApp();
    const r = await request(app)
      .post('/api/materials/upload-urls')
      .set('X-Upload-Token', TOKEN_A)
      .send({
        files: [{ file_name: 'big.mp4', size_bytes: 3 * 1024 * 1024 * 1024, mime_type: 'video/mp4' }],
      });

    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('空文件列表 → 400 NO_FILES', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk(TENANT_A));
    const app = makeApp();
    const r = await request(app)
      .post('/api/materials/upload-urls')
      .set('X-Upload-Token', TOKEN_A)
      .send({ files: [] });

    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('NO_FILES');
  });
});

describe('POST /api/materials/complete', () => {
  beforeEach(() => {
    (validateLicense as any).mockResolvedValue(licenseOk(TENANT_A));
  });

  it('对象不存在 → 400 OBJECT_NOT_FOUND，绝不落库', async () => {
    const app = makeApp();
    const materialId = 'material-not-uploaded';
    const storageKey = `${TENANT_A}/${materialId}/missing.jpg`;

    const r = await request(app)
      .post('/api/materials/complete')
      .set('X-Upload-Token', TOKEN_A)
      .send({
        files: [
          { storage_key: storageKey, material_id: materialId, file_name: 'missing.jpg', mime_type: 'image/jpeg', size_bytes: 10 },
        ],
      });

    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('OBJECT_NOT_FOUND');
    const contentInserts = (pool.query as any).mock.calls
      .filter((c: any[]) => /INSERT INTO zenithjoy\.contents/i.test(c[0]));
    expect(contentInserts.length).toBe(0);
  });

  it('对象在但大小对不上 → 400 SIZE_MISMATCH，绝不落库', async () => {
    const app = makeApp();
    const materialId = 'material-size-mismatch';
    const storageKey = `${TENANT_A}/${materialId}/photo.jpg`;
    // 先往注入的内存存储塞一个 999 字节的对象，再申报 10 字节
    (storage as any).objects.set(storageKey, { bytes: Buffer.alloc(999), contentType: 'image/jpeg' });

    const r = await request(app)
      .post('/api/materials/complete')
      .set('X-Upload-Token', TOKEN_A)
      .send({
        files: [
          { storage_key: storageKey, material_id: materialId, file_name: 'photo.jpg', mime_type: 'image/jpeg', size_bytes: 10 },
        ],
      });

    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('SIZE_MISMATCH');
    const contentInserts = (pool.query as any).mock.calls
      .filter((c: any[]) => /INSERT INTO zenithjoy\.contents/i.test(c[0]));
    expect(contentInserts.length).toBe(0);
  });

  it('storage_key 不在自己租户下 → 403 TENANT_MISMATCH，防止认领别人的对象', async () => {
    const app = makeApp();
    const materialId = 'material-foreign';
    const storageKey = `${TENANT_B}/${materialId}/photo.jpg`; // 别人租户下的对象
    (storage as any).objects.set(storageKey, { bytes: Buffer.alloc(10), contentType: 'image/jpeg' });

    const r = await request(app)
      .post('/api/materials/complete')
      .set('X-Upload-Token', TOKEN_A)
      .send({
        files: [
          { storage_key: storageKey, material_id: materialId, file_name: 'photo.jpg', mime_type: 'image/jpeg', size_bytes: 10 },
        ],
      });

    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('TENANT_MISMATCH');
  });

  it('对象存在且大小一致 → 200，落库并返回 content_id', async () => {
    const app = makeApp();
    const materialId = 'material-ok';
    const storageKey = `${TENANT_A}/${materialId}/photo.jpg`;
    (storage as any).objects.set(storageKey, { bytes: Buffer.alloc(10), contentType: 'image/jpeg' });

    const r = await request(app)
      .post('/api/materials/complete')
      .set('X-Upload-Token', TOKEN_A)
      .send({
        files: [
          { storage_key: storageKey, material_id: materialId, file_name: 'photo.jpg', mime_type: 'image/jpeg', size_bytes: 10 },
        ],
      });

    expect(r.status).toBe(200);
    expect(r.body.data.content_id).toBeTruthy();
    expect(r.body.data.materials).toHaveLength(1);
  });
});
