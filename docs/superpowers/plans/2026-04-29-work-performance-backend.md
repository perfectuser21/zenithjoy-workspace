# Work Performance Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为作品详情页提供逐日性能数据 API，支持单平台和多平台视图

**Architecture:** 补建 `daily_snapshots` 正式 Migration（含 saves 列），在 `snapshots.ts` 的 ingest 端点加 saves 字段透传，新建 `work-performance.ts` 路由文件提供两个新端点，挂载到 `/api/works/:id/performance`

**Tech Stack:** Express + TypeScript + PostgreSQL (pg Pool) + Vitest + supertest

---

## 文件清单

| 操作 | 文件 |
|---|---|
| 新建 | `apps/api/db/migrations/20260429_000000_create_daily_snapshots.sql` |
| 新建 | `apps/api/src/routes/work-performance.ts` |
| 修改 | `apps/api/src/routes/snapshots.ts` — ingest INSERT 加 saves |
| 修改 | `apps/api/src/app.ts` — 注册新路由 |
| 新建 | `apps/api/tests/work-performance.test.ts` |
| 新建 | `.github/workflows/scripts/smoke/work-performance-smoke.sh` |

---

## Task 1：Migration — 正式建表 daily_snapshots

**Files:**
- Create: `apps/api/db/migrations/20260429_000000_create_daily_snapshots.sql`

- [ ] **Step 1: 创建 migration 文件**

```sql
-- apps/api/db/migrations/20260429_000000_create_daily_snapshots.sql
BEGIN;

CREATE TABLE IF NOT EXISTS zenithjoy.daily_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform     VARCHAR(20)  NOT NULL,
  content_id   VARCHAR(200) NOT NULL,
  scraped_date DATE         NOT NULL,
  scraped_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  title        TEXT,
  views        INTEGER      NOT NULL DEFAULT 0,
  likes        INTEGER      NOT NULL DEFAULT 0,
  comments     INTEGER      NOT NULL DEFAULT 0,
  shares       INTEGER      NOT NULL DEFAULT 0,
  saves        INTEGER      NOT NULL DEFAULT 0,
  extra_data   JSONB,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (platform, content_id, scraped_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_snapshots_platform_date
  ON zenithjoy.daily_snapshots (platform, scraped_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_snapshots_content
  ON zenithjoy.daily_snapshots (content_id, platform);

-- 如果表已存在但缺少 saves 列，补加
ALTER TABLE zenithjoy.daily_snapshots
  ADD COLUMN IF NOT EXISTS saves INTEGER NOT NULL DEFAULT 0;

COMMIT;
```

- [ ] **Step 2: 提交 migration**

```bash
git add apps/api/db/migrations/20260429_000000_create_daily_snapshots.sql
git commit -m "feat(db): 正式建表 daily_snapshots，含 saves 列"
```

---

## Task 2：写失败的测试（TDD commit-1）

**Files:**
- Create: `apps/api/tests/work-performance.test.ts`
- Create: `.github/workflows/scripts/smoke/work-performance-smoke.sh`

- [ ] **Step 1: 写 work-performance.test.ts（此时端点不存在，测试必须失败）**

```typescript
// apps/api/tests/work-performance.test.ts
import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

describe('Work Performance API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/works/:id/performance', () => {
    it('returns platforms grouped by platform key', async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 3,
        rows: [
          { platform: 'douyin',      date: '2026-04-20', day_n: 1, views: 5000, likes: 300, comments: 50, shares: 20, saves: 100 },
          { platform: 'douyin',      date: '2026-04-21', day_n: 2, views: 8000, likes: 420, comments: 80, shares: 35, saves: 150 },
          { platform: 'xiaohongshu', date: '2026-04-20', day_n: 1, views: 2000, likes: 150, comments: 30, shares: 10, saves: 500 },
        ],
      });

      const res = await request(app).get('/api/works/work-uuid-001/performance');

      expect(res.status).toBe(200);
      expect(res.body.work_id).toBe('work-uuid-001');
      expect(res.body.platforms).toHaveProperty('douyin');
      expect(res.body.platforms).toHaveProperty('xiaohongshu');
      expect(res.body.platforms.douyin).toHaveLength(2);
      expect(res.body.platforms.douyin[0]).toMatchObject({
        day_n: 1, views: 5000, likes: 300, comments: 50, shares: 20, saves: 100,
      });
      expect(res.body.platforms.xiaohongshu).toHaveLength(1);
    });

    it('returns empty platforms object when work has no publish_logs with snapshots', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const res = await request(app).get('/api/works/work-uuid-empty/performance');

      expect(res.status).toBe(200);
      expect(res.body.work_id).toBe('work-uuid-empty');
      expect(res.body.platforms).toEqual({});
    });

    it('returns 500 on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));

      const res = await request(app).get('/api/works/work-uuid-001/performance');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/works/:id/performance/:platform', () => {
    it('returns single platform data with published_at', async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 2,
        rows: [
          { published_at: '2026-04-19T10:00:00Z', date: '2026-04-20', day_n: 1, views: 5000, likes: 300, comments: 50, shares: 20, saves: 100 },
          { published_at: '2026-04-19T10:00:00Z', date: '2026-04-21', day_n: 2, views: 8000, likes: 420, comments: 80, shares: 35, saves: 150 },
        ],
      });

      const res = await request(app).get('/api/works/work-uuid-001/performance/douyin');

      expect(res.status).toBe(200);
      expect(res.body.work_id).toBe('work-uuid-001');
      expect(res.body.platform).toBe('douyin');
      expect(res.body.published_at).toBe('2026-04-19T10:00:00Z');
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toMatchObject({ day_n: 1, views: 5000, saves: 100 });
    });

    it('returns empty data array when platform has no snapshots', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const res = await request(app).get('/api/works/work-uuid-001/performance/kuaishou');

      expect(res.status).toBe(200);
      expect(res.body.work_id).toBe('work-uuid-001');
      expect(res.body.platform).toBe('kuaishou');
      expect(res.body.published_at).toBeNull();
      expect(res.body.data).toEqual([]);
    });

    it('returns 500 on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const res = await request(app).get('/api/works/work-uuid-001/performance/weibo');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/snapshots/ingest saves field', () => {
    it('extracts saves from top-level item.saves', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: '1' }] });

      const res = await request(app)
        .post('/api/snapshots/ingest')
        .send({
          platform: 'xiaohongshu',
          items: [{ content_id: 'note001', scraped_date: '2026-04-20', views: 2000, likes: 150, saves: 500 }],
        });

      expect(res.status).toBe(200);
      expect(res.body.inserted).toBe(1);

      const insertCall = mockQuery.mock.calls[0];
      const sql: string = insertCall[0];
      const params: unknown[] = insertCall[1];
      expect(sql).toContain('saves');
      expect(params).toContain(500);
    });

    it('falls back to extra_data.favorites when saves not present', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: '1' }] });

      const res = await request(app)
        .post('/api/snapshots/ingest')
        .send({
          platform: 'kuaishou',
          items: [{ content_id: 'photo001', scraped_date: '2026-04-20', views: 3000, extra_data: { favorites: 200 } }],
        });

      expect(res.status).toBe(200);

      const insertCall = mockQuery.mock.calls[0];
      const params: unknown[] = insertCall[1];
      expect(params).toContain(200);
    });
  });
});
```

- [ ] **Step 2: 验证测试此时失败**

```bash
cd /Users/administrator/perfect21/zenithjoy
npx vitest run apps/api/tests/work-performance.test.ts 2>&1 | tail -20
```

期望输出：`FAIL` — 路由不存在返回 404

- [ ] **Step 3: 写 smoke 脚本骨架（空跑 exit 0，占位）**

```bash
#!/usr/bin/env bash
# .github/workflows/scripts/smoke/work-performance-smoke.sh
# E2E smoke: work performance API
# 需要本地 API 在 localhost:5200 运行
set -euo pipefail

API="http://localhost:5200"
WORK_ID="${TEST_WORK_ID:-}"

echo "=== Work Performance Smoke Test ==="

# 1. 健康检查
echo "[1] Health check..."
curl -sf "$API/health" | grep -q '"status":"ok"'
echo "  ✅ API healthy"

# 2. POST ingest with saves
echo "[2] Ingest test snapshot with saves..."
INGEST=$(curl -sf -X POST "$API/api/snapshots/ingest" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "douyin",
    "items": [{
      "content_id": "smoke-test-001",
      "scraped_date": "2026-04-20",
      "title": "Smoke Test Video",
      "views": 9999,
      "likes": 888,
      "comments": 77,
      "shares": 66,
      "saves": 555
    }]
  }')
echo "  Ingest response: $INGEST"
echo "$INGEST" | grep -q '"success":true'
echo "  ✅ Ingest with saves OK"

# 3. GET /api/works/:id/performance（需要真实 work_id + publish_log）
if [ -n "$WORK_ID" ]; then
  echo "[3] GET /api/works/$WORK_ID/performance..."
  PERF=$(curl -sf "$API/api/works/$WORK_ID/performance")
  echo "  Response: $PERF"
  echo "$PERF" | grep -q '"platforms"'
  echo "  ✅ /performance endpoint OK"

  echo "[4] GET /api/works/$WORK_ID/performance/douyin..."
  PERF_P=$(curl -sf "$API/api/works/$WORK_ID/performance/douyin")
  echo "  Response: $PERF_P"
  echo "$PERF_P" | grep -q '"data"'
  echo "  ✅ /performance/:platform endpoint OK"
else
  echo "[3] SKIPPED (no TEST_WORK_ID set — ingest-only smoke)"
fi

echo ""
echo "=== ✅ Work Performance smoke PASSED ==="
```

- [ ] **Step 4: 提交失败测试 + smoke 骨架（TDD commit-1）**

```bash
git add apps/api/tests/work-performance.test.ts \
        .github/workflows/scripts/smoke/work-performance-smoke.sh
git commit -m "test(work-performance): 写失败的集成测试 + smoke 骨架 [TDD commit-1]"
```

---

## Task 3：实现 — 新增 work-performance 路由（TDD commit-2）

**Files:**
- Create: `apps/api/src/routes/work-performance.ts`

- [ ] **Step 1: 创建 work-performance.ts**

```typescript
// apps/api/src/routes/work-performance.ts
import { Router, Request, Response } from 'express';
import pool from '../db/connection';

const router = Router({ mergeParams: true });

// GET /api/works/:id/performance
// 返回作品在所有平台的逐日数据，按平台分组
router.get('/', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT
         pl.platform,
         ds.scraped_date AS date,
         (ds.scraped_date - pl.published_at::date)::integer AS day_n,
         ds.views, ds.likes, ds.comments, ds.shares, ds.saves
       FROM zenithjoy.publish_logs pl
       JOIN zenithjoy.daily_snapshots ds
         ON ds.platform = pl.platform
         AND ds.content_id = pl.platform_post_id
       WHERE pl.work_id = $1
         AND pl.platform_post_id IS NOT NULL
       ORDER BY pl.platform, ds.scraped_date`,
      [id]
    );

    const platforms: Record<string, object[]> = {};
    for (const row of result.rows) {
      const { platform, ...data } = row;
      if (!platforms[platform]) platforms[platform] = [];
      platforms[platform].push(data);
    }

    return res.json({ work_id: id, platforms });
  } catch (err) {
    console.error('work performance all-platforms error:', err);
    return res.status(500).json({ success: false, error: '查询失败' });
  }
});

// GET /api/works/:id/performance/:platform
// 返回作品在指定平台的逐日数据
router.get('/:platform', async (req: Request, res: Response) => {
  const { id, platform } = req.params;

  try {
    const result = await pool.query(
      `SELECT
         pl.published_at,
         ds.scraped_date AS date,
         (ds.scraped_date - pl.published_at::date)::integer AS day_n,
         ds.views, ds.likes, ds.comments, ds.shares, ds.saves
       FROM zenithjoy.publish_logs pl
       JOIN zenithjoy.daily_snapshots ds
         ON ds.platform = pl.platform
         AND ds.content_id = pl.platform_post_id
       WHERE pl.work_id = $1
         AND pl.platform = $2
         AND pl.platform_post_id IS NOT NULL
       ORDER BY ds.scraped_date`,
      [id, platform]
    );

    const published_at = result.rows[0]?.published_at ?? null;
    const data = result.rows.map(({ published_at: _pa, ...rest }) => rest);

    return res.json({ work_id: id, platform, published_at, data });
  } catch (err) {
    console.error('work performance single-platform error:', err);
    return res.status(500).json({ success: false, error: '查询失败' });
  }
});

export default router;
```

- [ ] **Step 2: 运行测试，验证新路由相关 case 失败（路由未注册）**

```bash
npx vitest run apps/api/tests/work-performance.test.ts 2>&1 | grep -E "FAIL|PASS|×|✓" | head -20
```

---

## Task 4：注册路由到 app.ts

**Files:**
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: 在 app.ts 引入并注册 work-performance 路由**

在 `apps/api/src/app.ts` 中，找到 `import worksRouter from './routes/works';` 这一行，在其后添加：

```typescript
import workPerformanceRouter from './routes/work-performance';
```

然后找到 `app.use('/api/works', worksRouter);` 这一行，在其**后**添加：

```typescript
app.use('/api/works/:id', workPerformanceRouter);
```

完整 app.ts 相关片段最终应为：

```typescript
import worksRouter from './routes/works';
import workPerformanceRouter from './routes/work-performance';
// ... 其他 import 不变 ...

app.use('/api/works', worksRouter);
app.use('/api/works/:id', workPerformanceRouter);
```

- [ ] **Step 2: 运行测试验证路由注册后 work-performance 测试通过**

```bash
npx vitest run apps/api/tests/work-performance.test.ts 2>&1 | tail -20
```

期望输出：全部 `PASS`（7 个测试）

- [ ] **Step 3: 运行全量测试确保没有回归**

```bash
npx vitest run apps/api/tests/ 2>&1 | tail -20
```

期望：所有原有测试仍 PASS

---

## Task 5：修改 ingest 端点加 saves 字段

**Files:**
- Modify: `apps/api/src/routes/snapshots.ts`

- [ ] **Step 1: 找到 ingest 的 INSERT 语句，替换为含 saves 的版本**

在 `apps/api/src/routes/snapshots.ts`，找到现有的 INSERT 语句：

```typescript
const result = await pool.query(
  `INSERT INTO zenithjoy.daily_snapshots
    (platform, content_id, scraped_date, scraped_at, title, views, likes, comments, shares, extra_data)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
   ON CONFLICT (platform, content_id, scraped_date) DO UPDATE SET
     scraped_at  = EXCLUDED.scraped_at,
     title       = COALESCE(EXCLUDED.title, zenithjoy.daily_snapshots.title),
     views       = EXCLUDED.views,
     likes       = EXCLUDED.likes,
     comments    = EXCLUDED.comments,
     shares      = EXCLUDED.shares,
     extra_data  = COALESCE(EXCLUDED.extra_data, zenithjoy.daily_snapshots.extra_data)
   RETURNING id`,
  [
    platform,
    content_id,
    scraped_date,
    scraped_at || new Date().toISOString(),
    title || null,
    views || 0,
    likes || 0,
    comments || 0,
    shares || 0,
    extra_data ? JSON.stringify(extra_data) : null,
  ]
);
```

替换为：

```typescript
const saves = item.saves || item.extra_data?.favorites || item.extra_data?.saves || 0;

const result = await pool.query(
  `INSERT INTO zenithjoy.daily_snapshots
    (platform, content_id, scraped_date, scraped_at, title, views, likes, comments, shares, saves, extra_data)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
   ON CONFLICT (platform, content_id, scraped_date) DO UPDATE SET
     scraped_at  = EXCLUDED.scraped_at,
     title       = COALESCE(EXCLUDED.title, zenithjoy.daily_snapshots.title),
     views       = EXCLUDED.views,
     likes       = EXCLUDED.likes,
     comments    = EXCLUDED.comments,
     shares      = EXCLUDED.shares,
     saves       = EXCLUDED.saves,
     extra_data  = COALESCE(EXCLUDED.extra_data, zenithjoy.daily_snapshots.extra_data)
   RETURNING id`,
  [
    platform,
    content_id,
    scraped_date,
    scraped_at || new Date().toISOString(),
    title || null,
    views || 0,
    likes || 0,
    comments || 0,
    shares || 0,
    saves,
    extra_data ? JSON.stringify(extra_data) : null,
  ]
);
```

注意：`saves` 变量声明要放在 `for (const item of items)` 循环内，`const { content_id, ... } = item;` 之后。

- [ ] **Step 2: 运行全量测试**

```bash
npx vitest run apps/api/tests/ 2>&1 | tail -20
```

期望：所有测试 PASS（包括原有 snapshots.test.ts + 新 work-performance.test.ts）

- [ ] **Step 3: 提交实现（TDD commit-2）**

```bash
git add apps/api/src/routes/work-performance.ts \
        apps/api/src/routes/snapshots.ts \
        apps/api/src/app.ts
git commit -m "feat(work-performance): 新增 /api/works/:id/performance 端点 + ingest saves 字段 [TDD commit-2]"
```

---

## Task 6：验证 smoke + 推送 PR

- [ ] **Step 1: 本地起 API 验证 smoke（可选，需要 DB）**

```bash
# 如果本地有 DB：
bash .github/workflows/scripts/smoke/work-performance-smoke.sh
```

- [ ] **Step 2: 检查 TypeScript 编译无报错**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | head -20
```

期望：无输出（无报错）

- [ ] **Step 3: 验证 git log 顺序（TDD commit-1 在 commit-2 之前）**

```bash
git log --oneline -5
```

期望顺序（从新到旧）：
```
feat(work-performance): 新增 /api/works/:id/performance 端点...  ← commit-2
test(work-performance): 写失败的集成测试 + smoke 骨架...         ← commit-1
feat(db): 正式建表 daily_snapshots，含 saves 列
docs: work performance backend 设计规格
```

- [ ] **Step 4: 推送分支（由主控发起）**

```bash
git push origin cp-04282000-skill-registry
```

---

## 前端 Handoff 摘要（交给 Cloud agent）

Cloud agent 需要在 `apps/dashboard/src/pages/WorkDetailPage.tsx` 的"数据采集" tab 实现：

**调用端点：**
- `GET /api/works/{workId}/performance` → 多平台对比
- `GET /api/works/{workId}/performance/{platform}` → 单平台详情

**Response 结构（已在 Task 3 实现）：**

```typescript
// 全平台
interface PerformanceResponse {
  work_id: string;
  platforms: Record<string, DayData[]>;
}

// 单平台
interface SinglePlatformResponse {
  work_id: string;
  platform: string;
  published_at: string | null;
  data: DayData[];
}

interface DayData {
  date: string;        // "2026-04-20"
  day_n: number;       // 1, 2, 3...
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}
```

**指标中文标签：**
```typescript
const METRIC_LABELS = {
  views:    '播放/浏览',
  likes:    '点赞',
  comments: '评论',
  shares:   '分享',
  saves:    '收藏',
};
```

**空状态处理：**
- `platforms` 为空对象 `{}` → 显示"该作品暂无平台发布记录"
- 某平台 `data` 为空数组 → 显示"暂无采集数据，等待下次采集"
