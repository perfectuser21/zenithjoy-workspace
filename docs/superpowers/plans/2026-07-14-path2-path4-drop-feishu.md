# Path2+Path4 彻底去飞书改本地 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 Path2（智能获客）和 Path4（私域AI接管）里已经被本地实现取代或从未验证过的飞书 Bitable 依赖代码，Path4 朋友圈草稿的营销画像/内容排期改用本地数据库。

**Architecture:** Path4 一侧新增一张本地表承接原飞书"营销画像"数据，`generateMomentDraft` 改成纯 SQL 读写；Path2 一侧删除已被 `acquisition.ts` / `AcquisitionHubPage` 取代的整条飞书 Bitable 服务链（服务、路由、前端页面、导航条目）。

**Tech Stack:** Node.js/TypeScript (Express + pg)，Vitest，React (Dashboard)，PostgreSQL 迁移用裸 `.sql` 文件放 `apps/api/db/migrations/`（文件名格式 `YYYYMMDD_HHMMSS_描述.sql`，`run-migration.ts` 按文件名排序执行）。

## Global Constraints
- 所有输出/注释简体中文
- 每个 task 严格两 commit：commit-1 写 failing test，commit-2 写最小实现让 test 变绿
- 不改动 `feishu-oauth.ts`/`feishu-token.ts`/`tenant-context.ts` 的 `feishu_user_id` 身份识别逻辑
- 不改动 `lead-writer.ts` 的 `writeDmOutreachStatus` 及其在 `agent-burner.ts` 里的调用
- 不改动 `feishu-bitable.ts`（单租户版，对标视频表）
- `wechat_publish_task.approval_source` 列当前是 `NOT NULL`，`generateMomentDraft` 传 `null` 这个预置行为在原代码里就会被 catch 吞掉（silent fail）——本次不修这个既有 bug，维持原样行为，只搬迁数据源

---

### Task 1: 新建本地表 wechat_marketing_profile

**Files:**
- Create: `apps/api/db/migrations/20260714_150000_create_wechat_marketing_profile.sql`
- Test: `apps/api/db/migrations/__tests__/20260714_150000_create_wechat_marketing_profile.test.ts`（若仓库里其它迁移没有配套 ts 测试，改用下面的手动验证方式，不新建这个测试文件——详见 Step 1 判断）

**Interfaces:**
- Produces: 表 `zenithjoy.wechat_marketing_profile(id UUID PK, tenant_id UUID NOT NULL, customer TEXT NOT NULL, industry TEXT, audience TEXT, hook TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`，唯一索引 `(tenant_id, customer)`，供 Task 2 的 `generateMomentDraft` SELECT 使用

- [ ] **Step 1: 确认迁移测试约定**

```bash
ls apps/api/db/migrations/__tests__/ 2>/dev/null | head -5
```

如果目录不存在或为空，说明本仓库迁移文件不配单独 ts 测试，改用 Task 2 的 vitest（会真的 INSERT/SELECT 这张表）作为本表的验证载体，跳过下面 Step 2-3，直接进 Step 4 写迁移文件。如果目录存在且有类似文件，参照其格式补一个对应测试。

- [ ] **Step 2（若适用）：写 failing 测试**

（仅当 Step 1 发现有此类测试约定时才做，参照现有同目录测试文件格式，断言表存在 + 唯一索引存在）

- [ ] **Step 3（若适用）：跑测试确认 FAIL**

- [ ] **Step 4: 写迁移文件**

```sql
-- apps/api/db/migrations/20260714_150000_create_wechat_marketing_profile.sql
-- Path4 朋友圈草稿营销画像本地化——替代原飞书"营销画像"Bitable 表（决策 19e6480c）
--
-- generateMomentDraft 原来 SELECT 飞书 Bitable 拿 行业/受众/钩子文案 三字段，
-- 本迁移建本地表承接同样三字段，供 wechat-draft.ts 直接 SQL 读写。

CREATE TABLE IF NOT EXISTS zenithjoy.wechat_marketing_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  customer TEXT NOT NULL,
  industry TEXT,
  audience TEXT,
  hook TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wechat_marketing_profile_tenant_customer
  ON zenithjoy.wechat_marketing_profile (tenant_id, customer);
```

- [ ] **Step 5: 本地跑一次迁移验证语法正确**

```bash
cd apps/api && npx ts-node db/migrations/run-migration.ts 2>&1 | tail -20
```
Expected: 输出包含新迁移文件名执行成功，或 "All migrations already applied"（若已跑过）；不应有 SQL 语法错误。

- [ ] **Step 6: Commit**

```bash
git add apps/api/db/migrations/20260714_150000_create_wechat_marketing_profile.sql
git commit -m "feat(db): 新建 wechat_marketing_profile 本地表——Path4朋友圈草稿营销画像去飞书地基"
```

---

### Task 2: generateMomentDraft 改读本地表 + 删除飞书调用

**Files:**
- Modify: `apps/api/src/services/wechat-draft.ts`
- Modify: `apps/api/src/services/__tests__/wechat-draft-schema-prefix.test.ts`
- Modify: `apps/api/src/routes/wechat.ts`（唯一调用方，signature 变了必须同步改，见 Step 4.5）

**Interfaces:**
- Consumes: Task 1 的表 `zenithjoy.wechat_marketing_profile(tenant_id, customer, industry, audience, hook)`
- Produces: `generateMomentDraft(params: GenerateMomentDraftParams & { tenant_id: string })` — 注意新增 `tenant_id` 必填参数（原飞书版本没有租户概念，本地表按租户隔离，调用方需要传）

- [ ] **Step 1: 读现状，定位待删代码的精确行号**

```bash
grep -n "FEISHU\|feishu\|searchTable\|createRecord\|cachedToken" apps/api/src/services/wechat-draft.ts
```
记录所有命中行号，用于 Step 4 精确删除。

- [ ] **Step 2: 在测试文件里写 failing test（本地表驱动，不 mock 飞书）**

打开 `apps/api/src/services/__tests__/wechat-draft-schema-prefix.test.ts`，找到原来 mock 飞书 axios 的 `beforeEach`（约第 88-96 行，`process.env.FEISHU_APP_ID = 'mock_app_id'` 那一段）和朋友圈相关的测试用例，改写为：

```typescript
// 替换原 FEISHU_* env 注入为直接 seed 本地表
beforeEach(async () => {
  queryMock.mockReset();
  vi.mocked(callOpenRouter).mockResolvedValue({ content: '好的，已收到' } as any);
});

describe('generateMomentDraft — 本地表驱动', () => {
  it('本地画像存在 → 生成成功，不再调用 axios', async () => {
    queryMock.mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes('FROM zenithjoy.wechat_marketing_profile')) {
        return Promise.resolve({
          rows: [{ industry: '教育', audience: '家长', hook: '不打骂也能让孩子主动写作业' }],
        });
      }
      if (sql.includes('SELECT task_id FROM zenithjoy.wechat_publish_task')) {
        return Promise.resolve({ rows: [] }); // 未生成过
      }
      if (sql.includes('INSERT INTO zenithjoy.wechat_publish_task')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
    vi.mocked(callOpenRouter).mockResolvedValue({ content: '家长们，作业难题有救了～' } as any);

    const result = await generateMomentDraft({ tenant_id: 'tenant-1', customer: '画像客户_1' });

    expect(result.ok).toBe(true);
    expect(mockedPost).not.toHaveBeenCalled(); // 不再调飞书 axios
  });

  it('本地画像不存在 → profile_missing', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('FROM zenithjoy.wechat_marketing_profile')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await generateMomentDraft({ tenant_id: 'tenant-1', customer: '无画像客户' });

    expect(result).toEqual({ ok: false, reason: 'profile_missing' });
  });
});
```

（`queryMock` 变量名需与文件顶部 `vi.mock('../../db/connection', ...)` 里暴露的 mock 引用一致，若文件里已有 `queryMock` 命名直接复用；若没有，从 `import pool from '../../db/connection'; const queryMock = vi.mocked(pool.query);` 取得。）

- [ ] **Step 3: 跑测试确认 FAIL**

```bash
cd apps/api && npx vitest run src/services/__tests__/wechat-draft-schema-prefix.test.ts -t "本地表驱动"
```
Expected: FAIL（`generateMomentDraft` 目前还在调 `getProfileTableId`/`searchTable`，函数签名也没有 `tenant_id` 参数，SQL 断言不会匹配）

- [ ] **Step 4: 实现——删除飞书代码，改本地 SQL**

在 `apps/api/src/services/wechat-draft.ts` 删除：
- `const FEISHU_API_BASE = ...` 常量
- `getFeishuAppId` / `getFeishuAppSecret` / `getAppToken` / `getProfileTableId` / `getScheduleTableId` 五个函数
- `cachedToken` 变量 + `_resetFeishuTokenCache` + `getFeishuTenantToken` 函数
- `FeishuRecord` / `FeishuSearchResp` / `FeishuCreateRecordResp` 三个 interface
- `searchTable` / `createRecord` 两个函数

`generateMomentDraft` 改写为：

```typescript
export interface GenerateMomentDraftParams {
  tenant_id: string;
  customer: string;
}

export async function generateMomentDraft(
  params: GenerateMomentDraftParams,
): Promise<GenerateMomentDraftResult> {
  const { tenant_id, customer } = params;

  // 1) 本地"营销画像"表查 3 字段
  let industry = '';
  let audience = '';
  let hook = '';
  try {
    const profileResult = await pool.query(
      `SELECT industry, audience, hook FROM zenithjoy.wechat_marketing_profile
        WHERE tenant_id = $1 AND customer = $2
        LIMIT 1`,
      [tenant_id, customer],
    );
    if (!profileResult.rows || profileResult.rows.length === 0) {
      return { ok: false, reason: 'profile_missing' };
    }
    industry = String(profileResult.rows[0].industry ?? '').trim();
    audience = String(profileResult.rows[0].audience ?? '').trim();
    hook = String(profileResult.rows[0].hook ?? '').trim();
  } catch (err) {
    console.warn('[wechat-draft] 营销画像 SELECT 失败，按 profile_missing 处理:', err);
    return { ok: false, reason: 'profile_missing' };
  }
  if (!industry || !audience || !hook) {
    return { ok: false, reason: 'profile_missing' };
  }

  // 2) 当日去重（CURRENT_DATE 比对 created_at::date）
  try {
    const dupResult = await pool.query(
      `SELECT task_id FROM zenithjoy.wechat_publish_task
        WHERE type = $1
          AND target_user = $2
          AND created_at::date = CURRENT_DATE
        LIMIT 1`,
      ['moment', customer],
    );
    if (dupResult.rows && dupResult.rows.length > 0) {
      return { ok: false, reason: 'already_generated_today' };
    }
  } catch (err) {
    console.warn('[wechat-draft] 当日去重 SELECT 失败，放行生成:', err);
  }

  // 3) 拼 prompt → 调 OpenRouter DeepSeek
  const prompt = buildMomentPrompt({ industry, audience, hook });
  let aiContent = '';
  let aiError: string | null = null;
  const cs = csLlm();
  try {
    const result = await callOpenRouter({
      prompt,
      model: cs.model,
      baseUrl: cs.baseUrl,
      apiKey: cs.apiKey,
      maxTokens: cs.maxTokens,
      purpose: 'wechat_moment_draft',
    });
    aiContent = (result.content || '').trim();
    if (!aiContent) {
      aiError = `${cs.model} 返回空文本`;
      aiContent = FAIL_PLACEHOLDER;
    }
  } catch (err) {
    aiError = err instanceof Error ? err.message : String(err);
    aiContent = FAIL_PLACEHOLDER;
  }

  // 4) 写 DB wechat_publish_task：type='moment'，approval_status='pending_review'，approval_source NULL
  const taskId = crypto.randomUUID();
  const generatedAt = Date.now();
  try {
    await pool.query(
      `INSERT INTO zenithjoy.wechat_publish_task
        (task_id, platform, type, target_user, content_draft, approval_status, approval_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [taskId, 'wechat_personal', 'moment', customer, aiContent, 'pending_review', null],
    );
  } catch (err) {
    console.warn('[wechat-draft] DB INSERT wechat_publish_task (moment) 失败:', err);
  }

  if (aiError) {
    console.warn('[wechat-draft] AI 朋友圈草稿生成失败 fallback 占位:', aiError);
  }

  return { ok: true, status: 'pending_review', task_id: taskId, draft_id: '' };
}
```

同时删除文件头部注释里"朋友圈（generateMomentDraft）仍在飞书…"那句话，改成：

```typescript
/**
 * 朋友圈（generateMomentDraft）营销画像已改本地表 zenithjoy.wechat_marketing_profile（决策 19e6480c，2026-07-14 去飞书）。
 */
```

同时检查文件里 `generatedAt` 变量若不再被使用要删掉（原代码 `createRecord` 用它作为字段值，本地版不再需要，除非 `wechat_publish_task` 有对应列想存，没有则删除该变量声明）。

- [ ] **Step 4.5: 更新调用方 wechat.ts:260（signature 变了，必须同步改）**

`apps/api/src/routes/wechat.ts` 的 `/api/wechat/scheduler-tick` 路由里，`tenantId` 已经在同一作用域内（Step 200-240 行区间已从租户上下文取到），把：

```typescript
const result = await generateMomentDraft({ customer: c });
```

改成：

```typescript
const result = await generateMomentDraft({ tenant_id: tenantId, customer: c });
```

- [ ] **Step 5: 跑测试确认 PASS**

```bash
cd apps/api && npx vitest run src/services/__tests__/wechat-draft-schema-prefix.test.ts src/routes/wechat.test.ts
```
Expected: 全部 PASS，包括新增的两个 "本地表驱动" 用例（若 `wechat.test.ts` 不存在，`grep -rl "scheduler-tick" apps/api/src/routes/__tests__/*.ts apps/api/src/routes/*.test.ts` 找到实际测试文件名跑对应文件）

- [ ] **Step 6: 全局确认无残留飞书引用**

```bash
grep -n "FEISHU\|feishu\|searchTable\|createRecord\|cachedToken" apps/api/src/services/wechat-draft.ts
```
Expected: 零命中（`csLlm`/`FAIL_PLACEHOLDER` 等无关命中不算）

- [ ] **Step 7: typecheck**

```bash
cd apps/api && npx tsc --noEmit
```
Expected: 无新增错误

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/wechat-draft.ts apps/api/src/services/__tests__/wechat-draft-schema-prefix.test.ts
git commit -m "feat(line04): generateMomentDraft 改读本地 wechat_marketing_profile，删除飞书 Bitable 调用（决策19e6480c）"
```

---

### Task 3: 删除 Path2 已死的飞书 Bitable 服务与路由

> **范围修正（2026-07-14，Task 3 首次实施时发现）**：`feishu-bitable-multitenant.ts`/`feishu-docx.ts` **不在删除范围内**——typecheck 实测发现它俩仍被 `feishu-oauth.ts`（`/api/feishu/oauth` 路由的 `provisionBitable`）和 `lead-writer.ts`（`writeDmOutreachStatus`→`writeRecord`，这个函数本计划已明确要保留）依赖，删除会破坏这两条活代码路径。详见设计文档"不动"清单。以下 Files/Steps 已按修正后的范围更新。

**Files:**
- Delete: `apps/api/src/routes/lead-config.ts`
- Delete: `apps/api/src/routes/lead-config.test.ts`
- Delete: `apps/api/src/routes/feishu-customer-list.ts`
- Delete: `apps/api/src/routes/feishu-customer-list.test.ts`
- Delete: `apps/api/src/services/feishu-customer-list.ts`
- Delete: `apps/api/src/services/feishu-customer-list.test.ts`
- Delete: `apps/api/src/routes/_smoke-feishu-seed.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/app-routes.test.ts`（若不存在则新建，专测这几条路由已 404）

**Interfaces:**
- Consumes: 无（纯删除）
- Produces: 无（这几个模块的所有 export 不再存在，任何仍 import 它们的文件会在 typecheck 报错——本 task Step 6 会捕获）

- [ ] **Step 1: 写 failing test——断言这几条路由已不存在**

创建（或在已有 route smoke 测试文件基础上追加）`apps/api/src/__tests__/dropped-feishu-routes.test.ts`：

```typescript
import request from 'supertest';
import app from '../app';

describe('已删除的飞书 Bitable 路由（决策19e6480c，2026-07-14）', () => {
  it('POST /api/lead-config/self → 404（路由已删除）', async () => {
    const res = await request(app).get('/api/lead-config/self');
    expect(res.status).toBe(404);
  });

  it('POST /api/feishu/customer-list/sync → 404（路由已删除）', async () => {
    const res = await request(app).post('/api/feishu/customer-list/sync').send({});
    expect(res.status).toBe(404);
  });

  it('POST /api/_smoke/feishu-seed → 404（路由已删除）', async () => {
    const res = await request(app).post('/api/_smoke/feishu-seed').send({});
    expect(res.status).toBe(404);
  });
});
```

（先跑一次 `grep -n "supertest" apps/api/package.json` 确认依赖存在；若无 supertest，改用仓库里其它路由测试用的现成方式——先看一个现有 route test 文件的引入方式抄同款，不要新引入依赖。）

- [ ] **Step 2: 跑测试确认 FAIL**

```bash
cd apps/api && npx vitest run src/__tests__/dropped-feishu-routes.test.ts
```
Expected: FAIL（这几条路由现在返回 200/400，不是 404）

- [ ] **Step 3: 删除文件**

```bash
git rm apps/api/src/routes/lead-config.ts
git rm apps/api/src/routes/lead-config.test.ts
git rm apps/api/src/routes/feishu-customer-list.ts
git rm apps/api/src/routes/feishu-customer-list.test.ts
git rm apps/api/src/services/feishu-customer-list.ts
git rm apps/api/src/services/feishu-customer-list.test.ts
git rm apps/api/src/routes/_smoke-feishu-seed.ts
```

- [ ] **Step 4: 摘除 app.ts 挂载**

在 `apps/api/src/app.ts` 删除以下几行（行号以 Task 开始时的 grep 结果为准，实施时先重新 grep 一次拿准确行号）：
```typescript
import feishuCustomerListRouter from './routes/feishu-customer-list';
import leadConfigRouter from './routes/lead-config';
import smokeFeishuSeedRouter from './routes/_smoke-feishu-seed';
import { fakeFeishuRouter } from './routes/_smoke-feishu-seed';
```
以及对应的挂载行：
```typescript
app.use('/api/lead-config', leadConfigRouter);
app.use('/api/feishu/customer-list', feishuCustomerListRouter);
app.use('/api/_smoke', smokeFeishuSeedRouter);
app.use(fakeFeishuRouter);
```

- [ ] **Step 5: 跑测试确认 PASS**

```bash
cd apps/api && npx vitest run src/__tests__/dropped-feishu-routes.test.ts
```
Expected: 全部 PASS（404）

- [ ] **Step 6: typecheck 抓引用残留**

```bash
cd apps/api && npx tsc --noEmit
```
Expected: 若有其它文件 import 了刚删除的模块，这里会报错——逐个修（大概率只有对应的 `.test.ts` 已经一起删了，不会报错；若报错说明有 Task 未预见的引用方，停下来核实后再删）

- [ ] **Step 7: 跑全量 api 单测确认没有连带破坏**

```bash
cd apps/api && npx vitest run 2>&1 | tail -40
```
Expected: 除已知与本次改动直接相关的用例外，其余全绿

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "fix(api): 删除已死的Path2飞书Bitable服务与路由——被acquisition.ts本地实现取代（决策19e6480c）"
```

---

### Task 4: 删除 Dashboard 飞书绑定页面

**Files:**
- Delete: `apps/dashboard/src/pages/FeishuBindTenant.tsx`
- Delete: `apps/dashboard/src/pages/FeishuBindTenant.test.tsx`（如存在）
- Modify: `apps/dashboard/src/config/navigation.config.ts`
- Modify: `apps/dashboard/src/App.tsx`

**Interfaces:**
- Consumes: 无
- Produces: 无（`navigation.config.ts` 的 `COMPONENT_MAP`/路由表不再含 `FeishuBindTenant` 条目）

- [ ] **Step 1: 写 failing test**

找到 `apps/dashboard/src/config/navigation.config.ts` 现有的路由表测试（若无专门测试文件，在 `apps/dashboard/src/config/__tests__/navigation.config.test.ts` 新建，若目录下已有同类文件先看格式抄）：

```typescript
import { ROUTES, COMPONENT_MAP } from '../navigation.config';

describe('飞书绑定页面已下线（决策19e6480c，2026-07-14）', () => {
  it('路由表不再含 /dashboard/feishu-bind', () => {
    expect(ROUTES.find((r) => r.path === '/dashboard/feishu-bind')).toBeUndefined();
  });

  it('COMPONENT_MAP 不再含 FeishuBindTenant', () => {
    expect(COMPONENT_MAP['FeishuBindTenant']).toBeUndefined();
  });
});
```

（先 `grep -n "export const ROUTES\|export const COMPONENT_MAP" apps/dashboard/src/config/navigation.config.ts` 确认实际导出名，若不叫这两个名字改成实际名字。）

- [ ] **Step 2: 跑测试确认 FAIL**

```bash
cd apps/dashboard && npx vitest run src/config/__tests__/navigation.config.test.ts
```
Expected: FAIL

- [ ] **Step 3: 删除页面文件 + 摘除路由/组件表条目**

```bash
git rm apps/dashboard/src/pages/FeishuBindTenant.tsx
git rm apps/dashboard/src/pages/FeishuBindTenant.test.tsx 2>/dev/null || true
```

`navigation.config.ts` 删除：
```typescript
'FeishuBindTenant': () => import('../pages/FeishuBindTenant'),
```
和：
```typescript
{ path: '/dashboard/feishu-bind', component: 'FeishuBindTenant', requireAuth: true },
```

`App.tsx` 删除：
```typescript
// Path 2 Sprint A: FeishuBindTenant 通过 navigation.config 'feishu-bind' 路径懒加载（DynamicRouter 注册）
import type { default as _FeishuBindTenant } from './pages/FeishuBindTenant';
```

- [ ] **Step 4: 跑测试确认 PASS**

```bash
cd apps/dashboard && npx vitest run src/config/__tests__/navigation.config.test.ts
```

- [ ] **Step 5: typecheck + build**

```bash
cd apps/dashboard && npx tsc --noEmit && npx vite build
```
Expected: 无错误（`vite build` 顺带确认没有孤儿 import 导致打包失败）

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(dashboard): 下线飞书绑定页面 FeishuBindTenant——Path2已本地化（决策19e6480c）"
```

---

### Task 5: 清理 lead-writer.ts / agent-burner.ts 里的死函数 writeLeadsFromComments

**Files:**
- Modify: `apps/api/src/services/lead-writer.ts`
- Modify: `apps/api/src/services/lead-writer.test.ts`
- Modify: `apps/api/src/routes/agent-burner.ts`
- Modify: `apps/api/src/routes/agent-burner.test.ts`
- Modify: `apps/api/src/routes/agent-burner-warmup.test.ts`
- Modify: `apps/api/src/routes/acquisition.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `lead-writer.ts` 只再导出 `writeDmOutreachStatus`（+ 其类型），`writeLeadsFromComments` 全仓库零引用

- [ ] **Step 1: 写 failing test**

在 `apps/api/src/services/lead-writer.test.ts` 里改写现有断言（原来测 `writeLeadsFromComments` 是 function 的那条）：

```typescript
import * as leadWriter from './lead-writer';

describe('lead-writer 死代码清理（决策19e6480c，2026-07-14）', () => {
  it('writeLeadsFromComments 已删除，模块不再导出它', () => {
    expect((leadWriter as Record<string, unknown>).writeLeadsFromComments).toBeUndefined();
  });

  it('writeDmOutreachStatus 仍然导出（活代码，不动）', () => {
    expect(typeof leadWriter.writeDmOutreachStatus).toBe('function');
  });
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

```bash
cd apps/api && npx vitest run src/services/lead-writer.test.ts
```
Expected: FAIL（`writeLeadsFromComments` 目前还导出着）

- [ ] **Step 3: 删除死函数与死引用**

在 `apps/api/src/services/lead-writer.ts` 删除 `writeLeadsFromComments` 函数本体（保留 `writeDmOutreachStatus` 及其共用的 `writeOneWithRetry`/`DM_STATUS_TO_FEISHU` 等依赖，若这些被 `writeLeadsFromComments` 独占才一并删，先 grep 确认）：

```bash
grep -n "writeOneWithRetry\|DM_STATUS_TO_FEISHU" apps/api/src/services/lead-writer.ts
```

在 `apps/api/src/routes/agent-burner.ts` 删除：
```typescript
import { writeLeadsFromComments, writeDmOutreachStatus, type DmStatus } from '../services/lead-writer';
```
改为：
```typescript
import { writeDmOutreachStatus, type DmStatus } from '../services/lead-writer';
```

在 `apps/api/src/routes/agent-burner.test.ts` / `agent-burner-warmup.test.ts` / `apps/api/src/routes/acquisition.test.ts` 里，删除对 `writeLeadsFromComments` 的 mock（例如 `writeLeadsFromComments: vi.fn().mockResolvedValue(...)` 这一行），只保留 `writeDmOutreachStatus` 的 mock。

- [ ] **Step 4: 跑测试确认 PASS**

```bash
cd apps/api && npx vitest run src/services/lead-writer.test.ts src/routes/agent-burner.test.ts src/routes/agent-burner-warmup.test.ts src/routes/acquisition.test.ts
```
Expected: 全部 PASS

- [ ] **Step 5: 全局确认零引用**

```bash
grep -rn "writeLeadsFromComments" apps/api/src --include="*.ts"
```
Expected: 零命中

- [ ] **Step 6: typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(api): 删除死函数 writeLeadsFromComments，agent-burner.ts 只保留活着的 writeDmOutreachStatus（决策19e6480c）"
```

---

### Task 6: env-registry.ts 清理已死环境变量登记

**Files:**
- Modify: `apps/api/src/env-registry.ts`
- Test: `apps/api/src/env-registry.test.ts`（若存在则复用其已有的"登记条目实际被引用"校验机制；若没有这类校验，本 task 只做手动 grep 验证，不新增测试）

**Interfaces:**
- Consumes: 无
- Produces: 无

- [ ] **Step 1: 逐条 grep 确认候选删除条目在 src 里真的零引用**

```bash
cd apps/api/src
for v in FEISHU_PATH4_APP_TOKEN FEISHU_PROFILE_TABLE_ID FEISHU_SCHEDULE_TABLE_ID FEISHU_TEST_APP_TOKEN FEISHU_TABLE_ID_LEADS FEISHU_CUSTOMER_TABLE_ID FEISHU_INTERACTION_TABLE_ID; do
  echo "=== $v ==="
  grep -rn "$v" . --include="*.ts" | grep -v env-registry.ts
done
```

只删除**确认零命中**的条目；任何还有命中的条目（哪怕只在测试文件里，先看那个测试文件是否也在本次改动范围内被删/改掉了）保留不动，把结果记录下来供 Step 2 使用。

- [ ] **Step 2: 删除确认零引用的登记条目**

在 `apps/api/src/env-registry.ts` 里删除 Step 1 确认零引用的那几行 `{ name: '...', reason: '...' }` 条目。

- [ ] **Step 3: typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 4: 跑 env-registry 相关测试（若存在）**

```bash
cd apps/api && npx vitest run src/env-registry.test.ts 2>&1 || echo "无此测试文件，跳过"
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/env-registry.ts
git commit -m "chore(api): env-registry 清理已死的飞书 Bitable 环境变量登记（决策19e6480c）"
```

---

### Task 7: 全量验收

**Files:** 无新增/修改，纯验证

- [ ] **Step 1: 全局二次确认无残留**

```bash
grep -rn "FEISHU_PROFILE_TABLE_ID\|FEISHU_SCHEDULE_TABLE_ID\|FEISHU_PATH4_APP_TOKEN" apps/ --include="*.ts" --include="*.tsx"
```
Expected: 零命中

- [ ] **Step 2: api + dashboard 全量测试**

```bash
cd apps/api && npx vitest run 2>&1 | tail -30
cd ../dashboard && npx vitest run 2>&1 | tail -30
```
Expected: 全绿

- [ ] **Step 3: api + dashboard typecheck**

```bash
cd apps/api && npx tsc --noEmit
cd ../dashboard && npx tsc --noEmit
```

- [ ] **Step 4: dashboard build**

```bash
cd apps/dashboard && npx vite build
```

- [ ] **Step 5: golden-path-4-smoke 本地跑一遍（需要本地 :5200 API 已启动）**

```bash
bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh
```
Expected: `Smoke: PASS=N FAIL=0`

- [ ] **Step 6: golden-path-2-smoke 本地跑一遍（需要本地 :5200 API 已启动 + DB 干净）**

```bash
bash .github/workflows/scripts/smoke/golden-path-2-smoke.sh 2>&1 | tail -40
```
Expected: 全部步骤 PASS（本条如本地环境不满足前置条件跑不了，交给 CI 兜底，不阻塞本地验收）
