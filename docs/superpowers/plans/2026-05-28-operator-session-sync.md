# Operator Session Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `POST /api/operator/sessions/sync` so OperatorPage's 「立即同步」 button returns the real 8×4 session status matrix.

**Architecture:** New route file reads `session-health-report.json` (produced by check-health.js CI job), transforms the flat array into a platform×accountType matrix, and returns it. No DB access, no external calls. Guarded by `superAdminGuard`.

**Tech Stack:** Express, TypeScript, Vitest, supertest, Node `fs`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `apps/api/src/routes/operator.ts` | Create | Route handler + matrix transform logic |
| `apps/api/src/routes/operator.test.ts` | Create | Unit/integration tests (fs mocked) |
| `apps/api/src/app.ts` | Modify (line ~102) | Register `/api/operator` route |

---

## Task 1: Failing tests for operator route

**Files:**
- Create: `apps/api/src/routes/operator.test.ts`

- [ ] **Step 1: Write the failing test file**

```typescript
// apps/api/src/routes/operator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock fs BEFORE importing the router
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('../middleware/super-admin', () => ({
  superAdminGuard: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => next(),
}));

import * as fs from 'node:fs';
import { operatorRouter } from './operator';

const app = express();
app.use(express.json());
app.use('/api/operator', operatorRouter);

const SAMPLE_REPORT = [
  { platform: '抖音主号',  secretEnv: 'DOUYIN_MAIN',         status: 'ok',      checkedAt: '2026-05-28T01:00:00.000Z', expiresAt: null },
  { platform: '抖音小号1', secretEnv: 'DOUYIN_SUB_1',        status: 'expired', checkedAt: '2026-05-28T01:00:00.000Z', expiresAt: null },
  { platform: '快手主号',  secretEnv: 'KUAISHOU_MAIN',       status: 'missing', checkedAt: '2026-05-28T01:00:00.000Z', expiresAt: null },
  { platform: '飞书 API Key', secretEnv: 'FEISHU_API_KEY',   status: 'ok',      checkedAt: '2026-05-28T01:00:00.000Z', expiresAt: null },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/operator/sessions/sync', () => {
  it('returns matrix from session-health-report.json', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(SAMPLE_REPORT));

    const res = await request(app).post('/api/operator/sessions/sync');

    expect(res.status).toBe(200);
    expect(res.body.matrix['抖音']['MAIN']).toEqual({
      status: 'ok',
      lastSync: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
    });
    expect(res.body.matrix['抖音']['SUB_1']).toEqual({
      status: 'expired',
      lastSync: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
    });
    expect(res.body.matrix['快手']['MAIN']).toEqual({
      status: 'missing',
      lastSync: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
    });
  });

  it('excludes API key entries from matrix', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(SAMPLE_REPORT));

    const res = await request(app).post('/api/operator/sessions/sync');

    expect(res.status).toBe(200);
    // FEISHU_API_KEY must NOT appear as a platform key
    expect(Object.keys(res.body.matrix)).not.toContain('飞书 API Key');
    expect(Object.keys(res.body.matrix)).not.toContain('飞书');
  });

  it('returns empty matrix when session-health-report.json does not exist', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const res = await request(app).post('/api/operator/sessions/sync');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matrix: {} });
  });

  it('returns empty matrix when file content is invalid JSON', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('not-json');

    const res = await request(app).post('/api/operator/sessions/sync');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matrix: {} });
  });
});
```

- [ ] **Step 2: Run tests — confirm FAIL (module not found)**

```bash
cd /tmp/zj-operator-sync/apps/api && npx vitest run src/routes/operator.test.ts 2>&1 | tail -15
```

Expected: `Error: Cannot find module './operator'`

- [ ] **Step 3: Commit failing test**

```bash
cd /tmp/zj-operator-sync
git add apps/api/src/routes/operator.test.ts
git commit -m "test(operator): failing tests for session sync endpoint"
```

---

## Task 2: Implement operator route

**Files:**
- Create: `apps/api/src/routes/operator.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// apps/api/src/routes/operator.ts
import { Router, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { superAdminGuard } from '../middleware/super-admin';

const router = Router();
router.use(superAdminGuard);

const PLATFORM_MAP: Record<string, string> = {
  DOUYIN:       '抖音',
  KUAISHOU:     '快手',
  XIAOHONGSHU:  '小红书',
  SHIPINHAO:    '视频号',
  TOUTIAO:      '头条',
  WEIBO:        '微博',
  ZHIHU:        '知乎',
  GONGZHONGHAO: '公众号',
};

// secretEnv suffixes that indicate API keys — skip these
const API_KEY_MARKERS = ['API_KEY', 'WEBHOOK', 'TOKEN'];

interface HealthRecord {
  platform: string;
  secretEnv: string;
  status: string;
  checkedAt: string | null;
  expiresAt: string | null;
}

type CellStatus = 'ok' | 'expired' | 'missing';
interface MatrixCell { status: CellStatus; lastSync: string | null; }
type Matrix = Record<string, Record<string, MatrixCell>>;

function formatDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${day} ${h}:${min}`;
}

function buildMatrix(records: HealthRecord[]): Matrix {
  const matrix: Matrix = {};

  for (const r of records) {
    // Skip API key entries
    if (API_KEY_MARKERS.some(m => r.secretEnv.includes(m))) continue;

    // Match longest platform prefix first
    let platformName: string | null = null;
    let accountType: string | null = null;

    for (const [prefix, name] of Object.entries(PLATFORM_MAP)) {
      if (r.secretEnv.startsWith(prefix + '_')) {
        platformName = name;
        accountType = r.secretEnv.slice(prefix.length + 1); // e.g. MAIN, SUB_1, SUB_2
        break;
      }
    }

    if (!platformName || !accountType) continue;

    if (!matrix[platformName]) matrix[platformName] = {};
    matrix[platformName][accountType] = {
      status: (r.status as CellStatus) ?? 'missing',
      lastSync: r.checkedAt ? formatDate(r.checkedAt) : null,
    };
  }

  return matrix;
}

function loadReport(): HealthRecord[] {
  const reportPath = join(process.cwd(), 'session-health-report.json');
  try {
    const raw = readFileSync(reportPath, 'utf-8');
    return JSON.parse(raw) as HealthRecord[];
  } catch (e: unknown) {
    console.warn('[operator] session-health-report.json unavailable:', (e as Error).message);
    return [];
  }
}

router.post('/sessions/sync', (_req: Request, res: Response) => {
  const records = loadReport();
  const matrix = buildMatrix(records);
  res.json({ matrix });
});

export const operatorRouter = router;
```

- [ ] **Step 2: Run tests — confirm PASS**

```bash
cd /tmp/zj-operator-sync/apps/api && npx vitest run src/routes/operator.test.ts 2>&1 | tail -15
```

Expected: `4 passed`

- [ ] **Step 3: Commit implementation**

```bash
cd /tmp/zj-operator-sync
git add apps/api/src/routes/operator.ts
git commit -m "feat(operator): POST /api/operator/sessions/sync — read session-health-report.json → 8×4 matrix"
```

---

## Task 3: Register route in app.ts

**Files:**
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Add import and route registration**

In `apps/api/src/app.ts`, add after the existing admin routes block (around line 24/102):

```typescript
// Line ~24 (imports section, after adminCustomersRouter import):
import { operatorRouter } from './routes/operator';

// Line ~102 (after app.use('/api/admin/customers', adminCustomersRouter)):
app.use('/api/operator', operatorRouter);
```

- [ ] **Step 2: Run full API test suite**

```bash
cd /tmp/zj-operator-sync/apps/api && npx vitest run 2>&1 | tail -20
```

Expected: all tests pass, no regressions

- [ ] **Step 3: TypeScript check**

```bash
cd /tmp/zj-operator-sync/apps/api && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
cd /tmp/zj-operator-sync
git add apps/api/src/app.ts
git commit -m "chore(api): register /api/operator route"
```

---

## Task 4: Brain DB + Notion 同步

- [ ] **Step 1: 更新 Feature 状态（thin → done）**

```bash
# Feature ID: c85f9fac (Dashboard 运营中枢状态矩阵)
curl -s -X PATCH localhost:5221/api/brain/journey_features/c85f9fac68a642efaefe9f1de8d413e4 \
  -H "Content-Type: application/json" \
  -d '{"status":"done","thickness":"thin"}'
```

- [ ] **Step 2: 注册测试到 test_registry**

```bash
curl -s -X POST localhost:5221/api/brain/registry \
  -H "Content-Type: application/json" \
  -d '{
    "type": "test",
    "name": "operator session sync tests",
    "path": "apps/api/src/routes/operator.test.ts",
    "journey_id": "636a918c-8b23-4df5-baec-b1eb3308fffb",
    "feature_id": "c85f9fac-a231-4c9a-b637-20b7a12f486b"
  }'
```
