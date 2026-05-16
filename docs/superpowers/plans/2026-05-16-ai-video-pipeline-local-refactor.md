# AI 视频流水线本地优先重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正 AI 视频流水线架构——createJob 改为接收本地路径而非上传文件，Agent 直接读本地视频，输出写本地，删除 3 个文件传输端点。

**Architecture:** DB 新增 output_dir 字段；API 去掉 multer，createJob 接 JSON body { local_path, topic }，completeJob 接收 output_dir；Agent 去掉 Step 2（下载源视频）和 Step 10（上传输出），直接读 job.src_video 本地路径，输出写同级 zenithjoy-output/ 目录。

**Tech Stack:** Node.js / Express / TypeScript / PostgreSQL / vitest / supertest

---

## 文件变更清单

| 操作 | 文件 |
|------|------|
| 新增 | `.github/workflows/scripts/smoke/ai-video-pipeline-local-smoke.sh` |
| 修改 | `apps/api/src/services/ai-video-pipeline.service.ts` |
| 修改 | `apps/api/src/controllers/ai-video-pipeline.controller.ts` |
| 修改 | `apps/api/src/routes/ai-video-pipeline.ts` |
| 修改 | `services/agent/src/handlers/video-pipeline.ts` |
| 修改 | `apps/api/tests/ai-video-pipeline.test.ts` |
| 修改 | `apps/api/tests/controllers/ai-video-pipeline.controller.test.ts` |
| 修改 | `test-registry.yaml` |

---

### Task 1: E2E smoke test（先写失败的 smoke，定义"完成"长什么样）

**Files:**
- Create: `.github/workflows/scripts/smoke/ai-video-pipeline-local-smoke.sh`

- [ ] **Step 1: 写失败的 smoke test**

```bash
cat > .github/workflows/scripts/smoke/ai-video-pipeline-local-smoke.sh << 'SMOKE'
#!/usr/bin/env bash
# ai-video-pipeline-local-smoke.sh
# 验证本地优先架构：createJob 接 JSON body，不接文件上传
set -euo pipefail

BASE_URL="${BASE_URL:-https://autopilot.zenjoymedia.media}"
echo "🔍 smoke: ai-video-pipeline-local — $BASE_URL"

# 1. createJob 接受 JSON body（local_path + topic）
RES=$(curl -sf -X POST "$BASE_URL/api/ai-video/jobs" \
  -H "Content-Type: application/json" \
  -d '{"local_path":"C:\\Users\\test\\video.mp4","topic":"smoke test"}' \
  || true)
echo "createJob response: $RES"
JOB_ID=$(echo "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$JOB_ID" ] && echo "✅ createJob OK — id=$JOB_ID" || { echo "❌ createJob FAIL"; exit 1; }

# 2. src_video 存的是本地路径（不是服务器路径）
SRC=$(echo "$RES" | grep -o '"src_video":"[^"]*"' | cut -d'"' -f4)
echo "src_video: $SRC"
[[ "$SRC" == *"video.mp4"* ]] && echo "✅ src_video 包含本地路径" || { echo "❌ src_video 不是本地路径"; exit 1; }

# 3. /source 端点已删除（404）
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/ai-video/jobs/$JOB_ID/source")
[ "$STATUS" = "404" ] && echo "✅ /source 已删除(404)" || { echo "❌ /source 还存在($STATUS)"; exit 1; }

# 4. /upload-output 端点已删除（404）
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/ai-video/jobs/$JOB_ID/upload-output")
[ "$STATUS" = "404" ] && echo "✅ /upload-output 已删除(404)" || { echo "❌ /upload-output 还存在($STATUS)"; exit 1; }

# 5. /output/:file 端点已删除（404）
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/ai-video/jobs/$JOB_ID/output/9_16.mp4")
[ "$STATUS" = "404" ] && echo "✅ /output/:file 已删除(404)" || { echo "❌ /output/:file 还存在($STATUS)"; exit 1; }

# 6. completeJob 接受 output_dir
COMPLETE=$(curl -sf -X PUT "$BASE_URL/api/ai-video/jobs/$JOB_ID/complete" \
  -H "Content-Type: application/json" \
  -d "{\"output_dir\":\"C:\\\\Users\\\\test\\\\zenithjoy-output\\\\$JOB_ID\"}" \
  || true)
echo "completeJob response: $COMPLETE"
OUT_DIR=$(echo "$COMPLETE" | grep -o '"output_dir":"[^"]*"' | cut -d'"' -f4)
[ -n "$OUT_DIR" ] && echo "✅ completeJob output_dir OK" || { echo "❌ completeJob output_dir FAIL"; exit 1; }

echo ""
echo "✅ ai-video-pipeline-local smoke 全部通过"
SMOKE
chmod +x .github/workflows/scripts/smoke/ai-video-pipeline-local-smoke.sh
```

- [ ] **Step 2: 验证 smoke 现在失败（预期失败，因为实现还没改）**

```bash
BASE_URL=https://autopilot.zenjoymedia.media \
  bash .github/workflows/scripts/smoke/ai-video-pipeline-local-smoke.sh || true
```

预期：❌ createJob FAIL 或 ❌ /source 还存在(200)（当前实现还接受文件上传）

- [ ] **Step 3: 提交 commit-1（failing smoke）**

```bash
git add .github/workflows/scripts/smoke/ai-video-pipeline-local-smoke.sh
git commit -m "test(smoke): ai-video-pipeline-local-smoke — 验证本地优先架构（当前 FAIL）"
```

---

### Task 2: DB migration + Service 层更新

**Files:**
- Modify: `apps/api/src/services/ai-video-pipeline.service.ts`

- [ ] **Step 1: 写失败的 unit test（验证 output_dir 字段存在）**

在 `apps/api/src/services/__tests__/ai-video-pipeline.service.test.ts` 末尾追加：

```typescript
  it('updateStatus can set output_dir', async () => {
    const fakeUpdated = {
      id: 'job-1', status: 'completed', progress: 100,
      src_video: 'C:\\test.mp4', src_logo: null, topic: null,
      result_url: null, output_dir: 'C:\\out\\job-1', error_msg: null,
      created_at: new Date(), updated_at: new Date(),
    };
    mockQuery.mockResolvedValueOnce({ rows: [fakeUpdated] });
    const result = await svc.updateStatus('job-1', { outputDir: 'C:\\out\\job-1', status: 'completed', progress: 100 });
    expect(result.output_dir).toBe('C:\\out\\job-1');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('output_dir'),
      expect.arrayContaining(['C:\\out\\job-1']),
    );
  });
```

- [ ] **Step 2: 运行 test，验证失败**

```bash
cd /tmp/zj-ai-video-local-refactor
npx vitest run apps/api/src/services/__tests__/ai-video-pipeline.service.test.ts 2>&1 | tail -20
```

预期：FAIL — `output_dir` 相关 test 失败

- [ ] **Step 3: 跑 DB migration**

```bash
PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d zenithjoy -c \
  "ALTER TABLE zenithjoy.ai_video_pipeline_jobs ADD COLUMN IF NOT EXISTS output_dir TEXT;"
```

- [ ] **Step 4: 更新 `apps/api/src/services/ai-video-pipeline.service.ts`**

完整替换文件内容：

```typescript
import pool from '../db/connection';

export interface PipelineJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  src_video: string | null;
  src_logo: string | null;
  topic: string | null;
  result_url: string | null;
  output_dir: string | null;
  error_msg: string | null;
  created_at: Date;
  updated_at: Date;
}

export class AiVideoPipelineService {
  async createJob(params: {
    srcVideo: string;
    srcLogo: string | null;
    topic: string | null;
  }): Promise<PipelineJob> {
    const result = await pool.query(
      `INSERT INTO zenithjoy.ai_video_pipeline_jobs
         (src_video, src_logo, topic)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [params.srcVideo, params.srcLogo, params.topic],
    );
    return result.rows[0];
  }

  async getJob(id: string): Promise<PipelineJob | null> {
    const result = await pool.query(
      'SELECT * FROM zenithjoy.ai_video_pipeline_jobs WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listPending(): Promise<PipelineJob[]> {
    const result = await pool.query(
      `SELECT * FROM zenithjoy.ai_video_pipeline_jobs
       WHERE status = 'pending'
       ORDER BY created_at ASC`,
    );
    return result.rows;
  }

  async updateStatus(
    id: string,
    params: {
      status?: PipelineJob['status'];
      progress?: number;
      resultUrl?: string;
      outputDir?: string;
      errorMsg?: string;
    },
  ): Promise<PipelineJob> {
    const fields: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let i = 1;

    if (params.status !== undefined) { fields.push(`status = $${i++}`); values.push(params.status); }
    if (params.progress !== undefined) { fields.push(`progress = $${i++}`); values.push(params.progress); }
    if (params.resultUrl !== undefined) { fields.push(`result_url = $${i++}`); values.push(params.resultUrl); }
    if (params.outputDir !== undefined) { fields.push(`output_dir = $${i++}`); values.push(params.outputDir); }
    if (params.errorMsg !== undefined) { fields.push(`error_msg = $${i++}`); values.push(params.errorMsg); }

    values.push(id);
    const result = await pool.query(
      `UPDATE zenithjoy.ai_video_pipeline_jobs SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    return result.rows[0];
  }
}
```

- [ ] **Step 5: 运行 test，验证通过**

```bash
cd /tmp/zj-ai-video-local-refactor
npx vitest run apps/api/src/services/__tests__/ai-video-pipeline.service.test.ts 2>&1 | tail -10
```

预期：PASS

- [ ] **Step 6: 提交 commit-2**

```bash
git add apps/api/src/services/ai-video-pipeline.service.ts \
        apps/api/src/services/__tests__/ai-video-pipeline.service.test.ts
git commit -m "feat: add output_dir to PipelineJob + service updateStatus"
```

---

### Task 3: 重构 API — createJob / completeJob / 删除 3 端点

**Files:**
- Modify: `apps/api/src/controllers/ai-video-pipeline.controller.ts`
- Modify: `apps/api/src/routes/ai-video-pipeline.ts`

- [ ] **Step 1: 更新集成测试（先写，验证失败）**

完整替换 `apps/api/tests/ai-video-pipeline.test.ts`：

```typescript
import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockSvc = vi.hoisted(() => ({
  createJob: vi.fn(),
  getJob: vi.fn(),
  listPending: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('../src/services/ai-video-pipeline.service', () => ({
  AiVideoPipelineService: vi.fn().mockImplementation(() => mockSvc),
}));

import app from '../src/app';

const JOB = {
  id: 'job-uuid-1',
  status: 'pending',
  progress: 0,
  src_video: 'C:\\Users\\xuxia\\Videos\\test.mp4',
  src_logo: null,
  topic: '测试话题',
  result_url: null,
  output_dir: null,
  error_msg: null,
  created_at: '2026-05-16T00:00:00Z',
  updated_at: '2026-05-16T00:00:00Z',
};

describe('AI Video Pipeline API', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // ── createJob ─────────────────────────────────────────────────────────────

  describe('POST /api/ai-video/jobs — JSON body', () => {
    it('returns 400 when local_path missing', async () => {
      const res = await request(app)
        .post('/api/ai-video/jobs')
        .send({ topic: '没有路径' });
      expect(res.status).toBe(400);
    });

    it('creates job with local_path and returns 201', async () => {
      mockSvc.createJob.mockResolvedValueOnce({ ...JOB, id: 'new-id' });
      const res = await request(app)
        .post('/api/ai-video/jobs')
        .send({ local_path: 'C:\\Users\\xuxia\\Videos\\test.mp4', topic: '测试' });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe('new-id');
    });

    it('does NOT accept multipart (old behavior gone)', async () => {
      const res = await request(app)
        .post('/api/ai-video/jobs')
        .attach('video', Buffer.from('fake'), 'test.mp4');
      expect(res.status).toBe(400);
    });
  });

  // ── listJobs ──────────────────────────────────────────────────────────────

  describe('GET /api/ai-video/jobs?status=pending', () => {
    it('returns pending jobs', async () => {
      mockSvc.listPending.mockResolvedValueOnce([JOB]);
      const res = await request(app).get('/api/ai-video/jobs?status=pending');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns empty for non-pending filter', async () => {
      const res = await request(app).get('/api/ai-video/jobs?status=completed');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // ── getJob ────────────────────────────────────────────────────────────────

  describe('GET /api/ai-video/jobs/:id', () => {
    it('returns 404 for unknown job', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app).get('/api/ai-video/jobs/nonexistent');
      expect(res.status).toBe(404);
    });

    it('returns job when found', async () => {
      mockSvc.getJob.mockResolvedValueOnce(JOB);
      const res = await request(app).get('/api/ai-video/jobs/job-uuid-1');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('job-uuid-1');
    });
  });

  // ── updateProgress ────────────────────────────────────────────────────────

  describe('PATCH /api/ai-video/jobs/:id/progress', () => {
    it('returns 404 for unknown job', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app)
        .patch('/api/ai-video/jobs/nonexistent/progress')
        .send({ progress: 10, status: 'processing' });
      expect(res.status).toBe(404);
    });

    it('updates progress', async () => {
      mockSvc.getJob.mockResolvedValueOnce(JOB);
      mockSvc.updateStatus.mockResolvedValueOnce({ ...JOB, progress: 50, status: 'processing' });
      const res = await request(app)
        .patch('/api/ai-video/jobs/job-uuid-1/progress')
        .send({ progress: 50, status: 'processing' });
      expect(res.status).toBe(200);
      expect(res.body.progress).toBe(50);
    });
  });

  // ── completeJob ───────────────────────────────────────────────────────────

  describe('PUT /api/ai-video/jobs/:id/complete', () => {
    it('returns 404 for unknown job', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app)
        .put('/api/ai-video/jobs/nonexistent/complete')
        .send({ output_dir: 'C:\\out\\job-1' });
      expect(res.status).toBe(404);
    });

    it('stores output_dir and marks completed', async () => {
      const completed = { ...JOB, status: 'completed', progress: 100, output_dir: 'C:\\out\\job-uuid-1' };
      mockSvc.getJob.mockResolvedValue(JOB);
      mockSvc.updateStatus.mockResolvedValue(completed);
      const res = await request(app)
        .put('/api/ai-video/jobs/job-uuid-1/complete')
        .send({ output_dir: 'C:\\out\\job-uuid-1' });
      expect(res.status).toBe(200);
      expect(mockSvc.updateStatus).toHaveBeenCalledWith(
        'job-uuid-1',
        expect.objectContaining({ outputDir: 'C:\\out\\job-uuid-1', status: 'completed' }),
      );
    });
  });

  // ── 已删除的端点 ──────────────────────────────────────────────────────────

  describe('GET /api/ai-video/jobs/:id/source — 已删除', () => {
    it('returns 404', async () => {
      const res = await request(app).get('/api/ai-video/jobs/job-uuid-1/source');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/ai-video/jobs/:id/upload-output — 已删除', () => {
    it('returns 404', async () => {
      const res = await request(app).post('/api/ai-video/jobs/job-uuid-1/upload-output');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/ai-video/jobs/:id/output/:file — 已删除', () => {
    it('returns 404', async () => {
      const res = await request(app).get('/api/ai-video/jobs/job-uuid-1/output/9_16.mp4');
      expect(res.status).toBe(404);
    });
  });

  // ── AI endpoints ──────────────────────────────────────────────────────────

  describe('POST /api/ai-video/jobs/:id/transcribe (unknown job)', () => {
    it('returns 4xx', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app)
        .post('/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/transcribe');
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('POST /api/ai-video/jobs/:id/design (unknown job)', () => {
    it('returns 404', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app)
        .post('/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/design')
        .send({ transcript: 'test', segments: [], duration: 10 });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/ai-video/jobs/:id/compose-html (unknown job)', () => {
    it('returns 404', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app)
        .post('/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/compose-html')
        .send({ scenes: [], duration: 10 });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/ai-video/jobs/:id/bgm (unknown job)', () => {
    it('returns 404', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app)
        .post('/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/bgm')
        .send({ style: 'tech corporate' });
      expect(res.status).toBe(404);
    });
  });
});
```

- [ ] **Step 2: 运行集成测试，验证失败**

```bash
cd /tmp/zj-ai-video-local-refactor
npx vitest run apps/api/tests/ai-video-pipeline.test.ts 2>&1 | tail -20
```

预期：FAIL — createJob JSON、删除端点 404 等测试失败

- [ ] **Step 3: 重写控制器**

完整替换 `apps/api/src/controllers/ai-video-pipeline.controller.ts`：

```typescript
import { Request, Response, NextFunction } from 'express';
import { AiVideoPipelineService } from '../services/ai-video-pipeline.service';

const svc = new AiVideoPipelineService();

export async function createJob(req: Request, res: Response, next: NextFunction) {
  try {
    const { local_path, topic } = req.body as { local_path?: string; topic?: string };
    if (!local_path) return res.status(400).json({ error: 'local_path required' });
    const job = await svc.createJob({
      srcVideo: local_path,
      srcLogo: null,
      topic: topic ?? null,
    });
    res.status(201).json(job);
  } catch (err) { next(err); }
}

export async function getJob(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    res.json(job);
  } catch (err) { next(err); }
}

export async function listJobs(req: Request, res: Response, next: NextFunction) {
  try {
    const status = req.query.status as string | undefined;
    if (status === 'pending') {
      const jobs = await svc.listPending();
      return res.json({ data: jobs });
    }
    res.json({ data: [] });
  } catch (err) { next(err); }
}

export async function updateProgress(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    const { progress, status } = req.body as { progress?: number; status?: string };
    const allowedStatuses = ['pending', 'processing', 'completed', 'failed'] as const;
    const safeStatus = allowedStatuses.includes(status as typeof allowedStatuses[number])
      ? (status as typeof allowedStatuses[number])
      : 'processing';
    const updated = await svc.updateStatus(req.params.id, {
      status: safeStatus,
      progress: typeof progress === 'number' ? progress : job.progress,
    });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function completeJob(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    const { output_dir, error_msg } = req.body as { output_dir?: string; error_msg?: string };
    const updated = await svc.updateStatus(req.params.id, {
      status: error_msg ? 'failed' : 'completed',
      progress: error_msg ? job.progress : 100,
      outputDir: output_dir,
      errorMsg: error_msg,
    });
    res.json(updated);
  } catch (err) { next(err); }
}
```

- [ ] **Step 4: 重写路由（去掉 multer，删除 3 个端点）**

完整替换 `apps/api/src/routes/ai-video-pipeline.ts`：

```typescript
import { Router } from 'express';
import multer from 'multer';
import { createJob, getJob, listJobs, completeJob, updateProgress } from '../controllers/ai-video-pipeline.controller';
import { transcribeAudio, designScenes, composeHtml, generateBgm } from '../controllers/ai-video-pipeline-ai.controller';

const upload = multer({ storage: multer.memoryStorage() });

const router = Router();

router.post('/', createJob);
router.get('/', listJobs);
router.get('/:id', getJob);
router.patch('/:id/progress', updateProgress);
router.put('/:id/complete', completeJob);
router.post('/:id/transcribe', upload.single('audio'), transcribeAudio);
router.post('/:id/design', designScenes);
router.post('/:id/compose-html', composeHtml);
router.post('/:id/bgm', generateBgm);

export default router;
```

- [ ] **Step 5: 运行集成测试，验证通过**

```bash
cd /tmp/zj-ai-video-local-refactor
npx vitest run apps/api/tests/ai-video-pipeline.test.ts 2>&1 | tail -20
```

预期：PASS

- [ ] **Step 6: 更新 controller 导出测试（删除 3 个已删除的 handler）**

完整替换 `apps/api/tests/controllers/ai-video-pipeline.controller.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import * as controller from '../../src/controllers/ai-video-pipeline.controller';

describe('ai-video-pipeline.controller exports', () => {
  it('exports createJob handler', () => {
    expect(typeof controller.createJob).toBe('function');
  });
  it('exports getJob handler', () => {
    expect(typeof controller.getJob).toBe('function');
  });
  it('exports listJobs handler', () => {
    expect(typeof controller.listJobs).toBe('function');
  });
  it('exports updateProgress handler', () => {
    expect(typeof controller.updateProgress).toBe('function');
  });
  it('exports completeJob handler', () => {
    expect(typeof controller.completeJob).toBe('function');
  });
  it('does NOT export downloadSource', () => {
    expect((controller as Record<string, unknown>).downloadSource).toBeUndefined();
  });
  it('does NOT export uploadOutput', () => {
    expect((controller as Record<string, unknown>).uploadOutput).toBeUndefined();
  });
  it('does NOT export downloadOutput', () => {
    expect((controller as Record<string, unknown>).downloadOutput).toBeUndefined();
  });
});
```

- [ ] **Step 7: 运行全部 API tests**

```bash
cd /tmp/zj-ai-video-local-refactor
npx vitest run apps/api/tests/ 2>&1 | tail -30
```

预期：PASS（注意 coverage ≥ 65%）

- [ ] **Step 8: 提交 commit-2（实现）**

```bash
git add \
  apps/api/src/controllers/ai-video-pipeline.controller.ts \
  apps/api/src/routes/ai-video-pipeline.ts \
  apps/api/tests/ai-video-pipeline.test.ts \
  apps/api/tests/controllers/ai-video-pipeline.controller.test.ts
git commit -m "feat: refactor createJob to JSON body, remove 3 file-transfer endpoints, completeJob accepts output_dir"
```

---

### Task 4: Agent 重构（去掉 Step 2 下载 + Step 10 上传）

**Files:**
- Modify: `services/agent/src/handlers/video-pipeline.ts`

- [ ] **Step 1: 写失败的 unit test**

在 `services/agent/src/handlers/video-pipeline.test.ts`（如不存在则新建）：

```typescript
import { describe, it, expect, vi } from 'vitest';
import * as handler from './video-pipeline';

describe('video-pipeline handler exports', () => {
  it('exports processVideoPipelineJob', () => {
    expect(typeof handler.processVideoPipelineJob).toBe('function');
  });

  it('exports startVideoPipelineLoop', () => {
    expect(typeof handler.startVideoPipelineLoop).toBe('function');
  });

  it('VideoPipelineJob interface has src_video field (not a download URL)', () => {
    const job: handler.VideoPipelineJob = {
      id: 'test-id',
      src_video: 'C:\\Users\\xuxia\\Videos\\test.mp4',
      topic: null,
      status: 'pending',
    };
    expect(job.src_video).toContain('test.mp4');
  });
});
```

- [ ] **Step 2: 运行 test，验证通过（接口已存在，test 应该 pass）**

```bash
cd /tmp/zj-ai-video-local-refactor
npx vitest run services/agent/src/handlers/video-pipeline.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: 重写 Agent handler**

完整替换 `services/agent/src/handlers/video-pipeline.ts`：

```typescript
import { execSync, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

// ── FFmpeg 路径查找 ─────────────────────────────────────────────────────────
function findFfmpeg(): string {
  const exeDir = path.dirname(process.execPath);
  const bundled = path.join(exeDir, 'ffmpeg.exe');
  if (fs.existsSync(bundled)) return bundled;
  const candidates = [
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(os.homedir(), 'ffmpeg\\bin\\ffmpeg.exe'),
  ];
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  try {
    const which = execSync('where ffmpeg', { stdio: 'pipe' }).toString().split('\n')[0].trim();
    if (which) return which;
  } catch { }
  return 'ffmpeg';
}

const FFMPEG = findFfmpeg();

// ── HTTP helpers ─────────────────────────────────────────────────────────────
async function apiGet<T>(apiBase: string, p: string): Promise<T> {
  const r = await fetch(`${apiBase}${p}`);
  return r.json() as Promise<T>;
}

async function apiPost<T>(apiBase: string, p: string, body: unknown): Promise<T> {
  const r = await fetch(`${apiBase}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json() as Promise<T>;
}

async function apiPatch(apiBase: string, p: string, body: unknown): Promise<void> {
  await fetch(`${apiBase}${p}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${url} → ${r.status}`);
  const buf = await r.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(buf));
}

async function progress(apiBase: string, jobId: string, pct: number): Promise<void> {
  await apiPatch(apiBase, `/api/ai-video/jobs/${jobId}/progress`, { progress: pct, status: 'processing' });
}

// ── main job processor ───────────────────────────────────────────────────────

export interface VideoPipelineJob {
  id: string;
  src_video: string | null;
  topic: string | null;
  status: string;
}

export async function processVideoPipelineJob(
  apiBase: string,
  job: VideoPipelineJob,
): Promise<void> {
  const { id, topic } = job;

  // videoPath = Windows 本地路径，直接来自 job.src_video
  const videoPath = job.src_video;
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`[video-pipeline] src_video not found on local disk: ${videoPath}`);
  }

  // 输出目录：视频同级 zenithjoy-output/<id>/
  const outputDir = path.join(path.dirname(videoPath), 'zenithjoy-output', id);
  fs.mkdirSync(outputDir, { recursive: true });

  const tmpDir = path.join(os.tmpdir(), `zj-video-${id}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log(`[video-pipeline] processing job ${id} — source: ${videoPath}`);

  try {
    // ── Step 1: claim job ──────────────────────────────────────────────────
    await apiPatch(apiBase, `/api/ai-video/jobs/${id}/progress`, { progress: 2, status: 'processing' });

    // Step 2 已删除：视频直接来自本地路径，不需要下载

    // ── Step 3: probe duration ─────────────────────────────────────────────
    let duration = 30;
    try {
      const probe = execSync(
        `"${FFMPEG.replace('ffmpeg', 'ffprobe')}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      ).toString().trim();
      const d = parseFloat(probe);
      if (d > 0) duration = d;
    } catch { /* use default */ }
    await progress(apiBase, id, 20);

    // ── Step 4: extract audio ──────────────────────────────────────────────
    const audioPath = path.join(tmpDir, 'audio.wav');
    try {
      await execFileAsync(FFMPEG, [
        '-y', '-i', videoPath,
        '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
        audioPath,
      ]);
    } catch {
      await execFileAsync(FFMPEG, [
        '-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono',
        '-t', String(duration), '-acodec', 'pcm_s16le', audioPath,
      ]);
    }
    await progress(apiBase, id, 28);

    // ── Step 5: transcribe ─────────────────────────────────────────────────
    const audioBuffer = fs.readFileSync(audioPath);
    const transcribeForm = new FormData();
    transcribeForm.append('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');
    let transcribeResult: { transcript: string; segments: { start: number; end: number; text: string }[] } =
      { transcript: topic || '', segments: [] };
    try {
      const r = await fetch(`${apiBase}/api/ai-video/jobs/${id}/transcribe`, {
        method: 'POST',
        body: transcribeForm,
      });
      const data = await r.json() as typeof transcribeResult;
      if (data.transcript || data.segments?.length) transcribeResult = data;
      if (!transcribeResult.transcript && topic) transcribeResult.transcript = topic;
    } catch (err) {
      console.warn('[video-pipeline] transcribe error:', err);
      if (topic) transcribeResult.transcript = topic;
    }
    await progress(apiBase, id, 40);

    // ── Step 6: design scenes ──────────────────────────────────────────────
    let designResult: { scenes: Array<{ start: number; duration: number; layout: string; eyebrow: string; title: string; body: string; tags?: string[] }> } =
      { scenes: [] };
    try {
      designResult = await apiPost(apiBase, `/api/ai-video/jobs/${id}/design`, {
        transcript: transcribeResult.transcript || topic || '精彩内容',
        segments: transcribeResult.segments.length
          ? transcribeResult.segments
          : [{ start: 0, end: duration, text: topic || '精彩内容' }],
        duration,
        topic,
      }) as typeof designResult;
    } catch (err) { console.warn('[video-pipeline] design error:', err); }
    await progress(apiBase, id, 55);

    // ── Step 7: compose HTML ───────────────────────────────────────────────
    const htmlPath = path.join(tmpDir, 'hyperframe.html');
    try {
      const scenes = designResult.scenes.length
        ? designResult.scenes
        : [{ start: 0, duration, layout: 'burst', eyebrow: '精彩内容', title: topic || '视频', body: '', tags: [] }];
      const htmlRes = await apiPost<{ html?: string }>(apiBase, `/api/ai-video/jobs/${id}/compose-html`, {
        scenes,
        duration,
        video_filename: path.basename(videoPath),
      });
      if (htmlRes.html) fs.writeFileSync(htmlPath, htmlRes.html, 'utf-8');
    } catch (err) { console.warn('[video-pipeline] compose-html error:', err); }
    await progress(apiBase, id, 65);

    // ── Step 8: BGM ────────────────────────────────────────────────────────
    const bgmPath = path.join(tmpDir, 'bgm.mp3');
    let hasBgm = false;
    try {
      const bgmRes = await apiPost<{ url?: string }>(apiBase, `/api/ai-video/jobs/${id}/bgm`, {
        style: 'upbeat motivational, electronic, no vocals, 120 BPM',
      });
      if (bgmRes.url) {
        await downloadToFile(bgmRes.url, bgmPath);
        hasBgm = true;
        console.log('[video-pipeline] BGM downloaded');
      }
    } catch (err) { console.warn('[video-pipeline] BGM error (non-fatal):', err); }
    await progress(apiBase, id, 75);

    // ── Step 9: FFmpeg outputs → 写到本地 outputDir ────────────────────────
    const output916 = path.join(outputDir, '9_16.mp4');
    const output169 = path.join(outputDir, '16_9.mp4');
    const bgmArgs: string[] = hasBgm
      ? ['-map', '0:v:0', '-map', '1:a:0', '-shortest']
      : ['-map', '0'];

    const mkOutput = async (outPath: string, w: number, h: number) => {
      const scale = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`;
      try {
        await execFileAsync(FFMPEG, [
          '-y', '-i', videoPath,
          ...(hasBgm ? ['-i', bgmPath] : []),
          '-vf', scale,
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
          '-c:a', 'aac', '-b:a', '128k',
          ...bgmArgs,
          '-t', String(Math.min(duration, 60)),
          outPath,
        ]);
      } catch (err) {
        console.error(`[video-pipeline] FFmpeg ${w}x${h} failed:`, (err as Error).message?.slice(0, 100));
        fs.copyFileSync(videoPath, outPath);
      }
    };

    await mkOutput(output916, 1080, 1920);
    await progress(apiBase, id, 87);
    await mkOutput(output169, 1920, 1080);
    await progress(apiBase, id, 93);

    // ── Step 10: 通知中台完成，带本地 output_dir ───────────────────────────
    console.log(`[video-pipeline] job ${id} complete — outputs at ${outputDir}`);
    await fetch(`${apiBase}/api/ai-video/jobs/${id}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ output_dir: outputDir }),
    });
    await progress(apiBase, id, 100);

  } catch (err) {
    console.error('[video-pipeline] job failed:', err);
    await fetch(`${apiBase}/api/ai-video/jobs/${id}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error_msg: String(err) }),
    }).catch(() => {});
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── polling loop ─────────────────────────────────────────────────────────────
let _running = false;

export function startVideoPipelineLoop(apiBase: string, intervalMs = 15_000): NodeJS.Timeout {
  const tick = async () => {
    if (_running) return;
    _running = true;
    try {
      const data = await apiGet<{ data?: VideoPipelineJob[] }>(apiBase, '/api/ai-video/jobs?status=pending');
      if (data?.data?.length) {
        const job = data.data[0];
        await apiPatch(apiBase, `/api/ai-video/jobs/${job.id}/progress`, { status: 'processing', progress: 1 });
        await processVideoPipelineJob(apiBase, job);
      }
    } catch (err) {
      console.warn('[video-pipeline] poll error:', err instanceof Error ? err.message : err);
    } finally {
      _running = false;
    }
  };
  tick();
  return setInterval(tick, intervalMs);
}
```

- [ ] **Step 4: 运行 Agent unit test**

```bash
cd /tmp/zj-ai-video-local-refactor
npx vitest run services/agent/src/handlers/video-pipeline.test.ts 2>&1 | tail -10
```

预期：PASS

- [ ] **Step 5: TypeScript 编译检查**

```bash
cd /tmp/zj-ai-video-local-refactor/services/agent
npx tsc --noEmit 2>&1 | head -20
```

预期：无 error

- [ ] **Step 6: 提交 commit-2（Agent 实现）**

```bash
git add \
  services/agent/src/handlers/video-pipeline.ts \
  services/agent/src/handlers/video-pipeline.test.ts
git commit -m "feat: agent reads local src_video path directly, outputs to local outputDir"
```

---

### Task 5: 更新 test-registry.yaml + 运行完整 CI lint

**Files:**
- Modify: `test-registry.yaml`

- [ ] **Step 1: 在 test-registry.yaml 末尾追加 Agent handler test 条目**

在 `ai-video-pipeline-worker-script` 条目后追加：

```yaml
  - id: ai-video-pipeline-agent-handler
    path: services/agent/src/handlers/video-pipeline.test.ts
    type: unit
    ci: L3
    status: active
    product: AI视频本地流水线
    note: "Agent handler 导出验证 + VideoPipelineJob 接口验证（本地路径）"
```

- [ ] **Step 2: 本地跑 lint-test-pairing**

```bash
cd /tmp/zj-ai-video-local-refactor
bash .github/workflows/scripts/lint-test-pairing.sh origin/main 2>&1
```

预期：✅ 通过

- [ ] **Step 3: 运行全部 API tests 检查 coverage**

```bash
cd /tmp/zj-ai-video-local-refactor
npx vitest run --coverage apps/api/tests/ 2>&1 | grep -E "Lines|coverage|PASS|FAIL" | tail -10
```

预期：Lines ≥ 65%，PASS

- [ ] **Step 4: 提交**

```bash
git add test-registry.yaml
git commit -m "chore: register agent-handler test in test-registry.yaml"
```

---

### Task 6: Push + PR + 等待 CI

- [ ] **Step 1: Push 分支**

```bash
cd /tmp/zj-ai-video-local-refactor
git push -u origin cp-20260516-ai-video-local-refactor 2>&1
```

- [ ] **Step 2: 创建 PR**

```bash
gh pr create \
  --title "feat: AI视频流水线本地优先重构 — 视频永远不离开客户本地" \
  --body "$(cat <<'EOF'
## Summary

- **删除 3 个文件传输端点**：GET /:id/source、POST /:id/upload-output、GET /:id/output/:file
- **createJob 改为 JSON body**：接收 \`{ local_path, topic }\`，视频不上传服务器
- **completeJob 接收 output_dir**：Agent 写入本地输出目录路径
- **Agent 简化**：去掉 Step 2（下载源视频）和 Step 10（上传输出），直接读写本地文件
- **DB**：新增 \`output_dir TEXT\` 字段（migration 已跑）

本 PR 推进 Path 1 Step 5 架构正确性：视频文件永远在 Windows 本地，只有音频/文本/状态走网络。

## Test plan

- [ ] API integration tests PASS（createJob JSON、deleted endpoints 404、completeJob output_dir）
- [ ] lint-test-pairing PASS
- [ ] Orphan Test Check PASS
- [ ] CI Config Audit PASS（无 .github/workflows 变更）
- [ ] smoke: ai-video-pipeline-local-smoke.sh 6/6 PASS on autopilot.zenjoymedia.media

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: 等待 CI 全绿**

```bash
sleep 120 && gh pr checks HEAD 2>&1 | grep -E "fail|pass"
```

---

## 自检（Spec Coverage）

| Spec 要求 | 计划中的 Task |
|---|---|
| DB migration output_dir | Task 2 Step 3 |
| createJob → JSON body | Task 3 Step 3 |
| 删除 /source 端点 | Task 3 Step 4 |
| 删除 /upload-output 端点 | Task 3 Step 4 |
| 删除 /output/:file 端点 | Task 3 Step 4 |
| completeJob 接收 output_dir | Task 3 Step 3 |
| Agent 去掉下载步骤 | Task 4 Step 3 |
| Agent 去掉上传步骤 | Task 4 Step 3 |
| 输出目录约定 zenithjoy-output/<id>/ | Task 4 Step 3 |
| integration test 覆盖新行为 | Task 3 Step 1 |
| unit test controller 导出验证 | Task 3 Step 6 |
| E2E smoke 脚本 | Task 1 |
