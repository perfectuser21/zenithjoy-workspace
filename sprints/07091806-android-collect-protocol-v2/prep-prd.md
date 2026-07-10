# Sprint 07091806 — Android 采集协议 V2

## 背景 & 断层分析

两阶段采集协议在 Stage1 存在回报端点缺口：

| 端点 | 现状 |
|------|------|
| `POST /collect/start` | ✅ 已实现 |
| `GET /pending-collect-tasks` | ✅ 已实现 |
| `POST /collect/stage1-report` | ❌ 缺口 #1（本 sprint 修复） |
| `POST /collect/report` | ✅ 已实现（Stage 2） |
| `POST /collect/sweep-timeouts` | ✅ 已实现 |

**缺口 #1（已修复）**：安卓端按关键词搜索视频后，无处回报视频清单 → `acquisition_collect_tasks` 永远卡在 `running` → Stage 2 从不启动。

## Stage1 回报端点契约

### 端点

POST /api/acquisition/collect/stage1-report

### 鉴权

无需 X-Smoke-Token（与 `collect/report` 一致，agent 直接调用）

### 请求体

{
  "task_id": "string (uuid, required)",
  "videos": [
    {
      "video_id": "string (required)",
      "title": "string | null (optional)",
      "thumbnail_url": "string | null (optional)",
      "publish_date": "string | null (optional)"
    }
  ],
  "terminal": "boolean (optional, default=false)"
}

- `task_id`：采集任务 ID（来自 `/collect/start` 或 `pending-collect-tasks`）
- `videos`：本次搜索找到的视频列表（可为空数组）
- `terminal`：`true` 表示 agent 已完成所有关键词的搜索，不会再有新视频

### 响应体

{
  "success": true,
  "data": {
    "task_id": "string",
    "inserted": "number",
    "total_videos": "number",
    "threshold": "number",
    "status": "running | stage_1_done | failed"
  },
  "timestamp": "ISO8601"
}

### 状态机推进规则

常量：MAX_VIDEOS_PER_KEYWORD = 3，threshold = MAX_VIDEOS_PER_KEYWORD × keywords.length

| 条件 | 新状态 | error_code |
|------|--------|------------|
| total_videos >= threshold | stage_1_done | — |
| terminal=true AND total_videos > 0 | stage_1_done | — |
| terminal=true AND total_videos = 0 | failed | STAGE1_NO_VIDEOS |
| terminal=false AND total_videos < threshold | 不变（running） | — |

### 幂等性

- 插入使用 ON CONFLICT (video_id) DO NOTHING
- 重复上报同一 video_id → inserted=0，不重复计数
- total_videos 来自 DB 实时计数，不受本次调用是否有新插入影响

### 存储

视频写入 zenithjoy.acquisition_collect_videos：
- video_id (PK)、task_id、tenant_id、title、thumbnail_url、publish_date、comment_count=0
- stage_1_done 后由 pending-collect-tasks 将已有视频 URL 列表返回给 agent 进行 Stage 2

## 测试覆盖

位置：apps/api/src/routes/acquisition.test.ts（追加到文件末尾）

| 测试 | 验证点 |
|------|--------|
| 缺 task_id → 400 | 入参校验 |
| task_id 不存在 → 404 | DB 查询不到 |
| 3 视频 + 1 关键词 → stage_1_done | 达阈推进 |
| terminal + 部分视频 → stage_1_done | partial terminal 推进 |
| terminal + 0 视频 → failed | 全部失败 |
| 重复回报同一 video_id → inserted=0 | 幂等不重计 |
| terminal=false + 不足 → 不更新状态 | 中间状态保持 |
