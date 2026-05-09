# Path 2 Sprint A Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修 Path 2 Sprint A lead 自验暴露的 4 个真问题，让客户能在生产 dashboard 真用飞书绑定流程

**Architecture:** 后端 feishu-oauth router 用既有 tenantContext middleware（不再要求前端传 X-Tenant-Id）+ 加缺失的 GET /status endpoint；前端 FeishuBindTenant 加 leadConfigError 渲染让用户看到错误；InstanceContext 启用 feishuBind feature flag 让菜单显示入口

**Tech Stack:** Express 5 + better-auth + pg + React + Vite + vitest + Playwright (rog Edge headless lead 自验)

**Spec doc:** `docs/superpowers/specs/2026-05-09-path-2-sprint-a-hotfix-design.md` (commit b7ec9e6)

**Worktree:** `/Users/administrator/worktrees/zenithjoy/sprint-a-license-ui`
**Branch:** `cp-05091740-fix-p2-feishu-feature-flag`

---

## File Structure

| 文件 | 责任 | 操作 |
|---|---|---|
| `apps/api/src/routes/feishu-oauth.test.ts` | backend feishu-oauth router unit test (覆盖新 GET /status + tenantContext) | 新建 ~80 行 |
| `apps/api/src/routes/feishu-oauth.ts` | backend feishu OAuth start/callback + 新增 status endpoint | 改 ~30 行 |
| `apps/dashboard/src/pages/FeishuBindTenant.tsx` | dashboard 飞书绑定页 + 错误渲染 + ERROR_CN 文案补 | 改 ~12 行 |
| `apps/dashboard/src/contexts/InstanceContext.tsx` | dashboard feature flag 配置（加 feishuBind） | 改 ~3 行 |

---

## Task 1: backend feishu-oauth router 加 GET /status + 用 tenantContext middleware

**Files:**
- Test: `apps/api/src/routes/feishu-oauth.test.ts` (新建)
- Modify: `apps/api/src/routes/feishu-oauth.ts` (加 import + GET /status + 改 POST /start middleware)

### Step 1.1: 写 failing unit test (RED)

- [ ] **Step 1.1.1: 创建 feishu-oauth.test.ts 含 4 个 BEHAVIOR**

Create `apps/api/src/routes/feishu-oauth.test.ts`:

```ts
/**
 * Path 2 Sprint A hotfix — feishu-oauth router unit tests
 *
 * 覆盖：
 *  - [BEHAVIOR] GET /status with binding row → returns {bound: true, app_token, ...}
 *  - [BEHAVIOR] GET /status without binding row → returns {bound: false}
 *  - [BEHAVIOR] GET /status non-existent tenant → 404 TENANT_NOT_FOUND
 *  - [BEHAVIOR] POST /start uses req.tenantId from tenantContext (no X-Tenant-Id header needed)
 *
 * Mock pg.Pool 不连真 DB；mock tenantContext 注入 req.tenantId。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock pg pool
vi.mock('../db/connection', () => ({
  default: {
    query: vi.fn(),
  },
}));

// Mock tenantContext middleware — 注入 req.tenantId
vi.mock('../middleware/tenant-context', () => ({
  tenantContext: (req: any, _res: any, next: any) => {
    req.tenantId = req.headers['x-test-tenant-id'] || '';
    next();
  },
}));

// Mock feishu-token / feishu-bitable services（POST /start 用）
vi.mock('../services/feishu-token', () => ({
  getAuthorizeUrl: vi.fn().mockResolvedValue('https://open.feishu.cn/test/authorize'),
  handleCallback: vi.fn(),
}));
vi.mock('../services/feishu-bitable-multitenant', () => ({
  provisionBitable: vi.fn(),
}));

import pool from '../db/connection';
import feishuOauthRouter from './feishu-oauth';

const app = express();
app.use(express.json());
app.use('/api/feishu/oauth', feishuOauthRouter);

const VALID_TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NOT_FOUND_TENANT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('Path 2 hotfix — feishu-oauth router', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('[BEHAVIOR] GET /status with binding row returns bound=true + table_ids', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{
        bound: true,
        app_token: 'bascn1234567890ABC',
        bound_at: new Date('2026-05-09T10:00:00Z'),
        needs_retry: false,
        table_id_lead_profile: 'tbl1aaaaaaaaaaaaaa',
        table_id_target_videos: 'tbl1bbbbbbbbbbbbbb',
        table_id_leads: 'tbl1cccccccccccccc',
      }],
    } as any);

    const res = await request(app)
      .get('/api/feishu/oauth/status')
      .set('x-test-tenant-id', VALID_TENANT);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.bound).toBe(true);
    expect(res.body.data.app_token).toBe('bascn1234567890ABC');
    expect(res.body.data.bitable_doc_url).toContain('bascn1234567890ABC');
    expect(res.body.data.table_ids.lead_profile).toBe('tbl1aaaaaaaaaaaaaa');
    expect(res.body.data.needs_retry).toBe(false);
  });

  it('[BEHAVIOR] GET /status without binding row returns bound=false', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{
        bound: false,
        app_token: null,
        bound_at: null,
        needs_retry: false,
        table_id_lead_profile: null,
        table_id_target_videos: null,
        table_id_leads: null,
      }],
    } as any);

    const res = await request(app)
      .get('/api/feishu/oauth/status')
      .set('x-test-tenant-id', VALID_TENANT);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.bound).toBe(false);
    expect(res.body.data.app_token).toBeNull();
    expect(res.body.data.bitable_doc_url).toBeNull();
  });

  it('[BEHAVIOR] GET /status non-existent tenant returns 404 TENANT_NOT_FOUND', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

    const res = await request(app)
      .get('/api/feishu/oauth/status')
      .set('x-test-tenant-id', NOT_FOUND_TENANT);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TENANT_NOT_FOUND');
  });

  it('[BEHAVIOR] POST /start uses req.tenantId from tenantContext (no X-Tenant-Id header needed)', async () => {
    vi.mocked(pool.query).mockImplementation(((sql: string) => {
      if (sql.includes('SELECT t.id')) {
        return Promise.resolve({ rows: [{ id: VALID_TENANT, already_bound: false }] } as any);
      }
      // UPDATE tenants
      return Promise.resolve({ rows: [], rowCount: 1 } as any);
    }) as any);

    const res = await request(app)
      .post('/api/feishu/oauth/start')
      .set('x-test-tenant-id', VALID_TENANT)  // tenantContext mock 把它放进 req.tenantId
      .send({ app_id: 'cli_test', app_secret: 'secret_test' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.authorize_url).toContain('open.feishu.cn');
    // 关键：没传 X-Tenant-Id 仍然 work（tenantContext mock 把 x-test-tenant-id 当 tenantId）
  });
});
```

- [ ] **Step 1.1.2: 加 supertest dep 如果缺失**

Run: `cd apps/api && grep -q '"supertest"' package.json && echo "have supertest" || npm install --save-dev supertest @types/supertest`
Expected: 输出 "have supertest"，或 npm install 完成（之前 PR #267 测试可能已装）

- [ ] **Step 1.1.3: Run test to verify RED**

Run: `cd apps/api && npx vitest run src/routes/feishu-oauth.test.ts`
Expected: 4 tests **FAIL** — 因为：
- GET /status route 还不存在（404）
- POST /start 当前看 X-Tenant-Id header（mock 没传 header 时该路由读不到 tenantId）

- [ ] **Step 1.1.4: Commit RED**

```bash
git add apps/api/src/routes/feishu-oauth.test.ts apps/api/package.json apps/api/package-lock.json 2>/dev/null
git commit -m "test(p2-hotfix): feishu-oauth router unit tests for GET /status + tenantContext

4 BEHAVIOR tests, 全部 RED (route/middleware 还没改):
- GET /status with binding row → bound=true + app_token + table_ids
- GET /status without binding row → bound=false
- GET /status non-existent tenant → 404 TENANT_NOT_FOUND
- POST /start uses req.tenantId from tenantContext (no header)

Mock pg.Pool + mock tenantContext middleware + mock feishu services.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Step 1.2: 改 feishu-oauth.ts 让 RED → GREEN

- [ ] **Step 1.2.1: 加 import tenantContext**

Modify `apps/api/src/routes/feishu-oauth.ts`:

把 import 段（顶部）从：
```ts
import { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { getAuthorizeUrl, handleCallback } from '../services/feishu-token';
import { provisionBitable } from '../services/feishu-bitable-multitenant';

const router = Router();
```

改为：
```ts
import { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { tenantContext } from '../middleware/tenant-context';
import { getAuthorizeUrl, handleCallback } from '../services/feishu-token';
import { provisionBitable } from '../services/feishu-bitable-multitenant';

const router = Router();
```

- [ ] **Step 1.2.2: 改 POST /start 用 tenantContext + req.tenantId**

把 `router.post('/start', ...)` 整段从：
```ts
router.post('/start', async (req: Request, res: Response) => {
  const tenantId = (req.header('X-Tenant-Id') || req.body?.tenant_id || '').trim();
  ...
```

改为：
```ts
router.post('/start', tenantContext, async (req: Request, res: Response) => {
  const tenantId = (req.tenantId || req.header('X-Tenant-Id') || req.body?.tenant_id || '').trim();
  ...
```

（保留 X-Tenant-Id + body fallback 给非浏览器 caller，但优先用 req.tenantId）

- [ ] **Step 1.2.3: 加 GET /status endpoint**

在 `router.post('/start', ...)` **之前**（紧跟 const router = Router(); 之后），加：

```ts
// GET /api/feishu/oauth/status
// 前端 FeishuBindTenant mount 时调用，看当前 tenant 是否已绑定飞书
router.get('/status', tenantContext, async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({
      success: false,
      error: { code: 'NO_TENANT_CONTEXT', message: '当前用户未关联 tenant，请重新登录' },
      timestamp: new Date().toISOString(),
    });
  }
  try {
    const r = await pool.query(
      `SELECT
         (b.app_token IS NOT NULL) AS bound,
         b.app_token, b.bound_at, b.needs_retry,
         b.table_id_lead_profile, b.table_id_target_videos, b.table_id_leads
       FROM zenithjoy.tenants t
       LEFT JOIN zenithjoy.tenant_feishu_bindings b ON b.tenant_id = t.id
      WHERE t.id = $1`,
      [tenantId]
    );
    if (!r.rows || r.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'TENANT_NOT_FOUND', message: `tenant ${tenantId} 不存在` },
        timestamp: new Date().toISOString(),
      });
    }
    const row = r.rows[0];
    return res.json({
      success: true,
      data: {
        bound: !!row.bound,
        app_token: row.app_token || null,
        bound_at: row.bound_at || null,
        needs_retry: !!row.needs_retry,
        bitable_doc_url: row.app_token ? `https://feishu.cn/base/${row.app_token}` : null,
        table_ids: {
          lead_profile: row.table_id_lead_profile || null,
          target_videos: row.table_id_target_videos || null,
          leads: row.table_id_leads || null,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[feishu-oauth] /status query failed', err);
    return res.status(500).json({
      success: false,
      error: { code: 'STATUS_QUERY_FAILED', message: '查询绑定状态失败' },
      timestamp: new Date().toISOString(),
    });
  }
});
```

- [ ] **Step 1.2.4: Run test to verify GREEN**

Run: `cd apps/api && npx vitest run src/routes/feishu-oauth.test.ts`
Expected: 4 tests **PASS**

- [ ] **Step 1.2.5: Run all api tests to ensure no regression**

Run: `cd apps/api && npm test`
Expected: 全 PASS（含新 4 + 原有 ~429）

- [ ] **Step 1.2.6: Run TypeScript build**

Run: `cd apps/api && rm -rf dist && npm run build`
Expected: tsc clean，dist/routes/feishu-oauth.js 存在

- [ ] **Step 1.2.7: Commit GREEN**

```bash
git add apps/api/src/routes/feishu-oauth.ts
git commit -m "feat(p2-hotfix): backend feishu-oauth — tenantContext middleware + GET /status endpoint

Bug 1 fix: POST /start 加 tenantContext middleware，从 better-auth session
自动 resolve req.tenantId，不再要求前端传 X-Tenant-Id header（保留 fallback）。

Bug 3 fix: 加 GET /api/feishu/oauth/status endpoint
- 返 {success, data:{bound, app_token, bound_at, needs_retry, bitable_doc_url, table_ids}}
- 不存在的 tenant → 404 TENANT_NOT_FOUND
- DB query 失败 → 500 STATUS_QUERY_FAILED
- 用 tenantContext middleware 同样自动 resolve tenantId

让 dashboard FeishuBindTenant 在 mount 时能拿到当前 tenant 绑定状态。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: frontend FeishuBindTenant 加 leadConfigError 渲染 + ERROR_CN 4 条新文案

**Files:**
- Modify: `apps/dashboard/src/pages/FeishuBindTenant.tsx` (+~12 行)

### Step 2.1: 加 ERROR_CN 4 条新文案

- [ ] **Step 2.1.1: Read 现有 ERROR_CN 块（约 line 30-42）**

Run: `grep -n "ALREADY_BOUND" /Users/administrator/worktrees/zenithjoy/sprint-a-license-ui/apps/dashboard/src/pages/FeishuBindTenant.tsx`
找到 ERROR_CN 块的具体行号

- [ ] **Step 2.1.2: 在 ERROR_CN 末尾加 4 条**

Modify `apps/dashboard/src/pages/FeishuBindTenant.tsx`，在现有 ERROR_CN 对象（约 line 30-42）末尾 `};` 之前加：

```ts
  START_FAILED: '飞书 OAuth 启动失败，请刷新重试。',
  TENANT_ID_REQUIRED: '当前用户未关联租户，请重新登录或联系管理员。',
  MISSING_FIELDS: '请填写完整的 App ID 和 App Secret。',
  NO_TENANT_CONTEXT: '当前用户未关联租户，请重新登录或联系管理员。',
```

### Step 2.2: 在 form 上方加 leadConfigError 渲染

- [ ] **Step 2.2.1: 找到 form / urlError 渲染位置**

Run: `grep -n "{urlError &&\|<form\|绑定飞书" /Users/administrator/worktrees/zenithjoy/sprint-a-license-ui/apps/dashboard/src/pages/FeishuBindTenant.tsx | head -10`

定位到 form 标签 + urlError conditional render 区块的精确行号（前面 read 过约在 line 170-180）

- [ ] **Step 2.2.2: 在 form 上方加 leadConfigError conditional render**

Modify `apps/dashboard/src/pages/FeishuBindTenant.tsx`，在 `<form onSubmit={onSubmit} ...>` **之前**（约 line 178-180 之前），紧跟 urlError block 之后，加：

```tsx
      {/* Bug 2 fix: oauth/start / refreshLeadConfig 失败时显示错误（之前 setLeadConfigError 但没渲染 → 用户感觉无反应） */}
      {leadConfigError && (
        <div style={{
          padding: 12,
          background: '#fee',
          color: '#c00',
          borderRadius: 6,
          marginBottom: 12,
          border: '1px solid #fcc',
        }}>
          <strong>绑定失败：</strong> {ERROR_CN[leadConfigError as keyof typeof ERROR_CN] || leadConfigError}
        </div>
      )}
```

- [ ] **Step 2.2.3: 本地 build + typecheck**

Run: `cd apps/dashboard && npm run build`
Expected: vite build clean，dist/ 重新生成

- [ ] **Step 2.2.4: 跑 dashboard tests 确认 ws4 没破**

Run: `cd apps/dashboard && npm test`
Expected: 全 PASS（含 ws4 vitest 4 个）

- [ ] **Step 2.2.5: Commit**

```bash
git add apps/dashboard/src/pages/FeishuBindTenant.tsx
git commit -m "fix(p2-hotfix): FeishuBindTenant 渲染 leadConfigError + ERROR_CN 4 条新文案

Bug 2 fix: oauth/start 或 refreshLeadConfig 失败时渲染 leadConfigError state。
之前代码里 setLeadConfigError(j?.error?.code) 设了 state 但页面没渲染，
用户点开始绑定失败感觉是 '无反应'，实际是 400 TENANT_ID_REQUIRED 等错。

ERROR_CN 加 4 条友好文案：
- START_FAILED: 飞书 OAuth 启动失败，请刷新重试
- TENANT_ID_REQUIRED: 当前用户未关联租户
- MISSING_FIELDS: 请填写完整的 App ID 和 App Secret
- NO_TENANT_CONTEXT: 当前用户未关联租户

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: InstanceContext autopilotConfig.features 加 'feishuBind': true

**Files:**
- Modify: `apps/dashboard/src/contexts/InstanceContext.tsx` (+~3 行)

- [ ] **Step 3.1: 找到 ws1-publish 那行**

Run: `grep -n "'ws1-publish'" /Users/administrator/worktrees/zenithjoy/sprint-a-license-ui/apps/dashboard/src/contexts/InstanceContext.tsx`
定位到约 line 51

- [ ] **Step 3.2: 在 ws1-publish 之后加 feishuBind**

Modify `apps/dashboard/src/contexts/InstanceContext.tsx`：

把：
```ts
    'ws1-publish': true,         // /dashboard/publish
    // 旧 features（保留用于兼容，实际已合并到 media-scenario）
```

改为：
```ts
    'ws1-publish': true,         // /dashboard/publish
    // Path 2 Sprint A — 客户智能获客路径（飞书集成）
    'feishuBind': true,          // /dashboard/feishu-bind
    // 旧 features（保留用于兼容，实际已合并到 media-scenario）
```

- [ ] **Step 3.3: 本地 build + typecheck**

Run: `cd apps/dashboard && npm run build`
Expected: vite build clean

- [ ] **Step 3.4: Commit**

```bash
git add apps/dashboard/src/contexts/InstanceContext.tsx
git commit -m "fix(p2-hotfix): InstanceContext 加 feishuBind feature flag 让侧边菜单显示入口

Bug 4 fix: PR #267 generator 加了 navigation.config.ts 里的「绑飞书」菜单 entry
（featureKey: 'feishuBind'），但 InstanceContext autopilotConfig.features 漏配
'feishuBind': true。DynamicSidebar 用 isFeatureEnabled(featureKey) 过滤菜单，
false → 菜单不显示，客户找不到入口。

加 'feishuBind': true 让所有 autopilot 实例的客户都看到「绑飞书」菜单。
thin 阶段不分 tier，加厚到 medium 时按 tier gate。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 本地全套验证 + push + 开 PR

### Step 4.1: 本地全套验证

- [ ] **Step 4.1.1: api typecheck + build**

Run: `cd /Users/administrator/worktrees/zenithjoy/sprint-a-license-ui/apps/api && rm -rf dist && npm run build`
Expected: tsc clean，dist/routes/feishu-oauth.js 含 GET /status 实现

- [ ] **Step 4.1.2: api 全部测试**

Run: `cd /Users/administrator/worktrees/zenithjoy/sprint-a-license-ui/apps/api && npm test 2>&1 | tail -10`
Expected: 全 PASS（含新 feishu-oauth.test.ts 4 个 + 之前 ~429 全部）

- [ ] **Step 4.1.3: api lint**

Run: `cd /Users/administrator/worktrees/zenithjoy/sprint-a-license-ui/apps/api && npm run lint 2>&1 | tail -5`
Expected: 0 errors

- [ ] **Step 4.1.4: dashboard build**

Run: `cd /Users/administrator/worktrees/zenithjoy/sprint-a-license-ui/apps/dashboard && npm run build 2>&1 | tail -5`
Expected: vite build clean

- [ ] **Step 4.1.5: dashboard lint with --max-warnings 79**

Run: `cd /Users/administrator/worktrees/zenithjoy/sprint-a-license-ui/apps/dashboard && npx eslint . --max-warnings 79 2>&1 | tail -5`
Expected: 0 errors，warnings ≤ 79

- [ ] **Step 4.1.6: dashboard 全部测试**

Run: `cd /Users/administrator/worktrees/zenithjoy/sprint-a-license-ui/apps/dashboard && npm test 2>&1 | tail -10`
Expected: 全 PASS（含 ws4 vitest 4 个 + 168 之前的全部）

- [ ] **Step 4.1.7: TDD lint local check**

Run: `cd /Users/administrator/worktrees/zenithjoy/sprint-a-license-ui && bash .github/workflows/scripts/lint-tdd-commit-order.sh origin/main 2>&1 | tail -5`
Expected: PASS（commit-1 test commit 在 commit-2 src commit 之前）

### Step 4.2: Push + 开 PR

- [ ] **Step 4.2.1: Push**

Run: `cd /Users/administrator/worktrees/zenithjoy/sprint-a-license-ui && git push -u origin HEAD`
Expected: branch pushed

- [ ] **Step 4.2.2: 开 PR**

Run:
```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-a-license-ui && gh pr create \
  --base main \
  --head cp-05091740-fix-p2-feishu-feature-flag \
  --title "[CONFIG] hotfix: Path 2 Sprint A — lead 自验暴露的 4 真 bug" \
  --body "$(cat <<'EOF'
## 摘要

Path 2 Sprint A (PR #267) lead 自验自动跑（mac → ssh rog → Edge headless Playwright）暴露 4 个真问题，全部修复。

**本 PR 把 Path 2 Step 3+4 从「生产部署后客户点按钮无反应」推到「真客户视角能跑通到 OAuth 二维码扫码物理瓶颈」。**

## 4 个 fix

| # | 真证据 | 文件 |
|---|---|---|
| Bug 1 跨层契约 mismatch | `POST /start → 400 TENANT_ID_REQUIRED` | feishu-oauth.ts 加 tenantContext |
| Bug 2 客户体验缺失 | 点按钮无反应（leadConfigError 没渲染）| FeishuBindTenant.tsx 加错误显示 |
| Bug 3 后端缺 endpoint | `GET /api/feishu/oauth/status → 404` | feishu-oauth.ts 加 GET /status + unit test |
| Bug 4 feature flag 漏配 | 侧边菜单看不到「绑飞书」 | InstanceContext.tsx 加 feishuBind: true |

## Test plan

- [x] feishu-oauth.test.ts 4 BEHAVIOR unit tests 全 PASS
- [x] apps/api 全部测试 PASS
- [x] apps/api typecheck + lint clean
- [x] apps/dashboard build clean
- [x] apps/dashboard lint 0 errors / warnings ≤ 79
- [x] apps/dashboard 全部测试 PASS（含 ws4 vitest 4）
- [x] TDD commit-order lint local PASS
- [ ] CI 全 35/35 PASS
- [ ] Lead 自验自动化（mac → ssh rog → Edge Playwright）跑通到 OAuth 二维码扫码点

## Spec + Plan

- Spec: `docs/superpowers/specs/2026-05-09-path-2-sprint-a-hotfix-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-path-2-sprint-a-hotfix.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: PR URL 输出

- [ ] **Step 4.2.3: 等 CI 跑完**

Run: `gh pr checks <PR#> --watch --interval 30 2>&1 | tail -10`
Expected: 全 35/35 PASS

- [ ] **Step 4.2.4: Merge + redeploy**

Merge:
```bash
gh pr merge <PR#> --squash --delete-branch
```

Redeploy backend:
```bash
cd /Users/administrator/perfect21/zenithjoy && git stash push -m "redeploy-temp" .agent-knowledge/path-4/lead-acceptance-path4-sprint-1.md 2>&1 || true
git checkout main && git pull --ff-only origin main
cd apps/api && rm -rf dist && npm run build
node -e "const{Pool}=require('pg');require('dotenv').config();const p=new Pool({host:process.env.DATABASE_HOST,port:process.env.DATABASE_PORT,database:process.env.DATABASE_NAME,user:process.env.DATABASE_USER,password:process.env.DATABASE_PASSWORD});(async()=>{await p.end();})()"  # 验 db 连通
launchctl kickstart -k gui/$(id -u)/com.zenithjoy.api
sleep 3
curl -s http://localhost:5200/api/feishu/oauth/status -H "Cookie: bogus=1" 2>&1 | head -3  # endpoint should return some json (not 404)
git checkout cp-05082012-path4-sprint-1-prd && git stash pop 2>&1 || true
```

Redeploy dashboard:
```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-a-license-ui
git fetch origin main && git reset --hard origin/main
cd apps/dashboard && npm run build
rsync -avz --delete dist/ hk-vps:/opt/zenithjoy/autopilot-dashboard/dist/
```

Expected: 后端 endpoint 不再 404；HK 收到新 dist

### Step 4.3: Lead 自验自动化重跑

- [ ] **Step 4.3.1: 改 Playwright self-test 用 ZenithJoy 真 .env FEISHU_APP_ID/SECRET**

mac 这边读 .env：
```bash
APP_ID=$(grep '^FEISHU_APP_ID=' /Users/administrator/perfect21/zenithjoy/apps/api/.env | cut -d= -f2-)
APP_SECRET=$(grep '^FEISHU_APP_SECRET=' /Users/administrator/perfect21/zenithjoy/apps/api/.env | cut -d= -f2-)
```

更新 `/tmp/p2-rog-self-test.js`：
- 加 `const APP_ID = process.env.FEISHU_APP_ID; const APP_SECRET = process.env.FEISHU_APP_SECRET;`
- form fill 用真 app_id/secret
- 加 Step 4: 点开始绑定 + 等 oauth/start 200 + 抓 authorize_url + 验证 client_id 匹配 APP_ID
- 加 Step 5: page.goto authorize_url → 等飞书 OAuth 页加载 → 截图 OAuth 二维码（不真扫）
- 截图归档 6 张关键节点

scp 到 rog 后用 env vars 跑：
```bash
ssh rog-xian "cd /d C:\Users\asus\Documents\path2-self && set FEISHU_APP_ID=$APP_ID && set FEISHU_APP_SECRET=$APP_SECRET && node self-test.js"
```

Expected: console 输出 6 步全 PASS，截图 saved screenshots/01..06.png

- [ ] **Step 4.3.2: scp 截图回 mac**

Run: `scp -r 'rog-xian:Documents/path2-self/screenshots' /tmp/p2-rog/`
Expected: 6 张 png 拉回 /tmp/p2-rog/screenshots/

- [ ] **Step 4.3.3: 写真证据 lead-acceptance-sprint-a.md**

替换 `/Users/administrator/worktrees/zenithjoy/sprint-a-license-ui/.agent-knowledge/path-2/lead-acceptance-sprint-a.md` 占位骨架为真证据：
- status: PASS-to-OAuth-boundary
- 真时间戳（hotfix merge sha + redeploy 时间 + lead 自验执行时间）
- 6 步 checklist 每步真截图引用 + console / network log 摘要
- OAuth 物理瓶颈说明（不能自动化扫码，由 user 5 秒手机扫）

- [ ] **Step 4.3.4: Commit + push lead-acceptance evidence**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-a-license-ui
git add .agent-knowledge/path-2/lead-acceptance-sprint-a.md
git commit -m "docs(evidence): Path 2 Sprint A lead 自验自动化真证据

mac → ssh rog → Edge headless Playwright 全程跑通到 OAuth 二维码扫码物理瓶颈。
6 张关键截图 + 真时间戳 + console/network log 摘要。

替换 generator 占位骨架（PASS YAML 假文档）为真客户视角证据。
status: PASS-to-OAuth-boundary（OAuth 扫码本身需用户 5 秒手机扫）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main 2>&1 || git push origin HEAD  # main 直推由 evidence 性质决定，或开 follow-up tiny PR
```

注：如果直推 main 被 hook 拦，开 tiny doc PR + auto merge。

---

## Self-Review

✅ **Spec coverage**：4 fix 一一对应 4 task；测试策略 unit (Task 1) / integration (CI L4) / E2E (Task 4.3) / smoke (不改) 全覆盖

✅ **Placeholder scan**：无 TBD/TODO；所有 code block 完整可执行；无 "similar to Task N"

✅ **Type consistency**：feishu-oauth.ts 中 `tenantContext` import 在 Task 1.2.1 加，Task 1.2.2 + 1.2.3 用同名；ERROR_CN keys 在 Task 2.1.2 加 4 条，Task 2.2.2 用同 keys

✅ **TDD 顺序**：Task 1 严格 commit-1 RED → commit-2 GREEN；Task 2/3 是纯 fix（小改动 + 无新 BEHAVIOR）不强制 TDD（按 spec 测试策略说明 — 现有 ws4 test + lead 自验 E2E 覆盖）

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-09-path-2-sprint-a-hotfix.md`.

按父 prompt 指示 + /dev Tier 1 default：**subagent-driven**。下一步调 `superpowers:subagent-driven-development` 派 implementer subagent 跑 Task 1-4。
