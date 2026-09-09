# Notion 发布编排台双向同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 作品自动长进 Notion 编排台，主理人填文案改状态"发"即派发（走刀1链），回执写回行。

**Architecture:** ①刀1 派发核心抽 `services/content-publish-dispatch.ts`（route/worker 共用，类型化错误）②`services/notion-client.ts` 共享 Notion 请求封装③`services/notion-orchestrator.ts` 60s 轮询 worker（推行/拉发/回执三方向 + 启动自检 + running 互斥）④contents 加 notion_page_id migration⑤一次性建库脚本。

**Tech Stack:** Express/pg/axios/vitest（mock pg+notion-client）；worker 骨架照 worker-lease-sweeper。

## Global Constraints

- spec：`docs/superpowers/specs/2026-09-09-notion-orchestrator-design.md`（字段/状态机/错误翻译表以它为准）
- **service 自定义错误类，不 import walking-skeleton 的 NoAgentError**——现有 publish-dispatch.test.ts 的 `vi.mock('../../services/walking-skeleton.service')` 只返回两个函数，跨模块类会 undefined
- 日志纪律：任何 catch 不打整个 AxiosError（config.headers 含 Bearer token），只打 message/status/response.data
- rich_text 单元素 ≤1900 字符截断；平台读回必须过 `PUBLISH_PLATFORMS` 白名单
- 回执写完必须把 contents 挪出 'queued'（→'published'/'failed'）
- migration 全 DDL 幂等、不包 BEGIN/COMMIT；文件名 `YYYYMMDD_HHMMSS_描述.sql`
- 刀1 既有 16 个测试必须全程保绿（抽取=置换，承诺零变化）
- 分支 `cp-09091100-notion-orchestrator`，worktree `/Users/administrator/worktrees/zenithjoy/session-d5a5065b`

---

### Task 1: 派发核心抽 service（置换，零行为变化）

**Files:**
- Create: `apps/api/src/services/content-publish-dispatch.ts`
- Modify: `apps/api/src/routes/publish-dispatch.ts`（handler 改薄，PUBLISH_PLATFORMS 迁移后 re-export）
- Test: 既有 `apps/api/src/routes/__tests__/publish-dispatch.test.ts` 16 用例保绿（不新增）

**Interfaces:**
- Produces: `dispatchContentPublish({contentId, tenantId, platformsOverride?}) → Promise<DispatchResult | null>`（null=作品不存在/跨租户）；`AlreadyQueuedError`（code='ALREADY_QUEUED'）；`DispatchValidationError(code, message)`；`NoActiveAgentError`（code='NO_AGENT'）；`PUBLISH_PLATFORMS`（从 route 迁来，route re-export 保兼容）
- Consumes: `pool`、`findActiveAgentByTenantId`（walking-skeleton.service）

- [ ] **Step 1: 新建 service（代码从 route L112-L210 平移 + 错误类型化）**

创建 `apps/api/src/services/content-publish-dispatch.ts`：

```typescript
// apps/api/src/services/content-publish-dispatch.ts
//
// 作品→发布任务派发核心（刀2 从 routes/publish-dispatch.ts 抽出，置换零行为变化）。
// route（HTTP 入口）与 notion-orchestrator（编排台 worker）共用这一份——复用即引用。
//
// 错误全部类型化、本模块自有（不 import walking-skeleton 的错误类：
// 既有测试对该模块做了整体 mock，跨模块类会变 undefined 令 instanceof 失效）。

import pool from '../db/connection';
import { findActiveAgentByTenantId } from './walking-skeleton.service';

/** 平台白名单——与安卓真机/网页两条执行通道当前覆盖一致。 */
export const PUBLISH_PLATFORMS = [
  'douyin', 'xiaohongshu', 'kuaishou', 'toutiao', 'weibo',
  'bilibili', 'shipinhao', 'zhihu', 'wechat',
] as const;

/** publish_tasks.type 有 CHECK IN ('video','image','article')——写库前拦住。 */
const CONTENT_TYPES = ['video', 'image', 'article'];

export class AlreadyQueuedError extends Error {
  code = 'ALREADY_QUEUED' as const;
  constructor() {
    super('作品已在发布队列中，勿重复派发');
    this.name = 'AlreadyQueuedError';
  }
}

export class NoActiveAgentError extends Error {
  code = 'NO_AGENT' as const;
  constructor() {
    super('租户下没有 10 分钟内活跃的 agent，无法派发');
    this.name = 'NoActiveAgentError';
  }
}

export class DispatchValidationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'DispatchValidationError';
  }
}

export interface DispatchResult {
  content_id: string;
  tasks: Array<{ id: string; platform: string }>;
}

interface PublishPackageMaterial {
  id: string;
  storage_key: string;
  file_name: string;
  mime_type: string | null;
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

/**
 * 作品按平台拆发布任务。返回 null = 作品不存在或跨租户（调用方各自翻译）。
 * 抛：DispatchValidationError（INVALID_PLATFORMS/INVALID_CONTENT_TYPE/NO_MATERIALS）
 *   / AlreadyQueuedError（事务外礼貌拦截 + 事务内 CAS 两层，都收敛到它）
 *   / NoActiveAgentError。
 */
export async function dispatchContentPublish(args: {
  contentId: string;
  tenantId: string;
  platformsOverride?: string[];
}): Promise<DispatchResult | null> {
  const { contentId, tenantId, platformsOverride } = args;

  const { rows } = await pool.query(
    `SELECT id, title, body, type, platforms, status
       FROM zenithjoy.contents
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1`,
    [contentId, tenantId],
  );
  const content = rows[0];
  if (!content) return null;

  const platforms: string[] =
    Array.isArray(platformsOverride) && platformsOverride.length > 0
      ? platformsOverride.map(String)
      : (content.platforms as string[] | null) ?? [];
  if (platforms.length === 0) {
    throw new DispatchValidationError('INVALID_PLATFORMS', '未指定发布平台：作品没带 platforms，请求体也没给');
  }
  const illegal = platforms.filter(
    (p) => !(PUBLISH_PLATFORMS as readonly string[]).includes(p),
  );
  if (illegal.length > 0) {
    throw new DispatchValidationError('INVALID_PLATFORMS', `不认识的平台：${illegal.join('、')}`);
  }

  // 去重：同一请求重复平台只拆一条任务
  const uniquePlatforms = [...new Set(platforms)];

  if (!CONTENT_TYPES.includes(content.type)) {
    throw new DispatchValidationError('INVALID_CONTENT_TYPE', `作品形态 ${content.type} 不可派发`);
  }
  // 事务外礼貌拦截（省一次事务）；真防线是下面事务内 CAS
  if (content.status === 'queued') {
    throw new AlreadyQueuedError();
  }

  const agent = await findActiveAgentByTenantId(tenantId);
  if (!agent) {
    throw new NoActiveAgentError();
  }

  const materials = await loadMaterials(contentId);
  if (content.type !== 'article' && materials.length === 0) {
    throw new DispatchValidationError('NO_MATERIALS', '作品没有任何素材，无法发布');
  }

  const client = await pool.connect();
  const tasks: Array<{ id: string; platform: string }> = [];
  let alreadyQueued = false;
  try {
    await client.query('BEGIN');
    // 原子 CAS：两个并发派发同时读到 draft 时，只有一个能把 status 改成 queued。
    const cas = await client.query(
      `UPDATE zenithjoy.contents
          SET status = 'queued', updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND status <> 'queued'
        RETURNING id`,
      [contentId, tenantId],
    );
    if (cas.rowCount === 0) {
      await client.query('ROLLBACK');
      alreadyQueued = true;
    } else {
      for (const platform of uniquePlatforms) {
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
      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  if (alreadyQueued) throw new AlreadyQueuedError();
  return { content_id: contentId, tasks };
}
```

- [ ] **Step 2: route 改薄**

`apps/api/src/routes/publish-dispatch.ts`：
1. 删掉文件内的 `PUBLISH_PLATFORMS`、`CONTENT_TYPES`、`loadMaterials`（GET package 端点还要用 `PublishPackageMaterial` interface——保留该 interface 定义）。
2. import 区加：

```typescript
import {
  dispatchContentPublish,
  AlreadyQueuedError,
  DispatchValidationError,
  NoActiveAgentError,
  PUBLISH_PLATFORMS,
} from '../services/content-publish-dispatch';

// 向后兼容：既有测试/消费方从本模块 import 白名单
export { PUBLISH_PLATFORMS };
```

3. POST /:id/publish 的 try 块整体替换为：

```typescript
    try {
      const bodyPlatforms: unknown = req.body?.platforms;
      const platformsOverride =
        Array.isArray(bodyPlatforms) && bodyPlatforms.length > 0
          ? bodyPlatforms.map(String)
          : undefined;
      const result = await dispatchContentPublish({ contentId, tenantId, platformsOverride });
      if (result === null) {
        fail(res, 404, 'NOT_FOUND', '作品不存在');
        return;
      }
      ok(res, result);
    } catch (err) {
      if (err instanceof AlreadyQueuedError) {
        fail(res, 409, err.code, err.message);
      } else if (err instanceof NoActiveAgentError) {
        fail(res, 409, err.code, err.message);
      } else if (err instanceof DispatchValidationError) {
        fail(res, 400, err.code, err.message);
      } else {
        fail(res, 500, 'DISPATCH_FAILED', err instanceof Error ? err.message : 'unknown');
      }
    }
```

4. `findActiveAgentByTenantId` 若 route 不再直接用则从 import 里删掉。

- [ ] **Step 3: 跑既有测试确认全绿（置换承诺）**

```bash
cd /Users/administrator/worktrees/zenithjoy/session-d5a5065b/apps/api
npx vitest run src/routes/__tests__/publish-dispatch.test.ts src/services/__tests__/get-queued-tasks-exclusion.test.ts 2>&1 | tail -5
npx tsc --noEmit 2>&1 | tail -3
```
Expected: 17 个用例全 PASS、tsc 无错。若有红：多半是测试 mock 面——service 与 route 同用 `vi.mock('../../db/connection')` 与 `vi.mock('../../services/walking-skeleton.service')`（vitest mock 按模块路径全局生效，service 内 import 同样吃到 mock），按红修 service/route，不许改测试断言语义。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/content-publish-dispatch.ts apps/api/src/routes/publish-dispatch.ts
git commit -m "refactor(line01): 派发核心抽 service——route/worker 共用，类型化错误（置换零行为变化，16 测试保绿）"
```

---

### Task 2: notion-client 共享封装

**Files:**
- Create: `apps/api/src/services/notion-client.ts`
- Modify: `apps/api/src/services/notion-crm.ts`（改 import 共享常量与请求封装）
- Test: `apps/api/src/services/__tests__/notion-client.test.ts`（新建）

**Interfaces:**
- Produces: `NOTION_API_BASE`、`NOTION_VERSION`、`getNotionToken()`、`notionRequest<T>(method, path, body?) → Promise<T>`（错误消息只含 status/response.data，绝不带 headers/token）

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/services/__tests__/notion-client.test.ts`：

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Notion 轻客户端契约。最重要的一条：错误里绝不能带 token——
 * AxiosError.config.headers 有 Authorization: Bearer <token>，
 * 谁把整个 err 打进日志谁就泄漏了 workspace 全部数据的钥匙。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => ({ default: { request: vi.fn() } }));
import axios from 'axios';
import { notionRequest, NOTION_API_BASE, NOTION_VERSION } from '../notion-client';

const FAKE_TOKEN = `ntn_test_${Math.floor(Math.random() * 90000) + 10000}`;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTION_INTEGRATION_TOKEN = FAKE_TOKEN;
});
afterEach(() => {
  delete process.env.NOTION_INTEGRATION_TOKEN;
});

describe('notionRequest', () => {
  it('拼装 base/version/鉴权头并返回 data', async () => {
    (axios.request as any).mockResolvedValue({ data: { ok: 1 } });
    const r = await notionRequest('post', '/pages', { a: 1 });
    expect(r).toEqual({ ok: 1 });
    const cfg = (axios.request as any).mock.calls[0][0];
    expect(cfg.url).toBe(`${NOTION_API_BASE}/pages`);
    expect(cfg.headers['Notion-Version']).toBe(NOTION_VERSION);
    expect(cfg.headers.Authorization).toContain(FAKE_TOKEN);
  });

  it('token 未配置 → 抛错且不发请求', async () => {
    delete process.env.NOTION_INTEGRATION_TOKEN;
    await expect(notionRequest('get', '/users/me')).rejects.toThrow('NOTION_INTEGRATION_TOKEN');
    expect(axios.request).not.toHaveBeenCalled();
  });

  it('上游报错 → 错误消息含 status 与 response.data，绝不含 token', async () => {
    (axios.request as any).mockRejectedValue({
      message: 'Request failed',
      response: { status: 400, data: { code: 'validation_error' } },
      config: { headers: { Authorization: `Bearer ${FAKE_TOKEN}` } },
    });
    const err = await notionRequest('patch', '/pages/x', {}).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('400');
    expect(err.message).toContain('validation_error');
    expect(err.message).not.toContain(FAKE_TOKEN);
  });
});
```

- [ ] **Step 2: 跑红**

```bash
cd /Users/administrator/worktrees/zenithjoy/session-d5a5065b/apps/api
npx vitest run src/services/__tests__/notion-client.test.ts 2>&1 | tail -5
```
Expected: FAIL——模块不存在。

- [ ] **Step 3: commit-1**

```bash
git add apps/api/src/services/__tests__/notion-client.test.ts
git commit -m "test(line01): notion-client 契约先行——鉴权头拼装/缺token拒发/错误不泄token（红）"
```

- [ ] **Step 4: 实现 + notion-crm 改造**

创建 `apps/api/src/services/notion-client.ts`：

```typescript
// apps/api/src/services/notion-client.ts
//
// Notion API 轻客户端：常量/鉴权/请求封装的唯一来源（notion-crm 与
// notion-orchestrator 共用——复用即引用，不复制）。
//
// 错误纪律：绝不把原始 AxiosError 往外抛/往日志打——config.headers 里有
// Authorization: Bearer <token>，泄漏即 workspace 全部数据的钥匙。
// 这里统一收敛成只含 method/path/status/response.data 的普通 Error。

import axios from 'axios';

export const NOTION_API_BASE = 'https://api.notion.com/v1';
export const NOTION_VERSION = '2022-06-28';

export function getNotionToken(): string {
  return process.env.NOTION_INTEGRATION_TOKEN || '';
}

export async function notionRequest<T = unknown>(
  method: 'get' | 'post' | 'patch',
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getNotionToken();
  if (!token) {
    throw new Error('NOTION_INTEGRATION_TOKEN 未配置');
  }
  try {
    const resp = await axios.request<T>({
      method,
      url: `${NOTION_API_BASE}${path}`,
      data: body,
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });
    return resp.data;
  } catch (err) {
    const e = err as { message?: string; response?: { status?: number; data?: unknown } };
    const detail = e.response
      ? `${e.response.status} ${JSON.stringify(e.response.data ?? '')}`
      : (e.message ?? 'unknown');
    throw new Error(`Notion API ${method.toUpperCase()} ${path} 失败: ${detail}`.slice(0, 500));
  }
}
```

修改 `apps/api/src/services/notion-crm.ts`：删本地 `NOTION_API_BASE`/`NOTION_VERSION`/`getToken`，改 `import { NOTION_API_BASE, NOTION_VERSION, getNotionToken } from './notion-client';`，三处 axios 调用的 `getToken()` 换成 `getNotionToken()`（axios 调用本身可保留原样，避免动 crm 行为；只收敛常量与 token 读取）。

- [ ] **Step 5: 跑绿 + 全量回归**

```bash
cd /Users/administrator/worktrees/zenithjoy/session-d5a5065b/apps/api
npx vitest run src/services/__tests__/notion-client.test.ts 2>&1 | tail -4
npx vitest run 2>&1 | tail -5
```
Expected: 新测试 3/3 PASS；全量无新增失败（既存 10 个 boot-fail 活体契约失败除外）。

- [ ] **Step 6: commit-2**

```bash
git add apps/api/src/services/notion-client.ts apps/api/src/services/notion-crm.ts
git commit -m "feat(line01): notion-client 共享封装——常量/鉴权/请求收敛一处，错误不泄token（绿）"
```

---

### Task 3: migration + 一次性建库脚本

**Files:**
- Create: `apps/api/db/migrations/20260909_113000_contents_notion_page_id.sql`
- Create: `apps/api/scripts/create-notion-orchestrator-db.mjs`

**Interfaces:**
- Produces: `contents.notion_page_id TEXT`；建库脚本输出 `NOTION_PUBLISH_ORCH_DB_ID`

- [ ] **Step 1: migration**

创建 `apps/api/db/migrations/20260909_113000_contents_notion_page_id.sql`：

```sql
-- contents 加 notion_page_id：Notion 发布编排台推送锚（NULL=尚未推送）。
-- 全部 DDL 幂等（CI glob runner 全量重放）；不包 BEGIN/COMMIT（run-migration.ts 外层有事务）。

ALTER TABLE zenithjoy.contents ADD COLUMN IF NOT EXISTS notion_page_id TEXT;

-- 推送方向查询走这个部分索引：WHERE tenant_id=$1 AND notion_page_id IS NULL AND status='draft'
CREATE INDEX IF NOT EXISTS idx_contents_notion_pending
  ON zenithjoy.contents (tenant_id)
  WHERE notion_page_id IS NULL;

COMMENT ON COLUMN zenithjoy.contents.notion_page_id IS 'Notion 发布编排台行(page) id；NULL=尚未推送到 Notion';
```

- [ ] **Step 2: 建库脚本**

创建 `apps/api/scripts/create-notion-orchestrator-db.mjs`（chmod +x）：

```javascript
#!/usr/bin/env node
// 一次性：在 AI Hub 根页下创建「发布编排台」database，预置全部 select options。
// 用法：NOTION_INTEGRATION_TOKEN=... node create-notion-orchestrator-db.mjs
// 输出 database id → 填进 staging env 的 NOTION_PUBLISH_ORCH_DB_ID。

const TOKEN = process.env.NOTION_INTEGRATION_TOKEN;
const PARENT_PAGE = process.env.NOTION_ORCH_PARENT_PAGE || 'ae1c40c2-ba63-82ef-a798-8177341c5305';
if (!TOKEN) { console.error('缺 NOTION_INTEGRATION_TOKEN'); process.exit(1); }

const PLATFORMS = ['douyin','xiaohongshu','kuaishou','toutiao','weibo','bilibili','shipinhao','zhihu','wechat'];
const STATUSES = ['草稿','发','排队中','已发','部分失败','派发失败'];

const resp = await fetch('https://api.notion.com/v1/databases', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    parent: { type: 'page_id', page_id: PARENT_PAGE },
    title: [{ type: 'text', text: { content: '发布编排台' } }],
    properties: {
      '标题': { title: {} },
      '文案': { rich_text: {} },
      '平台': { multi_select: { options: PLATFORMS.map((name) => ({ name })) } },
      '形态': { select: { options: [{ name: 'image' }, { name: 'video' }, { name: 'article' }] } },
      '状态': { select: { options: STATUSES.map((name) => ({ name })) } },
      '素材': { rich_text: {} },
      '预览': { url: {} },
      '回执': { rich_text: {} },
      'content_id': { rich_text: {} },
    },
  }),
});
const data = await resp.json();
if (!resp.ok) { console.error('建库失败:', resp.status, JSON.stringify(data)); process.exit(1); }
console.log('发布编排台已创建');
console.log('NOTION_PUBLISH_ORCH_DB_ID=' + data.id);
```

- [ ] **Step 3: 语法检查 + commit**

```bash
node --check apps/api/scripts/create-notion-orchestrator-db.mjs && echo "语法 OK"
git add apps/api/db/migrations/20260909_113000_contents_notion_page_id.sql apps/api/scripts/create-notion-orchestrator-db.mjs
git commit -m "feat(line01): contents.notion_page_id migration + 发布编排台一次性建库脚本"
```

---

### Task 4: notion-orchestrator 同步 worker（TDD 主战场）

**Files:**
- Create: `apps/api/src/services/notion-orchestrator.ts`
- Modify: `apps/api/src/index.ts`（:82 附近挂载）
- Test: `apps/api/src/services/__tests__/notion-orchestrator.test.ts`

**Interfaces:**
- Consumes: Task 1 `dispatchContentPublish`+错误类、Task 2 `notionRequest`、`pool`、`createMaterialStorage`（预览签名，deps 注入可换 InMemory）、Task 1 `PUBLISH_PLATFORMS`
- Produces: `startNotionOrchestrator(intervalMs?) → NodeJS.Timeout | null`（env 不齐 return null）、`stopNotionOrchestrator(t)`、`runOnce(env, deps?)`（导出供测试）
- 终态判定：`NON_TERMINAL = ['pending','queued','dispatched','running']`，实现时对照 `apps/api/db/migrations/20260511_102431_publish_tasks_status_enum_full.sql` 的 9 值枚举核准（非终态集合以该文件为准，发现出入改常量并在报告注明）

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/services/__tests__/notion-orchestrator.test.ts`：

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 编排台同步器契约：三方向（推行/拉发/回执）+ 启动自检。
 * 真相在 DB，Notion 只是视图——所以锚失效跳过不猜、白名单不信 Notion 手加 option、
 * 回执写完必须把 contents 挪出 queued（否则每 60s 重写 + 作品永锁）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../notion-client', () => ({ notionRequest: vi.fn() }));
vi.mock('../content-publish-dispatch', async () => {
  const actual = await vi.importActual<any>('../content-publish-dispatch');
  return {
    ...actual, // 保留错误类（worker 要 instanceof）与 PUBLISH_PLATFORMS
    dispatchContentPublish: vi.fn(),
  };
});

import pool from '../../db/connection';
import { notionRequest } from '../notion-client';
import {
  dispatchContentPublish,
  AlreadyQueuedError,
  NoActiveAgentError,
} from '../content-publish-dispatch';
import { InMemoryMaterialStorage } from '../material-storage';
import { runOnce, startNotionOrchestrator } from '../notion-orchestrator';

const TENANT = 'b0058fb7-645d-4d2b-ab25-8d9d4a764b29';
const CID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ENV = { dbId: 'db-1', tenantId: TENANT };
const deps = () => ({ storage: new InMemoryMaterialStorage() });

/** page 对象构造器：拉发方向 query 返回的行 */
function notionRow(over: any = {}) {
  return {
    id: 'page-1',
    properties: {
      '标题': { title: [{ plain_text: '新标题' }] },
      '文案': { rich_text: [{ plain_text: '新文案' }] },
      '平台': { multi_select: [{ name: 'douyin' }, { name: 'weibo' }] },
      'content_id': { rich_text: [{ plain_text: CID }] },
      ...over,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (pool.query as any).mockResolvedValue({ rows: [] });
  (notionRequest as any).mockImplementation(async (_m: string, path: string) => {
    if (path.includes('/query')) return { results: [], has_more: false };
    return { id: 'page-new' };
  });
});

describe('启动自检', () => {
  it('缺 env → 红日志 + 返回 null 不启动', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.NOTION_INTEGRATION_TOKEN;
    delete process.env.NOTION_PUBLISH_ORCH_DB_ID;
    const t = startNotionOrchestrator();
    expect(t).toBeNull();
    expect(spy.mock.calls.flat().join(' ')).toContain('[notion-orch]');
    spy.mockRestore();
  });
});

describe('方向A 推行（作品→Notion）', () => {
  it('draft 且 notion_page_id 为空的作品 → 建行并回写 page id', async () => {
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/FROM zenithjoy\.contents/i.test(sql) && /notion_page_id IS NULL/i.test(sql)) {
        return { rows: [{ id: CID, title: '治愈色', body: '文案', type: 'image', platforms: ['douyin'] }] };
      }
      if (/FROM zenithjoy\.content_materials/i.test(sql)) {
        return { rows: [{ file_name: 'a.jpg', storage_key: 'k/a.jpg' }] };
      }
      return { rows: [] };
    });
    await runOnce(ENV, deps());
    const createCall = (notionRequest as any).mock.calls.find((c: any[]) => c[1] === '/pages');
    expect(createCall).toBeTruthy();
    const props = createCall[2].properties;
    expect(props['标题'].title[0].text.content).toBe('治愈色');
    expect(props['状态'].select.name).toBe('草稿');
    expect(props['content_id'].rich_text[0].text.content).toBe(CID);
    const upd = (pool.query as any).mock.calls.find((c: any[]) => /SET notion_page_id/i.test(c[0]));
    expect(upd).toBeTruthy();
    expect(upd[1]).toContain(CID);
  });
});

describe('方向B 拉发（状态=发）', () => {
  function stubFireRow(row: any) {
    (notionRequest as any).mockImplementation(async (_m: string, path: string) => {
      if (path.includes('/query')) return { results: [row], has_more: false };
      return { id: 'x' };
    });
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/FROM zenithjoy\.contents/i.test(sql)) return { rows: [{ id: CID }] };
      return { rows: [] };
    });
  }

  it('合法行 → 回写标题文案平台 + dispatch + 行置排队中', async () => {
    stubFireRow(notionRow());
    (dispatchContentPublish as any).mockResolvedValue({ content_id: CID, tasks: [{ id: 't1', platform: 'douyin' }, { id: 't2', platform: 'weibo' }] });
    await runOnce(ENV, deps());
    const upd = (pool.query as any).mock.calls.find((c: any[]) => /UPDATE zenithjoy\.contents/i.test(c[0]) && /SET title/i.test(c[0]));
    expect(upd).toBeTruthy();
    expect(dispatchContentPublish).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: CID, tenantId: TENANT, platformsOverride: ['douyin', 'weibo'] }),
    );
    const patch = (notionRequest as any).mock.calls.find((c: any[]) => c[1] === '/pages/page-1');
    expect(patch[2].properties['状态'].select.name).toBe('排队中');
  });

  it('Notion 手加的非法平台被白名单过滤，不进 dispatch', async () => {
    stubFireRow(notionRow({ '平台': { multi_select: [{ name: 'douyin' }, { name: 'myspace' }] } }));
    (dispatchContentPublish as any).mockResolvedValue({ content_id: CID, tasks: [{ id: 't1', platform: 'douyin' }] });
    await runOnce(ENV, deps());
    expect(dispatchContentPublish).toHaveBeenCalledWith(
      expect.objectContaining({ platformsOverride: ['douyin'] }),
    );
  });

  it('content_id 非 UUID → 锚失效：行置派发失败，dispatch 不被调', async () => {
    stubFireRow(notionRow({ 'content_id': { rich_text: [{ plain_text: 'not-a-uuid' }] } }));
    await runOnce(ENV, deps());
    expect(dispatchContentPublish).not.toHaveBeenCalled();
    const patch = (notionRequest as any).mock.calls.find((c: any[]) => c[1] === '/pages/page-1');
    expect(patch[2].properties['状态'].select.name).toBe('派发失败');
  });

  it('AlreadyQueued → 幂等成功：行置排队中', async () => {
    stubFireRow(notionRow());
    (dispatchContentPublish as any).mockRejectedValue(new AlreadyQueuedError());
    await runOnce(ENV, deps());
    const patch = (notionRequest as any).mock.calls.find((c: any[]) => c[1] === '/pages/page-1');
    expect(patch[2].properties['状态'].select.name).toBe('排队中');
  });

  it('NoActiveAgent → 行置派发失败且回执含人话原因', async () => {
    stubFireRow(notionRow());
    (dispatchContentPublish as any).mockRejectedValue(new NoActiveAgentError());
    await runOnce(ENV, deps());
    const patch = (notionRequest as any).mock.calls.find((c: any[]) => c[1] === '/pages/page-1');
    expect(patch[2].properties['状态'].select.name).toBe('派发失败');
    expect(patch[2].properties['回执'].rich_text[0].text.content).toContain('agent');
  });
});

describe('方向C 回执（任务终态→Notion）', () => {
  function stubQueuedContent(taskRows: any[]) {
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/status = 'queued'/i.test(sql) && /notion_page_id IS NOT NULL/i.test(sql)) {
        return { rows: [{ id: CID, notion_page_id: 'page-1' }] };
      }
      if (/FROM zenithjoy\.publish_tasks/i.test(sql)) return { rows: taskRows };
      return { rows: [] };
    });
  }

  it('全部 done → 行状态已发 + contents 置 published', async () => {
    stubQueuedContent([
      { platform: 'douyin', status: 'done', result: null },
      { platform: 'weibo', status: 'done', result: null },
    ]);
    await runOnce(ENV, deps());
    const patch = (notionRequest as any).mock.calls.find((c: any[]) => c[1] === '/pages/page-1');
    expect(patch[2].properties['状态'].select.name).toBe('已发');
    const upd = (pool.query as any).mock.calls.find((c: any[]) => /SET status = 'published'/i.test(c[0]));
    expect(upd).toBeTruthy();
  });

  it('有 failed → 部分失败 + contents 置 failed；回执截断 ≤1900', async () => {
    stubQueuedContent([
      { platform: 'douyin', status: 'done', result: null },
      { platform: 'weibo', status: 'failed', result: { error: 'x'.repeat(3000) } },
    ]);
    await runOnce(ENV, deps());
    const patch = (notionRequest as any).mock.calls.find((c: any[]) => c[1] === '/pages/page-1');
    expect(patch[2].properties['状态'].select.name).toBe('部分失败');
    expect(patch[2].properties['回执'].rich_text[0].text.content.length).toBeLessThanOrEqual(1900);
    const upd = (pool.query as any).mock.calls.find((c: any[]) => /SET status = 'failed'/i.test(c[0]));
    expect(upd).toBeTruthy();
  });

  it('还有任务未终态 → 不写回执不改状态', async () => {
    stubQueuedContent([
      { platform: 'douyin', status: 'done', result: null },
      { platform: 'weibo', status: 'dispatched', result: null },
    ]);
    await runOnce(ENV, deps());
    const patch = (notionRequest as any).mock.calls.find((c: any[]) => c[1] === '/pages/page-1');
    expect(patch).toBeFalsy();
  });
});
```

- [ ] **Step 2: 跑红**

```bash
cd /Users/administrator/worktrees/zenithjoy/session-d5a5065b/apps/api
npx vitest run src/services/__tests__/notion-orchestrator.test.ts 2>&1 | tail -5
```
Expected: FAIL——模块不存在。

- [ ] **Step 3: commit-1**

```bash
git add apps/api/src/services/__tests__/notion-orchestrator.test.ts
git commit -m "test(line01): 编排台同步器契约先行——推行/拉发/回执/自检十用例（红）"
```

- [ ] **Step 4: 实现 worker**

创建 `apps/api/src/services/notion-orchestrator.ts`（按测试契约实现，骨架要点）：

```typescript
// apps/api/src/services/notion-orchestrator.ts
//
// Notion 发布编排台同步器（line01 刀2）。真相在中台 DB，Notion 只是主理人
// 的私人写作台视图——所以：锚失效跳过不猜；平台读回必过白名单（不信
// Notion 手加 option）；回执写完必须把 contents 挪出 queued（否则每轮重写
// 且作品被 CAS 永锁）。
//
// 骨架照 worker-lease-sweeper：setInterval + catch 不逃逸 + unref；
// 额外 running 互斥（Notion 慢时一轮 >60s 防 tick 重叠）。
// 日志纪律：绝不打整个错误对象（AxiosError.config.headers 带 token），
// notion-client 已收敛错误，本文件 catch 只打 err.message。

import pool from '../db/connection';
import { notionRequest } from './notion-client';
import {
  dispatchContentPublish,
  AlreadyQueuedError,
  NoActiveAgentError,
  DispatchValidationError,
  PUBLISH_PLATFORMS,
} from './content-publish-dispatch';
import { createMaterialStorage, type MaterialStorage } from './material-storage';

const LOG = '[notion-orch]';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 对照 20260511_102431_publish_tasks_status_enum_full.sql 核准（实现时验证） */
const NON_TERMINAL = ['pending', 'queued', 'dispatched', 'running'];
const RT_LIMIT = 1900;

export interface OrchEnv { dbId: string; tenantId: string; }
export interface OrchDeps { storage?: MaterialStorage; }

function rt(s: string) {
  return [{ type: 'text', text: { content: s.slice(0, RT_LIMIT) } }];
}
function plain(prop: any): string {
  const arr = prop?.title ?? prop?.rich_text ?? [];
  return arr.map((x: any) => x.plain_text ?? x?.text?.content ?? '').join('');
}
async function markRow(pageId: string, status: string, receipt?: string) {
  const properties: Record<string, unknown> = { '状态': { select: { name: status } } };
  if (receipt !== undefined) properties['回执'] = { rich_text: rt(receipt) };
  await notionRequest('patch', `/pages/${pageId}`, { properties });
}

// 方向A：draft 且未推送的作品 → 建 Notion 行
async function pushNewContents(env: OrchEnv, storage: MaterialStorage) { /* 按测试契约实现 */ }
// 方向B：状态='发' 的行（databases/{id}/query 分页 while has_more）→ 回写+派发
async function pullFireRows(env: OrchEnv) { /* 按测试契约实现 */ }
// 方向C：queued 且有行锚的作品 → 全任务终态才写回执 + contents 挪出 queued
async function syncReceipts(env: OrchEnv) { /* 按测试契约实现 */ }

export async function runOnce(env: OrchEnv, deps: OrchDeps = {}) {
  const storage = deps.storage ?? createMaterialStorage();
  await pushNewContents(env, storage);
  await pullFireRows(env);
  await syncReceipts(env);
}

export function startNotionOrchestrator(intervalMs = 60_000): NodeJS.Timeout | null {
  const token = process.env.NOTION_INTEGRATION_TOKEN;
  const dbId = process.env.NOTION_PUBLISH_ORCH_DB_ID;
  const tenantId = process.env.NOTION_ORCH_TENANT_ID;
  const missing = [
    !token && 'NOTION_INTEGRATION_TOKEN',
    !dbId && 'NOTION_PUBLISH_ORCH_DB_ID',
    !tenantId && 'NOTION_ORCH_TENANT_ID',
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`${LOG} 未配置(${missing.join('/')})，跳过启动——编排台同步不可用`);
    return null;
  }
  const env: OrchEnv = { dbId: dbId as string, tenantId: tenantId as string };
  let running = false;
  const t = setInterval(() => {
    if (running) return; // 上一轮未完，跳过本轮
    running = true;
    runOnce(env)
      .catch((e) => console.error(`${LOG} tick error:`, e instanceof Error ? e.message : String(e)))
      .finally(() => { running = false; });
  }, intervalMs);
  t.unref();
  console.info(`${LOG} 已启动（间隔 ${intervalMs}ms，tenant ${env.tenantId.slice(0, 8)}）`);
  return t;
}

export function stopNotionOrchestrator(t: NodeJS.Timeout): void {
  clearInterval(t);
}
```

三个方向的实现细节按 Task 4 Step 1 测试逐条对齐（测试即契约）：
- 推行 SQL：`SELECT id, title, body, type, platforms FROM zenithjoy.contents WHERE tenant_id = $1 AND notion_page_id IS NULL AND status = 'draft' ORDER BY created_at ASC LIMIT 20`；每个作品查素材文件名（loadMaterials 同款 SQL 只取 file_name/storage_key）、首个素材签预览 URL；建页 properties 全集（标题/文案/平台过白名单/形态/状态=草稿/素材=文件名顿号连接/预览/content_id）；回写 `UPDATE zenithjoy.contents SET notion_page_id = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3`。单个作品失败：`console.error(LOG, content.id, err.message)` 继续下一个。
- 拉发 query：`POST /databases/${env.dbId}/query` body `{filter: {property: '状态', select: {equals: '发'}}, page_size: 100, start_cursor?}` while has_more；行处理错误翻译表照 spec（AlreadyQueued→排队中(幂等)；NoActiveAgent/DispatchValidation→派发失败+err.message；dispatch 返回 null→派发失败+'锚失效：作品不存在或不属于本租户'；其他异常→只 console.error message，行保持'发'下轮重试）。
- 回执 SQL：`SELECT id, notion_page_id FROM zenithjoy.contents WHERE tenant_id = $1 AND status = 'queued' AND notion_page_id IS NOT NULL`；任务查询 `SELECT platform, status, result FROM zenithjoy.publish_tasks WHERE task_type = 'content_publish' AND tenant_id = $1 AND payload->>'content_id' = $2`；`tasks.length === 0` 跳过（派发进行中）；全非 NON_TERMINAL 才动作；回执行文案 `${platform} ${status === 'done' ? '✅' : '❌ ' + JSON.stringify(result ?? '')}` 以 ` / ` 连接；contents 置 `published`（全 done）或 `failed`。

修改 `apps/api/src/index.ts`：import 区加 `import { startNotionOrchestrator } from './services/notion-orchestrator';`，`if (!process.env.VITEST) startWorkerLeaseSweeper();`（:82）下一行加 `if (!process.env.VITEST) startNotionOrchestrator();`。

- [ ] **Step 5: 跑绿 + tsc**

```bash
cd /Users/administrator/worktrees/zenithjoy/session-d5a5065b/apps/api
npx vitest run src/services/__tests__/notion-orchestrator.test.ts 2>&1 | tail -5
npx tsc --noEmit 2>&1 | tail -3
```
Expected: 10 用例全 PASS，tsc 无错。

- [ ] **Step 6: commit-2**

```bash
git add apps/api/src/services/notion-orchestrator.ts apps/api/src/index.ts
git commit -m "feat(line01): Notion 编排台同步器——推行/拉发/回执三方向 60s 轮询（绿）"
```

---

### Task 5: smoke + 基线

**Files:**
- Create: `.github/workflows/scripts/smoke/notion-orchestrator-selfcheck-smoke.sh`
- Modify: `.github/workflows/scripts/smoke-baseline.txt`（字母序插入）

- [ ] **Step 1: smoke 脚本**

创建 `.github/workflows/scripts/smoke/notion-orchestrator-selfcheck-smoke.sh`（chmod +x）：

```bash
#!/usr/bin/env bash
# 编排台同步器启动自检 smoke：CI 环境没有 NOTION_* env，
# 断言 API 进程照常活着（缺配置=红日志跳过启动，绝不 crash 拖垮整个中台）。
# 真正的 Notion 双向同步是环境接缝（真 Notion API），CI 测不到——
# 由 vitest（mock 契约 10 用例）+ 合并后 staging 真验兜住。
set -euo pipefail
API_BASE="${API_BASE:-http://localhost:5200}"
fail() { echo "❌ $*"; exit 1; }

echo "[1] 无 NOTION env 下 API 健康"
C=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/api/health")
[ "$C" = "200" ] || fail "/api/health expected 200 got $C"

echo "[2] 派发路由仍在（worker 与 route 共用 service 未破坏 HTTP 面）"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/contents/00000000-0000-4000-8000-000000000000/publish")
[ "$C" = "401" ] || fail "无凭据派发 expected 401 got $C"

echo "✅ notion-orchestrator selfcheck smoke PASS"
```

- [ ] **Step 2: 进基线 + commit**

`.github/workflows/scripts/smoke-baseline.txt` 按字母序插入一行 `notion-orchestrator-selfcheck-smoke.sh`（在 `material-upload-smoke.sh` 之后的 n 区段，按实际字母序定位）。

```bash
bash -n .github/workflows/scripts/smoke/notion-orchestrator-selfcheck-smoke.sh && echo "语法 OK"
git add .github/workflows/scripts/smoke/notion-orchestrator-selfcheck-smoke.sh .github/workflows/scripts/smoke-baseline.txt
git commit -m "test(line01): 编排台自检 smoke 进 CI 基线——缺 env 不炸中台"
```

---

### Task 6: 全量验证

- [ ] **Step 1:**

```bash
cd /Users/administrator/worktrees/zenithjoy/session-d5a5065b/apps/api
npx vitest run 2>&1 | tail -6
npx tsc --noEmit 2>&1 | tail -3
npx eslint src/services/content-publish-dispatch.ts src/services/notion-client.ts src/services/notion-orchestrator.ts src/services/__tests__/notion-client.test.ts src/services/__tests__/notion-orchestrator.test.ts 2>&1 | tail -4
```
Expected: 除既存 10 个 boot-fail 活体契约失败外无红；tsc/eslint 干净。两个新测试文件与新 smoke 记得入册 test-registry.yaml + 上一task已入 smoke-baseline（Orphan Test Check 闸）——本 step 顺手把 `publish-dispatch` 区段旁按同格式补两条 test-registry 条目并 commit：

```bash
git add test-registry.yaml && git commit -m "chore(line01): 刀2 新测试入册 test-registry"
```

---

## 合并后（不在本计划，由控制者执行）

手跑建库脚本得 DB id → staging `/opt/zenithjoy/staging-api/.env` 追加三个 NOTION env → `docker restart zenithjoy-api-staging` → PrepPRD 四条验收真验（ZJ-E-ALEX5211）。
