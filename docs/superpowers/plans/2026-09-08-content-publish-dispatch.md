# 作品→发布任务派发接缝 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让作品（contents）一键拆成带统一发布包的 publish_tasks，执行器（AI+skill 安卓真机）能发现并领取作业单（标题/文案/素材签名 URL）。

**Architecture:** 一个新路由文件 `publish-dispatch.ts`（两个 router 工厂：POST /api/contents/:id/publish 派发、GET /api/publish-tasks[/:id/package] 领单），SQL 内联（照 materials.ts 惯例），MaterialStorage 注入；另在 getQueuedTasks 加服务端排除防旧 agent 误领。

**Tech Stack:** Express + pg（pool）+ vitest/supertest（mock pg）+ bash smoke（真 API+真 DB）。

## Global Constraints

- 所有响应遵循项目格式：`{success, data, error?, timestamp}`（照 materials.ts 的 fail() 与成功返回）
- 租户永远从凭据反查（X-Upload-Token → validateLicense），绝不信客户端自报 tenant_id
- 跨租户一律 404（不泄露资源存在性）
- 平台白名单：`douyin xiaohongshu kuaishou toutiao weibo bilibili shipinhao zhihu wechat`
- publish_tasks.type 有 CHECK IN ('video','image','article')——写库前必须白名单校验
- TDD 两段式：commit-1 失败测试 / commit-2 实现（CI 有 lint-tdd-commit-order 类闸）
- 分支 `cp-09082250-publish-dispatch`，worktree `/Users/administrator/worktrees/zenithjoy/session-d5a5065b`
- spec：`docs/superpowers/specs/2026-09-08-content-publish-dispatch-design.md`

---

### Task 1: 派发端点 POST /api/contents/:id/publish

**Files:**
- Create: `apps/api/src/routes/publish-dispatch.ts`
- Modify: `apps/api/src/app.ts`（import 区 + `app.use('/api/materials', ...)` 那一段附近挂载）
- Test: `apps/api/src/routes/__tests__/publish-dispatch.test.ts`

**Interfaces:**
- Consumes: `validateLicense`、`findActiveAgentByTenantId`（walking-skeleton.service.ts:558，10 分钟心跳窗，返回 AgentRow|null）、`pool`（db/connection）、`MaterialStorage.getSignedUrl(key, expiresSeconds?)`（material-storage.ts:34）
- Produces: `createContentsPublishRouter(): Router`、`createPublishTasksRouter(deps?: {storage?: MaterialStorage}): Router`、`PUBLISH_PLATFORMS` 常量；publish_tasks 行契约：`task_type='content_publish'`、`status='queued'`、`payload={content_id,title,body,content_type,platform,materials:[{id,storage_key,file_name,mime_type}]}`

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/routes/__tests__/publish-dispatch.test.ts`：

```typescript
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

/** 假事务 client：记录事务内所有 SQL 供断言。 */
function stubTx() {
  const calls: Array<{ sql: string; params: any[] }> = [];
  let n = 0;
  const client = {
    query: vi.fn(async (sql: string, params?: any[]) => {
      calls.push({ sql, params: params ?? [] });
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

    const updates = calls.filter((c) => /UPDATE zenithjoy\.contents/i.test(c.sql));
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(/queued/);
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
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/administrator/worktrees/zenithjoy/session-d5a5065b/apps/api
npx vitest run src/routes/__tests__/publish-dispatch.test.ts 2>&1 | tail -15
```
Expected: FAIL——`Cannot find module '../publish-dispatch'`（或等价的模块不存在错误）。

- [ ] **Step 3: commit-1（失败测试）**

```bash
git add apps/api/src/routes/__tests__/publish-dispatch.test.ts
git commit -m "test(line01): 派发接缝失败测试先行——作品→publish_tasks 契约（红）"
```

- [ ] **Step 4: 写实现**

创建 `apps/api/src/routes/publish-dispatch.ts`：

```typescript
// apps/api/src/routes/publish-dispatch.ts
//
// 作品→发布任务派发接缝（line01 刀1）。
//
// 作品（contents：title/body/type/platforms + 关联 materials）在这里拆成
// 每平台一条 publish_tasks，任务 payload 里带统一「发布包」——执行器
// （AI+skill 驱动安卓真机，未来 agent-android）领任务时按发布包拿到
// 标题/文案/素材，从此发布内容不再由执行器现编。
//
// 发布包里存 storage_key 不存签名 URL：签名 2 小时过期，派发到领取之间
// 可能隔天，领取时（GET /:id/package）现签才永远有效。

import { Router, type Request, type Response } from 'express';
import pool from '../db/connection';
import {
  validateLicense,
  findActiveAgentByTenantId,
} from '../services/walking-skeleton.service';
import {
  createMaterialStorage,
  type MaterialStorage,
} from '../services/material-storage';

/** 平台白名单——与安卓真机/网页两条执行通道当前覆盖一致。 */
export const PUBLISH_PLATFORMS = [
  'douyin', 'xiaohongshu', 'kuaishou', 'toutiao', 'weibo',
  'bilibili', 'shipinhao', 'zhihu', 'wechat',
] as const;

/** publish_tasks.type 有 CHECK IN ('video','image','article')——写库前拦住，别让 CHECK 违约以 500 暴露。 */
const CONTENT_TYPES = ['video', 'image', 'article'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PublishPackageMaterial {
  id: string;
  storage_key: string;
  file_name: string;
  mime_type: string | null;
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({
    success: false,
    data: null,
    error: { code, message },
    timestamp: new Date().toISOString(),
  });
}

function ok(res: Response, data: unknown): void {
  res.json({ success: true, data, timestamp: new Date().toISOString() });
}

/** 鉴权同 materials.ts：租户从凭据反查，绝不信客户端自报 tenant_id。 */
async function authenticate(
  req: Request,
  res: Response,
): Promise<{ tenantId: string } | null> {
  const token =
    (req.headers['x-upload-token'] as string | undefined)?.trim() || null;
  if (!token) {
    fail(res, 401, 'UNAUTHORIZED', '缺少凭据。请在请求头加 X-Upload-Token: <token>');
    return null;
  }
  let r;
  try {
    r = await validateLicense(token);
  } catch (err) {
    fail(res, 500, 'LICENSE_LOOKUP_FAILED', err instanceof Error ? err.message : 'unknown');
    return null;
  }
  if (!r.ok) {
    fail(res, r.code === 'INVALID_LICENSE' ? 401 : 403, r.code, r.message);
    return null;
  }
  return { tenantId: r.license.tenant_id as string };
}

async function loadMaterials(contentId: string): Promise<PublishPackageMaterial[]> {
  const { rows } = await pool.query<PublishPackageMaterial>(
    `SELECT m.id, m.storage_key, m.file_name, m.mime_type
       FROM zenithjoy.content_materials cm
       JOIN zenithjoy.materials m ON m.id = cm.material_id
      WHERE cm.content_id = $1
      ORDER BY cm.sort_order ASC`,
    [contentId],
  );
  return rows;
}

export function createContentsPublishRouter(): Router {
  const router = Router();

  router.post('/:id/publish', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const { tenantId } = auth;
    const contentId = req.params.id;
    if (!UUID_RE.test(contentId)) {
      fail(res, 404, 'NOT_FOUND', '作品不存在');
      return;
    }

    try {
      const { rows } = await pool.query(
        `SELECT id, title, body, type, platforms, status
           FROM zenithjoy.contents
          WHERE id = $1 AND tenant_id = $2
          LIMIT 1`,
        [contentId, tenantId],
      );
      const content = rows[0];
      if (!content) {
        fail(res, 404, 'NOT_FOUND', '作品不存在');
        return;
      }

      const bodyPlatforms: unknown = req.body?.platforms;
      const platforms: string[] =
        Array.isArray(bodyPlatforms) && bodyPlatforms.length > 0
          ? bodyPlatforms.map(String)
          : (content.platforms as string[] | null) ?? [];
      if (platforms.length === 0) {
        fail(res, 400, 'INVALID_PLATFORMS', '未指定发布平台：作品没带 platforms，请求体也没给');
        return;
      }
      const illegal = platforms.filter(
        (p) => !(PUBLISH_PLATFORMS as readonly string[]).includes(p),
      );
      if (illegal.length > 0) {
        fail(res, 400, 'INVALID_PLATFORMS', `不认识的平台：${illegal.join('、')}`);
        return;
      }

      if (!CONTENT_TYPES.includes(content.type)) {
        fail(res, 400, 'INVALID_CONTENT_TYPE', `作品形态 ${content.type} 不可派发`);
        return;
      }
      if (content.status === 'queued') {
        fail(res, 409, 'ALREADY_QUEUED', '作品已在发布队列中，勿重复派发');
        return;
      }

      const agent = await findActiveAgentByTenantId(tenantId);
      if (!agent) {
        fail(res, 409, 'NO_AGENT', '租户下没有 10 分钟内活跃的 agent，无法派发');
        return;
      }

      const materials = await loadMaterials(contentId);
      if (content.type !== 'article' && materials.length === 0) {
        fail(res, 400, 'NO_MATERIALS', '作品没有任何素材，无法发布');
        return;
      }

      const client = await pool.connect();
      const tasks: Array<{ id: string; platform: string }> = [];
      try {
        await client.query('BEGIN');
        for (const platform of platforms) {
          const payload = JSON.stringify({
            content_id: contentId,
            title: content.title,
            body: content.body,
            content_type: content.type,
            platform,
            materials,
          });
          const ins = await client.query<{ id: string }>(
            `INSERT INTO zenithjoy.publish_tasks
               (agent_id, platform, type, status, task_type, tenant_id, payload)
             VALUES ($1, $2, $3, 'queued', 'content_publish', $4, $5::jsonb)
             RETURNING id`,
            [agent.id, platform, content.type, tenantId, payload],
          );
          tasks.push({ id: ins.rows[0].id, platform });
        }
        await client.query(
          `UPDATE zenithjoy.contents
              SET status = 'queued', updated_at = now()
            WHERE id = $1`,
          [contentId],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }

      ok(res, { content_id: contentId, tasks });
    } catch (err) {
      fail(res, 500, 'DISPATCH_FAILED', err instanceof Error ? err.message : 'unknown');
    }
  });

  return router;
}

export interface PublishTasksRouterDeps {
  storage?: MaterialStorage;
}

export function createPublishTasksRouter(deps: PublishTasksRouterDeps = {}): Router {
  const router = Router();
  const storage = deps.storage ?? createMaterialStorage();

  // 执行器发现作业单：只看本租户的 content_publish 任务
  router.get('/', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : null;
      const params: unknown[] = [auth.tenantId];
      let where = `tenant_id = $1 AND task_type = 'content_publish'`;
      if (status) {
        params.push(status);
        where += ` AND status = $2`;
      }
      const { rows } = await pool.query(
        `SELECT id, platform, type, status, created_at
           FROM zenithjoy.publish_tasks
          WHERE ${where}
          ORDER BY created_at DESC
          LIMIT 100`,
        params,
      );
      ok(res, { items: rows });
    } catch (err) {
      fail(res, 500, 'LIST_FAILED', err instanceof Error ? err.message : 'unknown');
    }
  });

  // 执行器领作业单：领取时现签素材 URL（签名 1 小时，够下载）
  router.get('/:id/package', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const taskId = req.params.id;
    if (!UUID_RE.test(taskId)) {
      fail(res, 404, 'NOT_FOUND', '任务不存在');
      return;
    }
    try {
      const { rows } = await pool.query(
        `SELECT id, payload
           FROM zenithjoy.publish_tasks
          WHERE id = $1 AND tenant_id = $2 AND task_type = 'content_publish'
          LIMIT 1`,
        [taskId, auth.tenantId],
      );
      const task = rows[0];
      if (!task || !task.payload) {
        fail(res, 404, 'NOT_FOUND', '任务不存在');
        return;
      }
      const p = task.payload as {
        content_id: string; title: string | null; body: string | null;
        content_type: string; platform: string; materials: PublishPackageMaterial[];
      };
      const media = await Promise.all(
        (p.materials ?? []).map(async (m) => ({
          url: await storage.getSignedUrl(m.storage_key),
          file_name: m.file_name,
          mime_type: m.mime_type,
        })),
      );
      ok(res, {
        content_id: p.content_id,
        title: p.title,
        body: p.body,
        content_type: p.content_type,
        platform: p.platform,
        media,
      });
    } catch (err) {
      fail(res, 500, 'PACKAGE_FAILED', err instanceof Error ? err.message : 'unknown');
    }
  });

  return router;
}
```

修改 `apps/api/src/app.ts`：在 `import { createMaterialsRouter } from './routes/materials';` 附近加：

```typescript
import { createContentsPublishRouter, createPublishTasksRouter } from './routes/publish-dispatch';
```

在 `app.use('/api/materials', createMaterialsRouter());`（约 167 行）后面加：

```typescript
app.use('/api/contents', createContentsPublishRouter());
app.use('/api/publish-tasks', createPublishTasksRouter());
```

- [ ] **Step 5: 跑测试确认全绿**

```bash
cd /Users/administrator/worktrees/zenithjoy/session-d5a5065b/apps/api
npx vitest run src/routes/__tests__/publish-dispatch.test.ts 2>&1 | tail -8
```
Expected: Task 1 的 describe 里 9 个用例全 PASS（Task 2 的用例此时还没写）。

- [ ] **Step 6: commit-2（实现）**

```bash
git add apps/api/src/routes/publish-dispatch.ts apps/api/src/app.ts
git commit -m "feat(line01): 作品一键拆发布任务——POST /api/contents/:id/publish + 统一发布包（绿）"
```

---

### Task 2: 领单端点 GET /api/publish-tasks + /:id/package

**Files:**
- Modify: `apps/api/src/routes/__tests__/publish-dispatch.test.ts`（追加 describe）
- （实现已在 Task 1 的 publish-dispatch.ts 里完成——本 task 是给领单侧补契约测试，若测试暴露实现缺陷则修实现）

**Interfaces:**
- Consumes: Task 1 的 `createPublishTasksRouter({storage})`；InMemoryMaterialStorage 的 getSignedUrl 返回可辨认占位串
- Produces: package 响应契约 `{content_id,title,body,content_type,platform,media:[{url,file_name,mime_type}]}`

- [ ] **Step 1: 追加失败测试（对领单侧的独立契约）**

在 `publish-dispatch.test.ts` 末尾追加：

```typescript
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
```

> 注意：InMemoryMaterialStorage.getSignedUrl 的占位串格式若不含 key（先看 material-storage.ts 的 InMemory 实现再定断言），把 `toContain('k/a.jpg')` 换成与实现一致的可辨认断言，但**必须断言 URL 与 storage_key 有可验证关联**，不许只断非空。

- [ ] **Step 2: 跑测试**

```bash
cd /Users/administrator/worktrees/zenithjoy/session-d5a5065b/apps/api
npx vitest run src/routes/__tests__/publish-dispatch.test.ts 2>&1 | tail -8
```
Expected: 若 Task 1 实现完整则直接全绿（此时本 task 只补契约覆盖，属允许情况——测试先于本 task 的实现已存在）；若有红，修 publish-dispatch.ts 直到绿。

- [ ] **Step 3: commit**

```bash
git add apps/api/src/routes/__tests__/publish-dispatch.test.ts apps/api/src/routes/publish-dispatch.ts
git commit -m "test(line01): 领单端点契约——列表过滤/跨租户404/领取现签URL"
```

---

### Task 3: getQueuedTasks 排除 content_publish（防旧 agent 误领）

**Files:**
- Modify: `apps/api/src/services/walking-skeleton.service.ts:415-424`（getQueuedTasks）
- Test: `apps/api/src/services/__tests__/get-queued-tasks-exclusion.test.ts`（新建）

**Interfaces:**
- Consumes: `getQueuedTasks(agentId)`（唯一调用点 walking-skeleton.ts:152 心跳）
- Produces: 心跳拉任务的 SQL 排除 `task_type='content_publish'`；`IS DISTINCT FROM` 保住 task_type=NULL 老任务与 acquisition_cancel/burner 流

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/services/__tests__/get-queued-tasks-exclusion.test.ts`：

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 旧 agent（Windows/安卓既有版本）经心跳 getQueuedTasks 拉任务；content_publish
 * 是给新执行器（GET /api/publish-tasks 通道）的，旧 agent 不认识——一旦误领会
 * 拿着不认识的 payload 走 work_id 老路径。必须在中台侧排除（旧 agent 已部署，改不了它）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));

import pool from '../../db/connection';
import { getQueuedTasks } from '../walking-skeleton.service';

beforeEach(() => vi.clearAllMocks());

describe('getQueuedTasks 排除 content_publish', () => {
  it('SQL 用 IS DISTINCT FROM 排除 content_publish（保住 task_type=NULL 与其他 task_type）', async () => {
    (pool.query as any).mockResolvedValue({ rows: [] });
    await getQueuedTasks('agent-1');
    const sql: string = (pool.query as any).mock.calls[0][0];
    expect(sql).toMatch(/task_type\s+IS\s+DISTINCT\s+FROM\s+'content_publish'/i);
    expect(sql).toMatch(/status IN \('pending', 'queued', 'dispatched'\)/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/administrator/worktrees/zenithjoy/session-d5a5065b/apps/api
npx vitest run src/services/__tests__/get-queued-tasks-exclusion.test.ts 2>&1 | tail -6
```
Expected: FAIL——现有 SQL 无排除条款。

- [ ] **Step 3: commit-1**

```bash
git add apps/api/src/services/__tests__/get-queued-tasks-exclusion.test.ts
git commit -m "test(line01): 心跳拉任务须排除 content_publish——旧 agent 误领守卫（红）"
```

- [ ] **Step 4: 改实现**

`walking-skeleton.service.ts` getQueuedTasks 的 SQL（:417-420）改为：

```typescript
    `SELECT id, agent_id, platform, status, type, task_type, folder_path, result, receipt_at, created_at, payload
       FROM zenithjoy.publish_tasks
      WHERE agent_id = $1 AND status IN ('pending', 'queued', 'dispatched')
        AND task_type IS DISTINCT FROM 'content_publish'
      ORDER BY created_at ASC`,
```

并在函数上方注释块追加一行：

```typescript
 * 刀1(line01)：content_publish 是新执行器（GET /api/publish-tasks）的作业单，
 * 旧 agent 不认识其 payload——中台侧排除（IS DISTINCT FROM 保住 NULL 与既有 task_type）。
```

- [ ] **Step 5: 跑测试确认绿 + 全量回归**

```bash
cd /Users/administrator/worktrees/zenithjoy/session-d5a5065b/apps/api
npx vitest run src/services/__tests__/get-queued-tasks-exclusion.test.ts 2>&1 | tail -4
npx vitest run 2>&1 | tail -6
```
Expected: 新测试 PASS；全量无新增失败（若既有测试断言了 getQueuedTasks 的 SQL 原文，按新 SQL 更新该断言）。

- [ ] **Step 6: commit-2**

```bash
git add apps/api/src/services/walking-skeleton.service.ts
git commit -m "feat(line01): 心跳拉任务排除 content_publish——旧 agent 不误领新作业单（绿）"
```

---

### Task 4: smoke 全链路脚本 + 进 CI 基线

**Files:**
- Create: `.github/workflows/scripts/smoke/content-publish-dispatch-smoke.sh`
- Modify: `.github/workflows/scripts/smoke-baseline.txt`（按字母序插入一行 `content-publish-dispatch-smoke.sh`）

**Interfaces:**
- Consumes: 真 API（$API_BASE）+ 真 DB（$DATABASE_URL）；照 material-upload-smoke.sh 的自种子模式，另需种一条 last_heartbeat_at=now() 的 agent（dispatch 要求 10 分钟内活跃 agent）
- Produces: CI 必绿闸（smoke-baseline 棘轮）；PR 标题需带 [CONFIG]（smoke 进 CI 的既有规矩）

- [ ] **Step 1: 写 smoke 脚本**

创建 `.github/workflows/scripts/smoke/content-publish-dispatch-smoke.sh`（chmod +x）：

```bash
#!/usr/bin/env bash
# 作品→发布任务派发接缝 smoke：真 API + 真 DB 走一遍
# 上传素材 → 一键派发 → 列表可见 → 领发布包（标题/文案/签名URL）。
#
# 这是「标题文案写一次→执行器替你发」闭环的地基；单测 mock 了 pg 和事务，
# 只有真链路能证明 拆任务/置状态/领单现签 在 express+pg 串起来后仍成立。
#
# 用法：API_BASE=http://localhost:5200 bash content-publish-dispatch-smoke.sh
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
fail() { echo "❌ $*"; exit 1; }

if [ -z "${DATABASE_URL:-}" ] && [ -z "${PGHOST:-}" ]; then
  echo "SKIP: 找不到 DATABASE_URL/PGHOST——本环境没有可用 DB，跳过"
  exit 0
fi
PSQL=(psql -tA -v ON_ERROR_STOP=1)
[ -n "${DATABASE_URL:-}" ] && PSQL=(psql -tA -v ON_ERROR_STOP=1 "$DATABASE_URL")
UUID_RE='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

echo "[seed] tenant + license + 活跃 agent"
TENANT_ID=$("${PSQL[@]}" -c \
  "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('cpd-smoke-${RANDOM}', 'cpd-key-${RANDOM}', 'free') RETURNING id" \
  | grep -oE "$UUID_RE" | head -1)
[ -n "$TENANT_ID" ] || fail "种 tenant 失败"
LICENSE_KEY="ZJ-F-CPD${RANDOM}"
"${PSQL[@]}" -c \
  "INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, status, tenant_id, expires_at) \
   VALUES ('${LICENSE_KEY}','free',5,'active','${TENANT_ID}', now()+interval '1 day')" >/dev/null
# dispatch 要求租户 10 分钟内有活跃 agent
"${PSQL[@]}" -c \
  "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status, last_heartbeat_at) \
   VALUES ('${TENANT_ID}', 'cpd-smoke-agent-${RANDOM}', 'smoke-host', 'online', now())" >/dev/null
echo "[seed] tenant=$TENANT_ID license=$LICENSE_KEY"

TMPDIR_LOCAL=$(mktemp -d)
trap 'rm -rf "$TMPDIR_LOCAL"' EXIT
IMG="$TMPDIR_LOCAL/a.jpg"
printf '\xff\xd8\xff\xe0\x00\x10JFIF-cpd-smoke' > "$IMG"

echo "[1] 传素材建作品（带标题/文案/平台）"
R=$(curl -sf -X POST "$API_BASE/api/materials/upload" \
  -H "X-Upload-Token: $LICENSE_KEY" \
  -F "files=@$IMG" \
  -F "title=今日份的治愈色" \
  -F "body=生活需要一点渐变" \
  -F "platforms=douyin,weibo") || fail "上传失败"
CONTENT_ID=$(echo "$R" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["content_id"])')
[ -n "$CONTENT_ID" ] || fail "没拿到 content_id"

echo "[2] 无凭据派发 → 401"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/contents/$CONTENT_ID/publish")
[ "$C" = "401" ] || fail "无凭据 expected 401 got $C"

echo "[3] 一键派发 → 2 平台 2 条任务"
R=$(curl -sf -X POST "$API_BASE/api/contents/$CONTENT_ID/publish" \
  -H "X-Upload-Token: $LICENSE_KEY" -H 'Content-Type: application/json' -d '{}') || fail "派发失败"
TASK_ID=$(echo "$R" | python3 -c '
import sys, json
d = json.load(sys.stdin)["data"]
assert len(d["tasks"]) == 2, "应拆 2 条任务，实际 " + str(len(d["tasks"]))
plats = sorted(t["platform"] for t in d["tasks"])
assert plats == ["douyin", "weibo"], "平台不符: " + str(plats)
print(d["tasks"][0]["id"])
') || fail "派发响应不符"

echo "[4] 重复派发 → 409 ALREADY_QUEUED"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/contents/$CONTENT_ID/publish" \
  -H "X-Upload-Token: $LICENSE_KEY" -H 'Content-Type: application/json' -d '{}')
[ "$C" = "409" ] || fail "重复派发 expected 409 got $C"

echo "[5] 作业单列表可见"
R=$(curl -sf "$API_BASE/api/publish-tasks?status=queued" -H "X-Upload-Token: $LICENSE_KEY") || fail "列表失败"
echo "$R" | python3 -c '
import sys, json
items = json.load(sys.stdin)["data"]["items"]
assert len(items) == 2, "列表应有 2 条，实际 " + str(len(items))
' || fail "列表内容不符"

echo "[6] 领发布包：标题/文案/签名 URL 齐"
R=$(curl -sf "$API_BASE/api/publish-tasks/$TASK_ID/package" -H "X-Upload-Token: $LICENSE_KEY") || fail "领单失败"
echo "$R" | python3 -c '
import sys, json
d = json.load(sys.stdin)["data"]
assert d["title"] == "今日份的治愈色", "标题不符: " + str(d["title"])
assert d["body"] == "生活需要一点渐变", "文案不符: " + str(d["body"])
assert d["content_type"] == "image"
assert len(d["media"]) == 1 and d["media"][0]["url"], "media 签名 URL 缺失"
print("    package: title/body/media ✓")
' || fail "发布包内容不符"

echo "[7] 旧 agent 心跳看不见 content_publish 任务（DB 层面直接验 SQL 语义）"
N=$("${PSQL[@]}" -c \
  "SELECT count(*) FROM zenithjoy.publish_tasks \
    WHERE tenant_id='${TENANT_ID}' AND task_type IS DISTINCT FROM 'content_publish'")
[ "$N" = "0" ] || fail "本租户不该有非 content_publish 任务（count=${N}）"

echo "[8] 跨租户领单 → 404"
TENANT_B=$("${PSQL[@]}" -c \
  "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('cpd-smoke-b-${RANDOM}', 'cpd-keyb-${RANDOM}', 'free') RETURNING id" \
  | grep -oE "$UUID_RE" | head -1)
LICENSE_B="ZJ-F-CPB${RANDOM}"
"${PSQL[@]}" -c \
  "INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, status, tenant_id, expires_at) \
   VALUES ('${LICENSE_B}','free',5,'active','${TENANT_B}', now()+interval '1 day')" >/dev/null
C=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/api/publish-tasks/$TASK_ID/package" -H "X-Upload-Token: $LICENSE_B")
[ "$C" = "404" ] || fail "跨租户 expected 404 got $C"

echo "✅ content-publish-dispatch smoke PASS"
```

> 注意 [1]：materials upload 端点的 title/body/platforms 是 multipart 字段（materials.ts:331-339 已支持）。若 CI 里上传端点对 title/body 的解析行为与预期不符（比如返回结构里没有回显），只影响 [6] 的断言来源——以 DB 里 contents.title 实际值为准调整断言，不许放宽为"非空"。

- [ ] **Step 2: 本地跑通 smoke（用本地 API + 本地 DB，如果起不了本地栈则跳过本步，靠 CI 验证）**

```bash
chmod +x .github/workflows/scripts/smoke/content-publish-dispatch-smoke.sh
bash -n .github/workflows/scripts/smoke/content-publish-dispatch-smoke.sh && echo "语法 OK"
```
Expected: `语法 OK`。

- [ ] **Step 3: 进基线**

`.github/workflows/scripts/smoke-baseline.txt` 按字母序插入一行：

```
content-publish-dispatch-smoke.sh
```

（位置：`clips-smoke.sh` 之后、`cs-oneclick-setup-smoke.sh` 之前。）

- [ ] **Step 4: commit**

```bash
git add .github/workflows/scripts/smoke/content-publish-dispatch-smoke.sh .github/workflows/scripts/smoke-baseline.txt
git commit -m "test(line01): 派发接缝全链路 smoke 进 CI 基线——传素材→派发→领包→跨租户404"
```

---

### Task 5: 全量验证 + lint

**Files:** 无新增（验证性 task）

- [ ] **Step 1: 全量测试 + 类型 + lint**

```bash
cd /Users/administrator/worktrees/zenithjoy/session-d5a5065b/apps/api
npx vitest run 2>&1 | tail -6
npx tsc --noEmit 2>&1 | tail -5
npx eslint src/routes/publish-dispatch.ts src/routes/__tests__/publish-dispatch.test.ts src/services/__tests__/get-queued-tasks-exclusion.test.ts 2>&1 | tail -5
```
Expected: vitest 无失败；tsc 无输出（或仅既有告警）；eslint 无 error。

- [ ] **Step 2: 修掉暴露的问题并提交（如有）**

```bash
git add -A && git commit -m "fix(line01): 全量验证收尾"
```
（无问题则跳过本步。）
