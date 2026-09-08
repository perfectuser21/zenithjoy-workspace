/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 作品→发布任务派发接缝契约。
 *
 * 发布包是执行器（AI+skill 安卓真机）唯一认识的作业单格式；
 * 租户隔离与 getQueuedTasks 排除（旧 agent 不误领）是两道安全闸。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../services/walking-skeleton.service', () => ({
  validateLicense: vi.fn(),
  findActiveAgentByTenantId: vi.fn(),
}));
vi.mock('../../db/connection', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));

import { validateLicense, findActiveAgentByTenantId } from '../../services/walking-skeleton.service';
import pool from '../../db/connection';
import { InMemoryMaterialStorage } from '../../services/material-storage';
import { createContentsPublishRouter, createPublishTasksRouter } from '../publish-dispatch';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN_A = 'ZJ-F-AAAA1111';
const CONTENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const AGENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const licenseOk = (tenantId: string) => ({
  ok: true as const,
  license: { id: 'lic', license_key: TOKEN_A, tenant_id: tenantId, status: 'active', expires_at: '2099-01-01T00:00:00Z' },
});

let storage: InMemoryMaterialStorage;

function makeApp() {
  storage = new InMemoryMaterialStorage();
  const app = express();
  app.use(express.json());
  app.use('/api/contents', createContentsPublishRouter());
  app.use('/api/publish-tasks', createPublishTasksRouter({ storage }));
  return app;
}

const CONTENT_ROW = {
  id: CONTENT_ID, title: '今日份的治愈色', body: '生活需要一点渐变 #治愈', type: 'image',
  platforms: ['douyin', 'xiaohongshu'], status: 'draft',
};
const MATERIAL_ROWS = [
  { id: 'm1', storage_key: 'k/a.jpg', file_name: 'a.jpg', mime_type: 'image/jpeg' },
  { id: 'm2', storage_key: 'k/b.jpg', file_name: 'b.jpg', mime_type: 'image/jpeg' },
];

/** 假事务 client：记录事务内所有 SQL 供断言。CAS 默认成功（rowCount=1）。 */
function stubTx(casResult: { rows: any[]; rowCount: number } = { rows: [{ id: CONTENT_ID }], rowCount: 1 }) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  let n = 0;
  const client = {
    query: vi.fn(async (sql: string, params?: any[]) => {
      calls.push({ sql, params: params ?? [] });
      if (/UPDATE zenithjoy\.contents/i.test(sql)) return casResult;
      if (/INSERT INTO zenithjoy\.publish_tasks/i.test(sql)) return { rows: [{ id: `task-${++n}` }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  (pool.connect as any).mockResolvedValue(client);
  return { client, calls };
}

/** 默认查询桩：查 content 返回 CONTENT_ROW，查素材返回 MATERIAL_ROWS。 */
function stubQueries(contentRow: any = CONTENT_ROW) {
  (pool.query as any).mockImplementation(async (sql: string) => {
    if (/FROM zenithjoy\.contents/i.test(sql)) return { rows: contentRow ? [contentRow] : [] };
    if (/FROM zenithjoy\.content_materials/i.test(sql)) return { rows: MATERIAL_ROWS };
    return { rows: [] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (validateLicense as any).mockResolvedValue(licenseOk(TENANT_A));
  (findActiveAgentByTenantId as any).mockResolvedValue({ id: AGENT_ID, tenant_id: TENANT_A });
  stubQueries();
  stubTx();
});

describe('POST /api/contents/:id/publish', () => {
  it('无凭据 → 401', async () => {
    (validateLicense as any).mockResolvedValue({ ok: false, code: 'INVALID_LICENSE', message: 'x' });
    const r = await request(makeApp()).post(`/api/contents/${CONTENT_ID}/publish`).send({});
    expect(r.status).toBe(401);
  });

  it('作品不存在（或跨租户）→ 404', async () => {
    stubQueries(null);
    const r = await request(makeApp())
      .post(`/api/contents/${CONTENT_ID}/publish`).set('X-Upload-Token', TOKEN_A).send({});
    expect(r.status).toBe(404);
  });

  it('platforms 含白名单外平台 → 400 INVALID_PLATFORMS', async () => {
    const r = await request(makeApp())
      .post(`/api/contents/${CONTENT_ID}/publish`).set('X-Upload-Token', TOKEN_A)
      .send({ platforms: ['douyin', 'myspace'] });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_PLATFORMS');
  });

  it('作品无 platforms 且 body 也没给 → 400', async () => {
    stubQueries({ ...CONTENT_ROW, platforms: [] });
    const r = await request(makeApp())
      .post(`/api/contents/${CONTENT_ID}/publish`).set('X-Upload-Token', TOKEN_A).send({});
    expect(r.status).toBe(400);
  });

  it('作品已 queued → 409 ALREADY_QUEUED（幂等防连点）', async () => {
    stubQueries({ ...CONTENT_ROW, status: 'queued' });
    const r = await request(makeApp())
      .post(`/api/contents/${CONTENT_ID}/publish`).set('X-Upload-Token', TOKEN_A).send({});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ALREADY_QUEUED');
  });

  it('租户无活跃 agent → 409 NO_AGENT', async () => {
    (findActiveAgentByTenantId as any).mockResolvedValue(null);
    const r = await request(makeApp())
      .post(`/api/contents/${CONTENT_ID}/publish`).set('X-Upload-Token', TOKEN_A).send({});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('NO_AGENT');
  });

  it('图文作品但没有任何素材 → 400 NO_MATERIALS', async () => {
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/FROM zenithjoy\.contents/i.test(sql)) return { rows: [CONTENT_ROW] };
      if (/FROM zenithjoy\.content_materials/i.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const r = await request(makeApp())
      .post(`/api/contents/${CONTENT_ID}/publish`).set('X-Upload-Token', TOKEN_A).send({});
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('NO_MATERIALS');
  });

  it('成功：2 平台拆 2 条任务，发布包字段齐，contents 置 queued', async () => {
    const { calls } = stubTx();
    const r = await request(makeApp())
      .post(`/api/contents/${CONTENT_ID}/publish`).set('X-Upload-Token', TOKEN_A).send({});
    expect(r.status).toBe(200);
    expect(r.body.data.content_id).toBe(CONTENT_ID);
    expect(r.body.data.tasks).toHaveLength(2);
    expect(r.body.data.tasks.map((t: any) => t.platform).sort()).toEqual(['douyin', 'xiaohongshu']);

    const inserts = calls.filter((c) => /INSERT INTO zenithjoy\.publish_tasks/i.test(c.sql));
    expect(inserts).toHaveLength(2);
    const payload = JSON.parse(inserts[0].params[inserts[0].params.length - 1]);
    expect(payload).toMatchObject({
      content_id: CONTENT_ID, title: CONTENT_ROW.title, body: CONTENT_ROW.body,
      content_type: 'image', platform: 'douyin',
    });
    expect(payload.materials).toHaveLength(2);
    expect(payload.materials[0]).toMatchObject({ id: 'm1', storage_key: 'k/a.jpg', file_name: 'a.jpg', mime_type: 'image/jpeg' });

    const updateIdx = calls.findIndex((c) => /UPDATE zenithjoy\.contents/i.test(c.sql));
    const insertIdxs = calls
      .map((c, i) => (/INSERT INTO zenithjoy\.publish_tasks/i.test(c.sql) ? i : -1))
      .filter((i) => i >= 0);
    const updates = calls.filter((c) => /UPDATE zenithjoy\.contents/i.test(c.sql));
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(/queued/);
    expect(updates[0].sql).toMatch(/status\s*<>\s*'queued'/);
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdxs.every((i) => i > updateIdx)).toBe(true);
  });

  it('并发对手抢先：CAS rowCount=0 → 409 ALREADY_QUEUED 且无任何 INSERT', async () => {
    const { calls } = stubTx({ rows: [], rowCount: 0 });
    const r = await request(makeApp())
      .post(`/api/contents/${CONTENT_ID}/publish`).set('X-Upload-Token', TOKEN_A).send({});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ALREADY_QUEUED');
    expect(calls.filter((c) => /INSERT INTO zenithjoy\.publish_tasks/i.test(c.sql))).toHaveLength(0);
  });

  it('body.platforms 覆盖作品自带 platforms', async () => {
    const { calls } = stubTx();
    const r = await request(makeApp())
      .post(`/api/contents/${CONTENT_ID}/publish`).set('X-Upload-Token', TOKEN_A)
      .send({ platforms: ['weibo'] });
    expect(r.status).toBe(200);
    expect(r.body.data.tasks).toHaveLength(1);
    expect(r.body.data.tasks[0].platform).toBe('weibo');
    expect(calls.filter((c) => /INSERT INTO zenithjoy\.publish_tasks/i.test(c.sql))).toHaveLength(1);
  });
});

describe('GET /api/publish-tasks（执行器发现作业单）', () => {
  it('只列本租户 content_publish 任务，支持 status 过滤', async () => {
    (pool.query as any).mockImplementation(async (sql: string, params: any[]) => {
      expect(sql).toMatch(/task_type = 'content_publish'/);
      expect(params[0]).toBe(TENANT_A);
      if (/AND status = \$2/.test(sql)) expect(params[1]).toBe('queued');
      return { rows: [{ id: 't1', platform: 'douyin', type: 'image', status: 'queued', created_at: 'now' }] };
    });
    const r = await request(makeApp())
      .get('/api/publish-tasks?status=queued').set('X-Upload-Token', TOKEN_A);
    expect(r.status).toBe(200);
    expect(r.body.data.items).toHaveLength(1);
  });

  it('无凭据 → 401', async () => {
    (validateLicense as any).mockResolvedValue({ ok: false, code: 'INVALID_LICENSE', message: 'x' });
    const r = await request(makeApp()).get('/api/publish-tasks');
    expect(r.status).toBe(401);
  });
});

describe('GET /api/publish-tasks/:id/package（执行器领作业单）', () => {
  const TASK_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const PAYLOAD = {
    content_id: CONTENT_ID, title: '今日份的治愈色', body: '生活需要一点渐变 #治愈',
    content_type: 'image', platform: 'douyin',
    materials: [{ id: 'm1', storage_key: 'k/a.jpg', file_name: 'a.jpg', mime_type: 'image/jpeg' }],
  };

  it('跨租户/不存在/非 content_publish → 404', async () => {
    (pool.query as any).mockResolvedValue({ rows: [] });
    const r = await request(makeApp())
      .get(`/api/publish-tasks/${TASK_ID}/package`).set('X-Upload-Token', TOKEN_A);
    expect(r.status).toBe(404);
  });

  it('领取成功：领取时现签素材 URL，标题文案原样带出', async () => {
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/FROM zenithjoy\.publish_tasks/i.test(sql)) {
        return { rows: [{ id: TASK_ID, payload: PAYLOAD }] };
      }
      return { rows: [] };
    });
    const r = await request(makeApp())
      .get(`/api/publish-tasks/${TASK_ID}/package`).set('X-Upload-Token', TOKEN_A);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      content_id: CONTENT_ID, title: PAYLOAD.title, body: PAYLOAD.body,
      content_type: 'image', platform: 'douyin',
    });
    expect(r.body.data.media).toHaveLength(1);
    expect(r.body.data.media[0].file_name).toBe('a.jpg');
    expect(r.body.data.media[0].url).toBeTruthy();
    // 签名 URL 必须来自 storage（InMemory 实现的占位串包含 key）
    expect(r.body.data.media[0].url).toContain('k/a.jpg');
  });

  it('id 不是 UUID → 404（不查库）', async () => {
    const r = await request(makeApp())
      .get('/api/publish-tasks/not-a-uuid/package').set('X-Upload-Token', TOKEN_A);
    expect(r.status).toBe(404);
  });
});
