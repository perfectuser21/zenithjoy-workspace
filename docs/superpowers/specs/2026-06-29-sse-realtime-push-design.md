# SSE 实时推送设计文档

**日期**：2026-06-29  
**分支**：cp-06291752-sse-realtime-push  
**范围**：三处前端 HTTP 轮询 → Server-Sent Events 实时推送

---

## 问题

LeadsPage / TaskMonitor / LocalVideoPipelinePage 均用 setInterval 轮询 API：

| 组件 | 间隔 | 用户感知延迟 |
|------|------|------------|
| LeadsPage（获客任务） | 1500ms | 最多 1.5s |
| TaskMonitor（AI 视频） | 3000ms | 最多 3s |
| LocalVideoPipelinePage（本地视频） | 3000ms | 最多 3s |

改为 SSE 后延迟降到 ~50ms（网络 RTT），服务器省掉大量无效 HTTP 请求。

---

## 方案选择

| 方案 | 优点 | 缺点 |
|------|------|------|
| 缩短轮询间隔 | 改动最小 | 服务器压力倍增，延迟下限受限 |
| WebSocket | 双向实时 | 过度设计，状态推送只需单向 |
| **SSE（选用）** | 单向推送、原生 API、自动重连、HTTP 兼容 | 需要 nginx 专属配置 |

选 SSE：状态更新是纯单向（服务器→浏览器），无需 WebSocket 的双向能力。

---

## 架构

```
[状态变更触发点]          [SSE 服务]              [浏览器]
POST /collect/report  ──► sseService.emit()  ──► EventSource
PATCH /:id/progress   ──► sseService.emit()  ──► EventSource
PUT  /:id/complete    ──► sseService.emit()  ──► EventSource
PUT  /task/:id        ──► sseService.emit()  ──► EventSource
```

---

## 组件设计

### 1. SSE 连接管理器（新增）

**文件**：`apps/api/src/services/sse.service.ts`

```ts
// 核心数据结构
const connections = new Map<string, Set<Response>>();

subscribe(taskId, res):
  - 设置 SSE 响应头（Content-Type: text/event-stream, Cache-Control: no-cache）
  - 设置 X-Accel-Buffering: no（nginx 双保险，防止 proxy_buffering 遗漏）
  - 立即查 DB 发送当前状态（catch-up，防止订阅时错过已完成的事件）
  - 监听 req.on('close') 自动清理

emit(taskId, data):
  - 向该 taskId 的所有订阅者写 SSE 事件
  - 终态（done/failed/cancelled/completed）发完后关闭连接

unsubscribe(taskId, res):
  - 从 Set 移除，Set 空时删 Map 条目
```

### 2. 新增 SSE 端点（三处）

**acquisition.ts**：`GET /collect/:task_id/sse`
- 触发点：`POST /collect/report`（agent 增量上报）写 DB 后调 `sseService.emit()`
- 终态：`done / failed / cancelled`

**ai-video-pipeline.ts**：`GET /:id/sse`
- 触发点：`PATCH /:id/progress` 和 `PUT /:id/complete` 后调 `sseService.emit()`
- 终态：`completed / failed`

**ai-video.ts**：`GET /task/:id/sse`
- 触发点：`PUT /task/:id`（updateGeneration）后调 `sseService.emit()`
- 终态：`completed / failed`

### 3. 前端改动（三处）

**LeadsPage.tsx**：
- 删除 `acqPollRef` + `setInterval(poll, 1500)`
- 用 `useRef<EventSource>` 替代
- `useEffect` 在 `acqTaskId` 变化时 `new EventSource(...)`，监听 `message` 事件更新 `acqStatus`
- 终态时 `eventSource.close()`

**TaskMonitor.tsx**：
- 删除 `pollTaskStatus()` 调用
- 用 EventSource 替代，`onmessage` 更新 task 状态，终态时 close

**LocalVideoPipelinePage.tsx**：
- 删除 `setInterval(poll, 3000)`
- 用 EventSource 替代

### 4. Nginx 配置（必须同步改）

**文件**：`deploy/nginx.conf`、`deploy/nginx.staging.conf`

在通用 `location /api/` 块**之前**插入三个 SSE 专属 location：

```nginx
location ~ ^/api/acquisition/collect/[^/]+/sse$ {
    proxy_pass http://100.71.151.105:5200;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
location ~ ^/api/ai-video/task/[^/]+/sse$ {
    proxy_pass http://100.71.151.105:5200;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
location ~ ^/api/ai-video-pipeline/[^/]+/sse$ {
    proxy_pass http://100.71.151.105:5200;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

> 不加这三块，nginx 默认 `proxy_buffering on`，SSE 事件会积压到 8KB 才下发，完全失效。

---

## 数据流（以获客任务为例）

```
用户点"开始采集"
  → POST /collect/start → 返回 task_id
  → 前端 new EventSource(`/api/acquisition/collect/${task_id}/sse`)
  → 服务器立即发送当前状态（pending）

Agent 采集进度
  → POST /collect/report（带进度数据）
  → 写 DB → sseService.emit(taskId, {video_count, lead_count_raw, status})
  → EventSource.onmessage → setAcqStatus() → UI 即时更新

任务完成
  → status = 'done'
  → sseService.emit(taskId, {..., status: 'done'}) → 服务器关闭连接
  → EventSource 收到最终事件，前端 close()
```

---

## 错误处理

- **网络断开**：EventSource 自动重连（浏览器内置），服务器端 `req.on('close')` 清理残留订阅
- **任务不存在**：SSE 端点返回 HTTP 404，EventSource 触发 `onerror`，前端展示错误
- **服务器重启**：EventSource 重连后，服务器立即发送当前 DB 状态（catch-up 机制）

---

## 测试策略

| 层级 | 测试内容 | 位置 |
|------|---------|------|
| Unit | sseService subscribe/emit/unsubscribe 逻辑 | `apps/api/src/services/__tests__/sse.service.test.ts` |
| Integration | SSE 端点返回正确 Content-Type，emit 后客户端收到事件 | vitest + supertest |
| E2E（smoke） | curl -N `/api/acquisition/collect/:id/sse` 收到 data: 事件 | `.github/workflows/scripts/smoke/sse-smoke.sh` |

---

## 不包含

- `video-pipeline-worker.ts` 的 10s 后端 pull 轮询（job 处理器，不是状态通知，保持不变）
- 旧 HTTP GET 状态端点（保留，backend worker 仍使用）
- 认证鉴权（task ID 为 UUID，足够 opaque；与现有 GET 端点策略一致）
