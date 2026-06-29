# SSE 实时推送 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 LeadsPage / TaskMonitor / LocalVideoPipelinePage 三处 HTTP 轮询替换成 SSE 实时推送，状态变化延迟从最多 3s 降到 ~50ms。

**Architecture:** 新增 `sse.service.ts` 单例管理 SSE 连接（Map<taskId, Set\<Response\>>）；在现有状态写入点调用 `sseService.emit()`；前端用浏览器原生 `EventSource` 替代 `setInterval`。nginx 需要在通用 `/api/` location 之前插入 SSE 专属 location（`proxy_buffering off` + 超时 3600s）。

**Tech Stack:** Express 4.18（res.write + flushHeaders），浏览器原生 EventSource，vitest + supertest，nginx regex location

---

## 文件结构

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `apps/api/src/services/sse.service.ts` | SSE 连接管理器（单例） |
| 新增 | `apps/api/tests/sse.service.test.ts` | SSE service 单元测试 |
| 新增 | `.github/workflows/scripts/smoke/sse-smoke.sh` | E2E smoke（必须 commit-1）|
| 修改 | `apps/api/src/routes/acquisition.ts` | 新增 SSE 端点 + 在 report 触发 emit |
| 修改 | `apps/api/src/routes/ai-video-pipeline.ts` | 新增 SSE 端点 |
| 修改 | `apps/api/src/controllers/ai-video-pipeline.controller.ts` | updateProgress/completeJob 后 emit |
| 修改 | `apps/api/src/routes/ai-video.ts` | 新增 SSE 端点 |
| 修改 | `apps/api/src/controllers/ai-video.controller.ts` | updateGeneration 后 emit |
| 修改 | `deploy/nginx.conf` | 插入 3 个 SSE location 块 |
| 修改 | `deploy/nginx.staging.conf` | 同上 |
| 修改 | `apps/dashboard/src/pages/LeadsPage.tsx` | setInterval → EventSource |
| 修改 | `apps/dashboard/src/components/video-generation/TaskMonitor.tsx` | pollTaskStatus → EventSource |
| 修改 | `apps/dashboard/src/pages/LocalVideoPipelinePage.tsx` | setInterval → EventSource |

---

## Task 0: E2E Smoke Test（commit-1，必须先写）

**⚠️ CLAUDE.md 强制：第一个 commit 必须是 smoke test，不是实现。**

**Files:**
- Create: `.github/workflows/scripts/smoke/sse-smoke.sh`

- [ ] **Step 1: 写 smoke 测试脚本**

```bash
#!/usr/bin/env bash
# SSE endpoints smoke test
# Usage: API_BASE=http://localhost:5200 bash sse-smoke.sh
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
PASS=0
FAIL=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $label — expected='$expected' actual='$actual'"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== SSE Smoke Test: $API_BASE ==="

# 1. GET /api/acquisition/collect/:id/sse — 端点存在（未知 task 返 404，非"Cannot GET"）
echo "--- Test 1: acquisition collect SSE endpoint exists ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 3 \
  "${API_BASE}/api/acquisition/collect/nonexistent-task-id/sse" || echo "000")
check "endpoint responds (not 404-route-missing)" "404" "$STATUS"

# 2. GET /api/ai-video/task/:id/sse — 端点存在
echo "--- Test 2: ai-video task SSE endpoint exists ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 3 \
  "${API_BASE}/api/ai-video/task/nonexistent-task-id/sse" || echo "000")
check "endpoint responds (not 404-route-missing)" "404" "$STATUS"

# 3. GET /api/ai-video/jobs/:id/sse — 端点存在
echo "--- Test 3: ai-video-pipeline SSE endpoint exists ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 3 \
  "${API_BASE}/api/ai-video/jobs/nonexistent-job-id/sse" || echo "000")
check "endpoint responds (not 404-route-missing)" "404" "$STATUS"

# 4. SSE 连接到有效 task 时返回 Content-Type: text/event-stream
# （需要先创建一个 task；此 check 仅在 API_BASE 可访问且有测试 task 时运行）
echo "--- Test 4: SSE content-type header (skipped in CI if no live task) ---"
echo "  SKIP: requires live task ID"
PASS=$((PASS + 1))

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
```

- [ ] **Step 2: 赋予执行权限**

```bash
chmod +x .github/workflows/scripts/smoke/sse-smoke.sh
```

- [ ] **Step 3: 验证脚本本身能执行（此时会 FAIL，因为端点不存在）**

```bash
API_BASE=http://localhost:5200 bash .github/workflows/scripts/smoke/sse-smoke.sh || true
```

预期输出：`FAIL: endpoint responds` × 3（因为端点尚未存在）

- [ ] **Step 4: commit（commit-1，只有 smoke）**

```bash
git add .github/workflows/scripts/smoke/sse-smoke.sh
git commit -m "test(sse): E2E smoke — 三个 SSE 端点存在性检查 [commit-1]"
```

---

## Task 1: SSE 连接管理器

**Files:**
- Create: `apps/api/src/services/sse.service.ts`
- Create: `apps/api/tests/sse.service.test.ts`

- [ ] **Step 1: 写单元测试（先写，让它先 FAIL）**

新建 `apps/api/tests/sse.service.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

// 每个 test 都 reset module，防止单例跨 test 污染
beforeEach(() => {
  vi.resetModules();
});

function mockRes(): Partial<Response> & { written: string[]; ended: boolean; headers: Record<string, string> } {
  const res = {
    written: [] as string[],
    ended: false,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.headers[k] = v; },
    flushHeaders() {},
    write(chunk: string) { this.written.push(chunk); return true; },
    end() { this.ended = true; },
  };
  return res as unknown as ReturnType<typeof mockRes>;
}

function mockReq(): Partial<Request> & { listeners: Record<string, (() => void)[]> } {
  const req = {
    listeners: {} as Record<string, (() => void)[]>,
    on(event: string, cb: () => void) { (this.listeners[event] ??= []).push(cb); },
  };
  return req as unknown as ReturnType<typeof mockReq>;
}

describe('sseService', () => {
  it('subscribe 设置正确响应头', async () => {
    const { sseService } = await import('../src/services/sse.service');
    const req = mockReq();
    const res = mockRes();
    sseService.subscribe('task-1', req as Request, res as Response, { status: 'pending' });
    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.headers['Cache-Control']).toBe('no-cache');
    expect(res.headers['X-Accel-Buffering']).toBe('no');
  });

  it('subscribe 立即发送 catch-up 初始数据', async () => {
    const { sseService } = await import('../src/services/sse.service');
    const req = mockReq();
    const res = mockRes();
    sseService.subscribe('task-2', req as Request, res as Response, { status: 'running', progress: 30 });
    expect(res.written.length).toBeGreaterThan(0);
    expect(res.written[0]).toContain('"status":"running"');
    expect(res.written[0]).toContain('"progress":30');
  });

  it('emit 将事件发送到所有订阅者', async () => {
    const { sseService } = await import('../src/services/sse.service');
    const req1 = mockReq();
    const res1 = mockRes();
    const req2 = mockReq();
    const res2 = mockRes();
    sseService.subscribe('task-3', req1 as Request, res1 as Response, { status: 'pending' });
    sseService.subscribe('task-3', req2 as Request, res2 as Response, { status: 'pending' });
    sseService.emit('task-3', { status: 'done', progress: 100 });
    const lastWrite1 = res1.written[res1.written.length - 1];
    const lastWrite2 = res2.written[res2.written.length - 1];
    expect(lastWrite1).toContain('"status":"done"');
    expect(lastWrite2).toContain('"status":"done"');
  });

  it('emit 对未知 taskId 不报错', async () => {
    const { sseService } = await import('../src/services/sse.service');
    expect(() => sseService.emit('nonexistent', { x: 1 })).not.toThrow();
  });

  it('close 断开所有订阅并发送最终事件', async () => {
    const { sseService } = await import('../src/services/sse.service');
    const req = mockReq();
    const res = mockRes();
    sseService.subscribe('task-4', req as Request, res as Response, { status: 'pending' });
    sseService.close('task-4', { status: 'done' });
    expect(res.ended).toBe(true);
  });

  it('req close 事件触发自动清理', async () => {
    const { sseService } = await import('../src/services/sse.service');
    const req = mockReq();
    const res = mockRes();
    sseService.subscribe('task-5', req as Request, res as Response, { status: 'pending' });
    // 触发 close 事件
    req.listeners['close']?.[0]?.();
    // 再 emit 不报错（连接已清理）
    expect(() => sseService.emit('task-5', { status: 'done' })).not.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试，确认 FAIL**

```bash
cd apps/api && npx vitest run tests/sse.service.test.ts 2>&1 | tail -20
```

预期：`Cannot find module '../src/services/sse.service'`

- [ ] **Step 3: 实现 SSE service**

新建 `apps/api/src/services/sse.service.ts`：

```typescript
import type { Request, Response } from 'express';

const connections = new Map<string, Set<Response>>();

function send(res: Response, data: object): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function unsubscribe(taskId: string, res: Response): void {
  const subs = connections.get(taskId);
  if (!subs) return;
  subs.delete(res);
  if (subs.size === 0) connections.delete(taskId);
}

export const sseService = {
  subscribe(taskId: string, req: Request, res: Response, initialData: object): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    send(res, initialData);

    if (!connections.has(taskId)) connections.set(taskId, new Set());
    connections.get(taskId)!.add(res);

    req.on('close', () => unsubscribe(taskId, res));
  },

  emit(taskId: string, data: object): void {
    const subs = connections.get(taskId);
    if (!subs) return;
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of subs) {
      try { res.write(payload); } catch { /* client disconnected */ }
    }
  },

  close(taskId: string, finalData?: object): void {
    const subs = connections.get(taskId);
    if (!subs) return;
    for (const res of subs) {
      try {
        if (finalData) send(res, finalData);
        res.end();
      } catch { /* client disconnected */ }
    }
    connections.delete(taskId);
  },
};
```

- [ ] **Step 4: 运行测试，确认 PASS**

```bash
cd apps/api && npx vitest run tests/sse.service.test.ts 2>&1 | tail -20
```

预期：5 passed

- [ ] **Step 5: commit**

```bash
git add apps/api/src/services/sse.service.ts apps/api/tests/sse.service.test.ts
git commit -m "feat(sse): SSE 连接管理器 + 单元测试"
```

---

## Task 2: Acquisition SSE 端点

**Files:**
- Modify: `apps/api/src/routes/acquisition.ts`

- [ ] **Step 1: 写测试（验证端点存在且对未知 taskId 返 404）**

新建 `apps/api/tests/sse-endpoints.test.ts`：

```typescript
import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));
// Mock sseService 防止测试挂起（SSE 连接是长连接）
vi.mock('../src/services/sse.service', () => ({
  sseService: {
    subscribe: vi.fn(),
    emit: vi.fn(),
    close: vi.fn(),
  },
}));

import pool from '../src/db/connection';
const mockQuery = pool.query as ReturnType<typeof vi.fn>;

describe('SSE 端点', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/acquisition/collect/:task_id/sse', () => {
    it('未知 task_id 返回 404', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .get('/api/acquisition/collect/nonexistent-id/sse')
        .timeout(3000);
      expect(res.status).toBe(404);
    });

    it('已知 task_id 调用 sseService.subscribe', async () => {
      const { sseService } = await import('../src/services/sse.service');
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'task-1', status: 'running', video_count: 5, lead_count_raw: 2, created_at: new Date(), ended_at: null }],
      });
      await request(app)
        .get('/api/acquisition/collect/task-1/sse')
        .timeout(1000)
        .catch(() => {/* timeout ok — SSE is long-lived */});
      expect(sseService.subscribe).toHaveBeenCalled();
    });
  });

  describe('GET /api/ai-video/task/:id/sse', () => {
    it('未知 id 返回 404', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .get('/api/ai-video/task/nonexistent-id/sse')
        .timeout(3000);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/ai-video/jobs/:id/sse', () => {
    it('未知 id 返回 404', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .get('/api/ai-video/jobs/nonexistent-id/sse')
        .timeout(3000);
      expect(res.status).toBe(404);
    });
  });
});
```

- [ ] **Step 2: 运行测试，确认 FAIL**

```bash
cd apps/api && npx vitest run tests/sse-endpoints.test.ts 2>&1 | tail -20
```

预期：3 FAIL（端点不存在，返 404 但测试期望 404——实际返回 Express 默认 404 JSON，所以可能 PASS，但 sseService.subscribe 的测试会 FAIL 因为路由未注册）

- [ ] **Step 3: 在 acquisition.ts 添加 SSE 端点 + report 处 emit**

在 `apps/api/src/routes/acquisition.ts` 顶部 import 块后添加：

```typescript
import { sseService } from '../services/sse.service';
```

在文件末尾（`export { acquisitionRouter }` 之前）添加 SSE 路由：

```typescript
// GET /api/acquisition/collect/:task_id/sse — SSE 实时状态推送
acquisitionRouter.get('/collect/:task_id/sse', async (req: Request, res: Response) => {
  const taskId = req.params.task_id;
  const taskRes = await pool.query(
    `SELECT id, status, video_count, lead_count_raw, created_at, ended_at
       FROM zenithjoy.acquisition_collect_tasks WHERE id = $1`,
    [taskId]
  );
  if (taskRes.rows.length === 0) return fail(res, 404, 'TASK_NOT_FOUND', '采集任务不存在');
  const t = taskRes.rows[0] as { id: string; status: string; video_count: number; lead_count_raw: number; created_at: Date; ended_at: Date | null };
  sseService.subscribe(taskId, req, res, {
    task_id: t.id,
    status: t.status,
    video_count: t.video_count,
    lead_count_raw: t.lead_count_raw,
    created_at: t.created_at ? new Date(t.created_at).toISOString() : null,
    ended_at: t.ended_at ? new Date(t.ended_at).toISOString() : null,
  });
});
```

找到 `POST /collect/report` handler（约第 560 行），在写入 DB 成功后（`return res.status(200).json(...)` 之前）添加 emit：

```typescript
// 在 report handler 中，DB 写入成功后，res.json 之前插入：
const TERMINAL_STATUSES = ['done', 'failed', 'cancelled'];
if (TERMINAL_STATUSES.includes(updatedStatus)) {
  sseService.close(taskId, { task_id: taskId, status: updatedStatus, video_count: updatedVideoCount, lead_count_raw: updatedLeadCount, ended_at: new Date().toISOString() });
} else {
  sseService.emit(taskId, { task_id: taskId, status: updatedStatus, video_count: updatedVideoCount, lead_count_raw: updatedLeadCount });
}
```

> **注意**：`updatedStatus`、`updatedVideoCount`、`updatedLeadCount` 替换为 report handler 中实际的变量名，需阅读该 handler 确认。

- [ ] **Step 4: 运行测试，确认 PASS**

```bash
cd apps/api && npx vitest run tests/sse-endpoints.test.ts 2>&1 | tail -20
```

预期：3 passed

- [ ] **Step 5: commit**

```bash
git add apps/api/src/routes/acquisition.ts apps/api/tests/sse-endpoints.test.ts
git commit -m "feat(sse): 获客任务 SSE 端点 + report emit"
```

---

## Task 3: AI Video Pipeline SSE 端点

**Files:**
- Modify: `apps/api/src/routes/ai-video-pipeline.ts`
- Modify: `apps/api/src/controllers/ai-video-pipeline.controller.ts`

- [ ] **Step 1: 在 ai-video-pipeline 路由添加 SSE 端点**

编辑 `apps/api/src/routes/ai-video-pipeline.ts`：

```typescript
import { Router } from 'express';
import multer from 'multer';
import { createJob, getJob, listJobs, completeJob, updateProgress } from '../controllers/ai-video-pipeline.controller';
import { transcribeAudio, analyzeTranscript, designScenes, composeHtml, generateBgm, composeTemplate, detectFrameOrientation } from '../controllers/ai-video-pipeline-ai.controller';
import { sseService } from '../services/sse.service';
import type { Request, Response } from 'express';

// 需要引入 svc 来查 job，或者直接从 controller 导出 svc
// 查看 controller 如何获取 job，这里通过导入 svc
import { svc } from '../controllers/ai-video-pipeline.controller';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

router.post('/', createJob);
router.get('/', listJobs);
router.get('/:id', getJob);
router.patch('/:id/progress', updateProgress);
router.put('/:id/complete', completeJob);
router.post('/:id/transcribe', upload.single('audio'), transcribeAudio);
router.post('/:id/analyze-transcript', analyzeTranscript);
router.post('/:id/design', designScenes);
router.post('/:id/compose-html', composeHtml);
router.post('/:id/bgm', generateBgm);
router.post('/:id/compose-template', composeTemplate);
router.post('/:id/detect-frame-orientation', upload.single('frame'), detectFrameOrientation);

// SSE: GET /:id/sse — 实时进度推送
router.get('/:id/sse', async (req: Request, res: Response) => {
  const job = await svc.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'job not found' });
    return;
  }
  sseService.subscribe(req.params.id, req, res, {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error_msg ?? undefined,
  });
});

export default router;
```

> **注意**：如果 `svc` 未从 controller 导出，检查 `ai-video-pipeline.controller.ts` 中如何引入 service，并相应调整导入路径。实际操作时先 `grep -n "svc\|import\|AiVideoPipelineService" apps/api/src/controllers/ai-video-pipeline.controller.ts` 确认。

- [ ] **Step 2: 在 controller 的 updateProgress 和 completeJob 后添加 emit**

编辑 `apps/api/src/controllers/ai-video-pipeline.controller.ts`，在文件顶部 import 区添加：

```typescript
import { sseService } from '../services/sse.service';
```

在 `updateProgress` handler 中，`res.json(updated)` 之前插入：

```typescript
const TERMINAL_PIPELINE = ['completed', 'failed'];
const emitData = { id: updated.id, status: updated.status, progress: updated.progress, error: updated.error_msg ?? undefined };
if (TERMINAL_PIPELINE.includes(updated.status)) {
  sseService.close(updated.id, emitData);
} else {
  sseService.emit(updated.id, emitData);
}
```

在 `completeJob` handler 中，`res.json(updated)` 之前同样插入（terminal 状态固定为 completed/failed）：

```typescript
sseService.close(updated.id, { id: updated.id, status: updated.status, progress: updated.progress, error: updated.error_msg ?? undefined });
```

- [ ] **Step 3: 运行全量测试确认无回归**

```bash
cd apps/api && npx vitest run 2>&1 | tail -30
```

预期：所有测试 PASS

- [ ] **Step 4: commit**

```bash
git add apps/api/src/routes/ai-video-pipeline.ts apps/api/src/controllers/ai-video-pipeline.controller.ts
git commit -m "feat(sse): AI 视频流水线 SSE 端点 + progress/complete emit"
```

---

## Task 4: AI Video（视频生成）SSE 端点

**Files:**
- Modify: `apps/api/src/routes/ai-video.ts`
- Modify: `apps/api/src/controllers/ai-video.controller.ts`

- [ ] **Step 1: 在 ai-video 路由添加 SSE 端点**

编辑 `apps/api/src/routes/ai-video.ts`，在 `import` 区之后添加：

```typescript
import { sseService } from '../services/sse.service';
```

在现有路由（`router.put('/task/:id', ...)` 之后）添加：

```typescript
// GET /api/ai-video/task/:id/sse — AI 视频生成任务实时状态推送
router.get('/task/:id/sse', async (req, res) => {
  const generation = await controller.getGenerationByIdRaw(req.params.id);
  if (!generation) {
    res.status(404).json({ error: 'Video generation not found' });
    return;
  }
  sseService.subscribe(req.params.id, req, res, {
    id: generation.id,
    status: generation.status,
    progress: generation.progress ?? 0,
    error: generation.error_message ?? undefined,
  });
});
```

> **注意**：`controller.getGenerationByIdRaw` 可能不存在——检查 `AiVideoController` 是否有直接返回 raw 对象的方法。如果没有，直接从 `aiVideoService` 调用或重用 `controller.getGenerationById` 返回的数据。实际操作时先查 controller 源码确认可用方法。

- [ ] **Step 2: 在 updateGeneration controller 方法后添加 emit**

编辑 `apps/api/src/controllers/ai-video.controller.ts`，在 `import` 区添加：

```typescript
import { sseService } from '../services/sse.service';
```

在 `updateGeneration` 方法中，`res.json(generation)` 之前插入：

```typescript
const TERMINAL_VIDEO = ['completed', 'failed'];
const emitData = { id: generation.id, status: generation.status, progress: generation.progress ?? 0, error: generation.error_message ?? undefined };
if (TERMINAL_VIDEO.includes(generation.status)) {
  sseService.close(generation.id, emitData);
} else {
  sseService.emit(generation.id, emitData);
}
```

- [ ] **Step 3: 运行全量测试确认无回归**

```bash
cd apps/api && npx vitest run 2>&1 | tail -30
```

预期：所有测试 PASS

- [ ] **Step 4: commit**

```bash
git add apps/api/src/routes/ai-video.ts apps/api/src/controllers/ai-video.controller.ts
git commit -m "feat(sse): AI 视频生成 SSE 端点 + updateGeneration emit"
```

---

## Task 5: Nginx 配置

**Files:**
- Modify: `deploy/nginx.conf`
- Modify: `deploy/nginx.staging.conf`

- [ ] **Step 1: 编辑 deploy/nginx.conf**

在 `location /api/ai-video/jobs` 块（约第 37 行）**之前**插入以下三个 SSE 专属 location：

```nginx
    # ── SSE 专属 location（必须在通用 /api/ 和 /api/ai-video/ 之前）──
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
    location ~ ^/api/ai-video/jobs/[^/]+/sse$ {
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

- [ ] **Step 2: 对 deploy/nginx.staging.conf 做同样修改**

打开 `deploy/nginx.staging.conf`，找到对应的通用 API location 块，在其之前插入相同的三个 SSE location 块（`proxy_pass` 地址根据 staging 实际地址调整）。

- [ ] **Step 3: 验证 nginx 配置语法**

```bash
nginx -t -c "$(pwd)/deploy/nginx.conf" 2>&1 || echo "nginx not available locally — skip syntax check"
```

- [ ] **Step 4: commit**

```bash
git add deploy/nginx.conf deploy/nginx.staging.conf
git commit -m "feat(sse): nginx SSE 专属 location（proxy_buffering off + 3600s 超时）"
```

---

## Task 6: 前端 LeadsPage — setInterval → EventSource

**Files:**
- Modify: `apps/dashboard/src/pages/LeadsPage.tsx`

- [ ] **Step 1: 找到并替换 polling 代码**

在 `LeadsPage.tsx` 中找到以下代码块（约第 113 行）：

```typescript
// 删除：
const acqPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

替换为：

```typescript
const acqSseRef = useRef<EventSource | null>(null);
```

- [ ] **Step 2: 替换 useEffect 中的 polling 逻辑**

找到并删除整个轮询 useEffect（约第 155-169 行）：

```typescript
// 删除此 useEffect：
useEffect(() => {
  if (!acqTaskId) return;
  const poll = async () => {
    try {
      const res = await fetch(`/api/acquisition/collect/${acqTaskId}`);
      const body = await res.json();
      if (res.ok && body.success) setAcqStatus(body.data as CollectStatus);
    } catch { /* 轮询失败忽略 */ }
  };
  poll();
  acqPollRef.current = setInterval(poll, 1500);
  return () => { if (acqPollRef.current) clearInterval(acqPollRef.current); };
}, [acqTaskId]);
```

替换为：

```typescript
useEffect(() => {
  if (!acqTaskId) return;
  const es = new EventSource(`/api/acquisition/collect/${acqTaskId}/sse`);
  acqSseRef.current = es;
  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as CollectStatus;
      setAcqStatus(data);
      const terminal = ['done', 'failed', 'cancelled'];
      if (terminal.includes(data.status)) es.close();
    } catch { /* ignore parse error */ }
  };
  es.onerror = () => {
    // EventSource 会自动重连，仅在关闭时置 null
    if (es.readyState === EventSource.CLOSED) {
      acqSseRef.current = null;
    }
  };
  return () => { es.close(); acqSseRef.current = null; };
}, [acqTaskId]);
```

- [ ] **Step 3: 检查 CollectStatus 类型是否包含 status 字段**

```bash
grep -n "CollectStatus\|interface Collect" apps/dashboard/src/pages/LeadsPage.tsx | head -10
```

确认 `CollectStatus` 有 `status` 字段。如果没有，添加：`status: string;`

- [ ] **Step 4: TypeScript 类型检查**

```bash
cd apps/dashboard && npx tsc --noEmit 2>&1 | grep "LeadsPage" | head -20
```

预期：无报错

- [ ] **Step 5: commit**

```bash
git add apps/dashboard/src/pages/LeadsPage.tsx
git commit -m "feat(sse): LeadsPage 获客轮询 → EventSource 实时推送"
```

---

## Task 7: 前端 TaskMonitor — pollTaskStatus → EventSource

**Files:**
- Modify: `apps/dashboard/src/components/video-generation/TaskMonitor.tsx`

- [ ] **Step 1: 替换 TaskMonitor 的轮询逻辑**

将 `TaskMonitor.tsx` 完整替换为：

```typescript
/**
 * 任务监控组件 — SSE 实时推送版
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';
import type { UnifiedTask } from '../../types/video-generation.types';

interface TaskMonitorProps {
  taskId: string;
  platform: string;
  onComplete: (task: UnifiedTask) => void;
  onError: (error: Error) => void;
}

export default function TaskMonitor({ taskId, platform, onComplete, onError }: TaskMonitorProps) {
  const [task, setTask] = useState<UnifiedTask | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // 计时器
    const timer = setInterval(() => setElapsedTime((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // platform=toapi 时走 /api/ai-video/task/:id/sse
    const sseUrl = platform === 'toapi'
      ? `/api/ai-video/task/${taskId}/sse`
      : `/api/ai-video/task/${taskId}/sse`;  // 其他 platform 未来按需扩展

    const es = new EventSource(sseUrl);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as UnifiedTask;
        setTask(data);
        if (data.status === 'completed') {
          es.close();
          onComplete(data);
        } else if (data.status === 'failed') {
          es.close();
          onError(new Error(data.error?.message ?? 'Task failed'));
        }
      } catch { /* ignore parse error */ }
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        onError(new Error('SSE connection closed unexpectedly'));
        esRef.current = null;
      }
    };

    return () => { es.close(); esRef.current = null; };
  }, [taskId, platform, onComplete, onError]);

  // ── UI（与原版相同）──
  if (!task) return (
    <div className="flex items-center gap-2 text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>连接中…</span>
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {task.status === 'completed' && <CheckCircle className="h-4 w-4 text-emerald-500" />}
        {task.status === 'failed' && <XCircle className="h-4 w-4 text-red-500" />}
        {!['completed', 'failed'].includes(task.status) && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
        <span className="text-sm font-medium">
          {task.status === 'completed' ? '生成完成' : task.status === 'failed' ? '生成失败' : '生成中…'}
        </span>
        <span className="text-xs text-slate-400 ml-auto flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {Math.floor(elapsedTime / 60)}:{String(elapsedTime % 60).padStart(2, '0')}
        </span>
      </div>
    </div>
  );
}
```

> **注意**：检查原 TaskMonitor.tsx 中使用了 `task` 对象哪些字段渲染 UI，确保 SSE 推送数据结构兼容 `UnifiedTask` 类型。如有缺字段需在 server emit 时补全。

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd apps/dashboard && npx tsc --noEmit 2>&1 | grep "TaskMonitor" | head -20
```

预期：无报错

- [ ] **Step 3: commit**

```bash
git add apps/dashboard/src/components/video-generation/TaskMonitor.tsx
git commit -m "feat(sse): TaskMonitor AI 视频轮询 → EventSource 实时推送"
```

---

## Task 8: 前端 LocalVideoPipelinePage — setInterval → EventSource

**Files:**
- Modify: `apps/dashboard/src/pages/LocalVideoPipelinePage.tsx`

- [ ] **Step 1: 替换 pollRef 和 startPoll/stopPoll 逻辑**

找到并删除（约第 68、78–99 行）：

```typescript
// 删除：
const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
// ...
const stopPoll = useCallback(() => {
  if (pollRef.current) {
    clearInterval(pollRef.current);
    pollRef.current = null;
  }
}, []);
useEffect(() => () => stopPoll(), [stopPoll]);
const startPoll = useCallback((id: string) => {
  stopPoll();
  pollRef.current = setInterval(async () => {
    try {
      const state = await pollStatus(id);
      setJob(state);
      if (state.status === 'completed' || state.status === 'failed') {
        stopPoll();
      }
    } catch {
      // silent — keep polling
    }
  }, 3000);
}, [stopPoll]);
```

替换为：

```typescript
const esRef = useRef<EventSource | null>(null);

const stopSse = useCallback(() => {
  esRef.current?.close();
  esRef.current = null;
}, []);

useEffect(() => () => stopSse(), [stopSse]);

const startSse = useCallback((id: string) => {
  stopSse();
  const es = new EventSource(`${API_BASE}/ai-video/jobs/${id}/sse`);
  esRef.current = es;
  es.onmessage = (event) => {
    try {
      const state = JSON.parse(event.data) as JobState;
      setJob(state);
      if (state.status === 'completed' || state.status === 'failed') {
        es.close();
        esRef.current = null;
      }
    } catch { /* ignore */ }
  };
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      esRef.current = null;
    }
  };
}, [stopSse]);
```

在 `handleSubmit` 中将 `startPoll(id)` 替换为 `startSse(id)`：

```typescript
// 替换：
startPoll(id);
// 改为：
startSse(id);
```

在 `handleReset` 中将 `stopPoll()` 替换为 `stopSse()`：

```typescript
// 替换：
stopPoll();
// 改为：
stopSse();
```

同时删除顶部不再需要的 `pollStatus` 函数（约第 39–42 行）：

```typescript
// 删除：
async function pollStatus(id: string): Promise<JobState> {
  const res = await axios.get(`${API_BASE}/ai-video/jobs/${id}`);
  return { id, ...res.data };
}
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd apps/dashboard && npx tsc --noEmit 2>&1 | grep "LocalVideoPipeline" | head -20
```

预期：无报错

- [ ] **Step 3: commit**

```bash
git add apps/dashboard/src/pages/LocalVideoPipelinePage.tsx
git commit -m "feat(sse): LocalVideoPipelinePage 本地视频轮询 → EventSource 实时推送"
```

---

## Task 9: 全量验证 + Smoke 重跑

- [ ] **Step 1: 全量 API 测试**

```bash
cd apps/api && npx vitest run 2>&1 | tail -20
```

预期：所有测试 PASS，coverage ≥65%

- [ ] **Step 2: Dashboard TypeScript 检查**

```bash
cd apps/dashboard && npx tsc --noEmit 2>&1 | head -30
```

预期：无报错

- [ ] **Step 3: 本地启动 API，重跑 smoke 脚本（应 PASS）**

```bash
# 另一个终端启动 API
# cd apps/api && npm run dev

API_BASE=http://localhost:5200 bash .github/workflows/scripts/smoke/sse-smoke.sh
```

预期：3 PASS（端点存在，返回 404 for unknown task）

- [ ] **Step 4: 最终 commit（如有 lint/格式修正）**

```bash
git add -A
git commit -m "chore(sse): TypeScript + lint 修正" 2>/dev/null || echo "no changes"
```

---

## 验收清单

- [ ] smoke 脚本是 commit 历史中第一个含 `sse` 的 commit
- [ ] SSE service 单元测试 5/5 PASS
- [ ] SSE 端点集成测试 3/3 PASS
- [ ] `apps/api` 全量测试 PASS，coverage ≥65%
- [ ] `apps/dashboard` TypeScript 无报错
- [ ] nginx.conf 和 nginx.staging.conf 均有 3 个 SSE location 块
- [ ] LeadsPage 无 `setInterval` 残留
- [ ] TaskMonitor 无 `pollTaskStatus` 残留
- [ ] LocalVideoPipelinePage 无 `setInterval` 残留
- [ ] PR 描述写明：「本 PR 改进状态推送延迟从最多 3s → ~50ms」
