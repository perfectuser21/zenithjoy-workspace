# Work Performance Backend — 设计规格

**日期**: 2026-04-29  
**状态**: 已批准  
**范围**: 后端（Migration + API）；前端由 Cloud agent 接力

---

## 背景

用户需要在作品详情页看到：
- 单作品 × 单平台：发布后第 N 天的 views/likes/comments/shares/saves 曲线
- 单作品 × 多平台：同一作品跨平台横向对比

现有问题：
1. `zenithjoy.daily_snapshots` 无正式 migration
2. `saves` 字段藏在 `extra_data` JSONB 里
3. 现有 `/api/snapshots/work/:workId` 返回平铺数组，未按平台分组

---

## 数据架构（三层）

```
Layer 1: zenithjoy.daily_snapshots     ← 每平台每内容每天一条，统一字段
Layer 2: JOIN publish_logs + day_n计算  ← 作品视角，发布后第N天
Layer 3: 跨平台统一（Layer 1已做字段归一，不需额外表）
```

---

## Migration

### Migration 1：`20260429_000000_create_daily_snapshots.sql`

```sql
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

COMMIT;
```

### Migration 2：`20260429_000100_add_saves_to_ingest.sql`（如表已存在）

```sql
ALTER TABLE zenithjoy.daily_snapshots
  ADD COLUMN IF NOT EXISTS saves INTEGER NOT NULL DEFAULT 0;
```

---

## API 变更

### 修改 `POST /api/snapshots/ingest`

在 INSERT 语句中加入 `saves` 字段，从请求体的 `item.saves` 或 `item.extra_data?.favorites` 读取：

```typescript
const saves = item.saves || item.extra_data?.favorites || item.extra_data?.saves || 0;
```

### 新增 `GET /api/works/:id/performance`

**功能**：返回该作品在所有平台的逐日数据，按平台分组

**Response**：
```json
{
  "work_id": "uuid",
  "platforms": {
    "douyin": [
      { "day_n": 1, "date": "2026-04-20", "views": 5000, "likes": 300, "comments": 50, "shares": 20, "saves": 100 }
    ],
    "xiaohongshu": [
      { "day_n": 1, "date": "2026-04-20", "views": 2000, "likes": 150, "comments": 30, "shares": 10, "saves": 500 }
    ]
  }
}
```

**SQL**：
```sql
SELECT
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
ORDER BY pl.platform, ds.scraped_date
```

### 新增 `GET /api/works/:id/performance/:platform`

**功能**：返回该作品在指定平台的逐日数据

**Response**：
```json
{
  "work_id": "uuid",
  "platform": "douyin",
  "published_at": "2026-04-19T10:00:00Z",
  "data": [
    { "day_n": 1, "date": "2026-04-20", "views": 5000, "likes": 300, "comments": 50, "shares": 20, "saves": 100 }
  ]
}
```

---

## 文件变更清单

| 文件 | 操作 |
|---|---|
| `apps/api/db/migrations/20260429_000000_create_daily_snapshots.sql` | 新建 |
| `apps/api/db/migrations/20260429_000100_add_saves_to_ingest.sql` | 新建（备用） |
| `apps/api/src/routes/snapshots.ts` | 修改：ingest 加 saves；新增 2 个端点 |
| `apps/api/src/app.ts` | 确认路由注册 |
| `.github/workflows/scripts/smoke/work-performance-smoke.sh` | 新建 E2E smoke |
| `apps/api/tests/work-performance.test.ts` | 新建集成测试 |

---

## 测试策略

| 层级 | 内容 | 文件 |
|---|---|---|
| E2E smoke | POST ingest → GET performance 验证 day_n 计算 | `smoke/work-performance-smoke.sh` |
| 集成测试 | JOIN 逻辑，day_n=0/1/N，无数据时返回空 platforms | `tests/work-performance.test.ts` |
| 单元测试 | saves 字段从 extra_data 提取逻辑 | 同上文件 |

---

## 前端 Handoff（Cloud agent 需实现）

### 调用的端点
- `GET /api/works/:id/performance` → 多平台对比视图
- `GET /api/works/:id/performance/:platform` → 单平台详情视图

### UI 行为
- 多平台视图：按平台分 Tab 或并排折线图，X轴=day_n（"第N天"），Y轴=views
- 单平台视图：折线图，顶部 chip 切换指标（播放/点赞/评论/分享/收藏）
- 空状态：该平台已发布但无采集数据 → 显示"暂无数据，等待下次采集"
- 位置：`WorkDetailPage.tsx` 的"数据采集" tab

### 指标中文标签映射
```typescript
const METRIC_LABELS = {
  views:    '播放/浏览',
  likes:    '点赞',
  comments: '评论',
  shares:   '分享',
  saves:    '收藏',
};
```
