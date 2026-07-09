# Contract Draft — 安卓端补全采集两阶段协议

## 概述

本 sprint 在安卓 Agent（`services/agent-android`）侧实现 `AcquisitionCollectPollLoop`，每 30s 轮询 `GET /api/acquisition/pending-collect-tasks`，按 `stage:"stage_1"` 触发关键词搜索并上报视频卡，按 `stage:"stage_2"` 触发评论抓取并带 checkpoint 逐视频上报，从而打通 Dashboard「智能获客 → 采集」提交后安卓端零响应的断层；旧 `AcquisitionKeywordPollLoop` 双跑保留，服务端接口不新增端点。

---

## Test Contract 表

| # | Behavior | Test ID | Priority |
|---|---------|---------|---------|
| 1 | `pollOnce()` 在 agentId 非空时，GET 请求携带 `x-agent-id` 头并命中 `/pending-collect-tasks` 路径 | TC-001 | P0 |
| 2 | `pollOnce()` 收到 `stage:"stage_1"` 任务且 keywords 非空时，对每个关键词调用 `onStage1Task` 回调 | TC-002 | P0 |
| 3 | `pollOnce()` 收到 `stage:"stage_2"` 任务且 video_urls 非空时，调用 `onStage2Task` 回调并传入 video_urls | TC-003 | P0 |
| 4 | `pollOnce()` 返回空任务列表时，不触发任何回调 | TC-004 | P0 |
| 5 | `pollOnce()` 收到 `status:"cancelling"` 的任务时，调用 `onCancel` 回调并不触发 stage 回调 | TC-005 | P0 |
| 6 | `pollOnce()` 在 agentId 为空时，跳过 HTTP 请求（requestCount=0） | TC-006 | P1 |
| 7 | Stage1 回调内对每个关键词最多处理 N=3 个视频卡（超出截断） | TC-007 | P1 |
| 8 | `pollOnce()` HTTP 500 响应时，不崩溃，不触发任何回调 | TC-008 | P1 |

---

## E2E 验收

### 前提

- HK 服务器 API 运行中（`https://api.zenithjoy.com` 或本地 `http://localhost:3000`）
- 一台已注册 Agent 的安卓手机通过 USB 连接，adb 可用
- `AGENT_ID` 已知（从 `agents` 表取）

```bash
#!/usr/bin/env bash
set -e
API="http://localhost:3000"
AGENT_ID="<agent_id_from_db>"
TENANT_ID="<tenant_id>"

# E1: 插入一条 stage_1 任务，观察 ≤30s 后手机自动打开抖音搜索
TASK_ID=$(psql "$DATABASE_URL" -t -c "
  INSERT INTO zenithjoy.acquisition_collect_tasks
    (tenant_id, keywords, stage, status, created_at, updated_at)
  VALUES ('$TENANT_ID', '{\"测试关键词\"}', 'stage_1', 'pending', now(), now())
  RETURNING id;" | tr -d ' ')

echo "Task inserted: $TASK_ID"
echo "等待 ≤30s，观察 adb logcat | grep AcquisitionCollectPollLoop..."
adb logcat -s AcquisitionCollectPollLoop:D | timeout 35 grep -m1 "stage_1" && echo "E1 PASS"

# E2: 查 acquisition_collect_videos 有记录（Stage1 视频上报成功）
sleep 90  # 给 Stage1 跑完时间
VIDEO_COUNT=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) FROM zenithjoy.acquisition_collect_videos
  WHERE collect_task_id = '$TASK_ID';" | tr -d ' ')
[ "$VIDEO_COUNT" -ge 1 ] && echo "E2 PASS: video_count=$VIDEO_COUNT" || (echo "E2 FAIL" && exit 1)

# E3: 断点续传 — 强杀重启后 acquisition_leads 无重复 video_id
adb shell am force-stop com.zenithjoy.agent
adb shell am start -n com.zenithjoy.agent/.MainActivity
sleep 40  # 等一轮轮询
DUP=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) - COUNT(DISTINCT source_video_id) FROM zenithjoy.acquisition_leads
  WHERE collect_task_id = '$TASK_ID';" | tr -d ' ')
[ "$DUP" -eq 0 ] && echo "E3 PASS: no duplicate video_id" || (echo "E3 FAIL: dup=$DUP" && exit 1)

# E4: 取消测试
psql "$DATABASE_URL" -c "
  UPDATE zenithjoy.acquisition_collect_tasks
  SET status='cancelling' WHERE id='$TASK_ID';"
sleep 35  # 等下一轮轮询检测 cancelling
STATUS=$(psql "$DATABASE_URL" -t -c "
  SELECT status FROM zenithjoy.acquisition_collect_tasks WHERE id='$TASK_ID';" | tr -d ' ')
[ "$STATUS" = "cancelled" ] && echo "E4 PASS" || (echo "E4 FAIL: status=$STATUS" && exit 1)

# E5: 单元测试全通
cd /workspace
./gradlew -p services/agent-android :app:testDebugUnitTest --tests "com.zenithjoy.agent.AcquisitionCollectPollLoopTest" && echo "E5 PASS"
```

---

## API 接口约定

### GET /api/acquisition/pending-collect-tasks

**Request**
```
GET /api/acquisition/pending-collect-tasks
x-agent-id: <agentId>
```

**Response**
```json
{
  "tasks": [
    {
      "task_id": "uuid",
      "stage": "stage_1" | "stage_2",
      "status": "pending" | "running" | "stage_1_done" | "cancelling",
      "keywords": ["关键词1", "关键词2"],
      "video_urls": ["https://www.douyin.com/video/xxx"],
      "checkpoint": {
        "last_video_id": "xxx",
        "processed_video_ids": ["vid1", "vid2"]
      }
    }
  ],
  "total": 1
}
```

### POST /api/acquisition/collect/report

**Request**
```json
{
  "task_id": "uuid",
  "video_id": "douyin_video_id",
  "video_title": "视频标题",
  "thumbnail_url": "https://...",
  "publish_date": "2026-07-09",
  "commenters": [
    { "uid": "douyin_uid", "nickname": "昵称", "comment": "评论内容" }
  ],
  "checkpoint": {
    "last_video_id": "douyin_video_id",
    "processed_video_ids": ["vid1", "douyin_video_id"]
  },
  "terminal": false,
  "partial_reason": null
}
```

**Response**
```json
{ "success": true, "message": "reported" }
```

**取消上报（terminal=true）**
```json
{
  "task_id": "uuid",
  "video_id": null,
  "commenters": [],
  "checkpoint": { "last_video_id": null, "processed_video_ids": [] },
  "terminal": true,
  "partial_reason": "user_cancelled"
}
```

### POST /api/acquisition/collect/cancel

**Request**
```json
{ "task_id": "uuid" }
```

**Response**
```json
{ "success": true }
```

---

## 状态机

```
                    ┌──────────────────────────────────────────┐
                    │           acquisition_collect_tasks       │
                    └──────────────────────────────────────────┘

     [Dashboard 提交]
           │
           ▼
        pending
           │
           │  Agent 轮询到，开始 Stage1
           ▼
        running ──────────────────────────────────► cancelling
           │                  [用户取消]                  │
           │  所有关键词 × N 视频全部上报完成              │  Agent 检测到 cancelling，
           ▼  (collect/report × keywords.len×N)          │  调 collect/report(terminal=true,
      stage_1_done                                       │  partial_reason:"user_cancelled")
           │                                             ▼
           │  Agent 下一轮轮询到 stage_2                cancelled
           ▼
        running (stage_2)
           │
           │  每个 video_url 抓完评论，逐一 collect/report(terminal=false)
           │  最后一个 video_url: collect/report(terminal=true)
           ▼
        completed
           │
           │  服务端超时兜底（10min，sweep-timeouts）
           ▼
         failed
```

**关键约束**：
- `ScanMutex.busy=true` 期间，`AcquisitionKeywordPollLoop` 跳过采集（互斥）
- `resultReported` 闩（原子布尔）防止同一任务重复上报
- 任务 ID 区分策略：`AcquisitionCollectPollLoop` 维护内存 `Set<String> collectTaskIds`；`onCollectResult` 回调先查此 Set，命中走新协议上报路径（`/collect/report`），否则走旧协议（`/comment-score-result`）
