# AI Video Upload Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在新分支 `cp-20260525-fix-ai-video-upload` 上实现视频上传端点，修复旧 PR #294 的所有 CI 失败（TypeScript 错误、缺少 test pairing、TDD 顺序违规）。

**Architecture:** POST /api/ai-video/upload 接收 multipart 文件，通过 AiVideoUploadService.createJob() 写入 DB，然后 fire-and-forget 调用 dispatch()（ssh/scp 到 xian-m4），立即返回 201 不再查 DB，避免 pg-pool 连接超时。

**Tech Stack:** TypeScript, Express, multer@2.1.1, vitest, supertest

---

## 文件清单

**新建：**
- `apps/api/src/services/ai-video-upload.service.ts` — AiVideoUploadService（createJob + dispatch + polling）
- `apps/api/src/controllers/__tests__/ai-video.controller.test.ts` — uploadAndProcess 三路 unit test
- `apps/api/src/services/__tests__/ai-video-upload.service.test.ts` — createJob unit test
- `apps/api/src/routes/__tests__/ai-video.test.ts` — upload 路由 400 unit test

**修改：**
- `.github/workflows/scripts/smoke/ai-video-smoke.sh` — 加 upload 400 smoke case
- `apps/api/src/controllers/ai-video.controller.ts` — 加 uploadAndProcess + downloadFile
- `apps/api/src/routes/ai-video.ts` — 加 multer storage + upload/download 路由

---

### Task 1：Commit 1 — smoke test（定义完成标准）

**Files:**
- Modify: `.github/workflows/scripts/smoke/ai-video-smoke.sh`

- [ ] **Step 1: 在 smoke 脚本末尾（echo ────────── 之前）插入 upload 验收 case**

打开 `.github/workflows/scripts/smoke/ai-video-smoke.sh`，在最后 `echo ""` 之前插入：

```bash
echo "── ai-video-upload (路由可达性 + 400 无文件) ──"
# POST /api/ai-video/upload 不带 video 文件必须返回 400（不是 404/500）
http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/ai-video/upload" \
    -H "X-Feishu-User-Id: $FEISHU_USER")
[[ "$http_code" == "400" ]] \
  && ok "POST /api/ai-video/upload 无文件 → 400" \
  || fail "POST /api/ai-video/upload 无文件 → 期望 400，得 $http_code"
```

- [ ] **Step 2: 确认插入位置正确**

```bash
grep -n "upload\|────────────────" .github/workflows/scripts/smoke/ai-video-smoke.sh
```

Expected output: upload section 在 ──────────────── 行之前出现。

- [ ] **Step 3: Commit smoke test**

```bash
cd /Users/administrator/worktrees/zenithjoy/fix-ai-video-upload
git add .github/workflows/scripts/smoke/ai-video-smoke.sh
git commit -m "test(ai-video): smoke — POST /upload 无文件返回 400 验收"
```

---

### Task 2：Commit 2 — 实现 + 单元测试

**Files:**
- Create: `apps/api/src/services/ai-video-upload.service.ts`
- Modify: `apps/api/src/controllers/ai-video.controller.ts`
- Modify: `apps/api/src/routes/ai-video.ts`
- Create: `apps/api/src/controllers/__tests__/ai-video.controller.test.ts`
- Create: `apps/api/src/services/__tests__/ai-video-upload.service.test.ts`
- Create: `apps/api/src/routes/__tests__/ai-video.test.ts`

#### Step 2a: 新建 AiVideoUploadService

- [ ] **Step 2a-1: 创建服务文件**

新建 `apps/api/src/services/ai-video-upload.service.ts`：

```typescript
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import pool from '../db/connection';

const XIAN_M4 = 'jinnuoshengyuan@100.86.57.69';
const REMOTE_BASE = '/opt/video-pipeline/jobs';
const LOCAL_BASE = `${process.env.HOME}/video-pipeline/jobs`;

export interface UploadVideoParams {
  jobId: string;
  videoPath: string;
  scriptText: string;
  logoPath?: string;
  platform?: string;
}

export class AiVideoUploadService {
  async createJob(params: UploadVideoParams): Promise<string> {
    const { jobId, videoPath, scriptText, logoPath } = params;
    await pool.query(
      `INSERT INTO zenithjoy.ai_video_generations (
        id, platform, model, prompt, status, progress,
        source_video_path, script_text, logo_path
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [jobId, 'local-whisper-ffmpeg', 'whisper-base', scriptText,
       'queued', 0, videoPath, scriptText, logoPath || null]
    );
    return jobId;
  }

  async dispatch(params: UploadVideoParams): Promise<void> {
    const { jobId, videoPath, scriptText, logoPath } = params;
    const localJobDir = path.join(LOCAL_BASE, jobId);
    const remoteJobDir = `${REMOTE_BASE}/${jobId}`;

    const configPath = path.join(localJobDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      job_id: jobId,
      script_text: scriptText,
      min_silence_gap: 1.5,
      openai_api_key: process.env.OPENAI_API_KEY || '',
    }));

    await pool.query(
      `UPDATE zenithjoy.ai_video_generations SET status='in_progress', progress=5 WHERE id=$1`,
      [jobId]
    );

    execSync(
      `ssh -o StrictHostKeyChecking=no ${XIAN_M4} "mkdir -p ${remoteJobDir}/src ${remoteJobDir}/out"`,
      { timeout: 15000 }
    );
    execSync(
      `scp -o StrictHostKeyChecking=no "${videoPath}" "${XIAN_M4}:${remoteJobDir}/src/video.mp4"`,
      { timeout: 120000 }
    );
    execSync(
      `scp -o StrictHostKeyChecking=no "${configPath}" "${XIAN_M4}:${remoteJobDir}/config.json"`,
      { timeout: 15000 }
    );
    if (logoPath && fs.existsSync(logoPath)) {
      execSync(
        `scp -o StrictHostKeyChecking=no "${logoPath}" "${XIAN_M4}:${remoteJobDir}/src/logo.png"`,
        { timeout: 15000 }
      );
    }

    const processPyLocal = path.join(__dirname, '../../../..', 'services/video-pipeline/process.py');
    if (fs.existsSync(processPyLocal)) {
      execSync(
        `scp -o StrictHostKeyChecking=no "${processPyLocal}" "${XIAN_M4}:/opt/video-pipeline/process.py"`,
        { timeout: 15000 }
      );
    }

    execSync(
      `ssh -o StrictHostKeyChecking=no ${XIAN_M4} ` +
      `"mkdir -p /opt/video-pipeline && ` +
      `nohup python3 /opt/video-pipeline/process.py ${remoteJobDir} ` +
      `> ${remoteJobDir}/process.log 2>&1 &"`,
      { timeout: 15000 }
    );

    this.startPolling(jobId, remoteJobDir);
  }

  private startPolling(jobId: string, remoteJobDir: string) {
    const localJobDir = path.join(LOCAL_BASE, jobId);
    const outDir = path.join(localJobDir, 'out');
    let attempts = 0;
    const maxAttempts = 360;

    const interval = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(interval);
        await pool.query(
          `UPDATE zenithjoy.ai_video_generations SET status='failed', error_message='timeout' WHERE id=$1`,
          [jobId]
        );
        return;
      }
      try {
        const raw = execSync(
          `ssh -o StrictHostKeyChecking=no ${XIAN_M4} "cat ${remoteJobDir}/status.json" 2>/dev/null || echo '{}'`,
          { timeout: 10000 }
        ).toString().trim();
        const status = JSON.parse(raw);
        if (!status.status) return;
        await pool.query(
          `UPDATE zenithjoy.ai_video_generations SET progress=$1 WHERE id=$2`,
          [status.progress || 0, jobId]
        );
        if (status.status === 'completed') {
          clearInterval(interval);
          fs.mkdirSync(outDir, { recursive: true });
          execSync(
            `scp -o StrictHostKeyChecking=no "${XIAN_M4}:${remoteJobDir}/out/9_16.mp4" "${outDir}/9_16.mp4"`,
            { timeout: 120000 }
          );
          execSync(
            `scp -o StrictHostKeyChecking=no "${XIAN_M4}:${remoteJobDir}/out/16_9.mp4" "${outDir}/16_9.mp4"`,
            { timeout: 120000 }
          );
          await pool.query(
            `UPDATE zenithjoy.ai_video_generations
             SET status='completed', progress=100, completed_at=NOW(),
                 output_9_16_url=$1, output_16_9_url=$2
             WHERE id=$3`,
            [
              `/api/ai-video/download/${jobId}/9_16.mp4`,
              `/api/ai-video/download/${jobId}/16_9.mp4`,
              jobId,
            ]
          );
        } else if (status.status === 'failed') {
          clearInterval(interval);
          await pool.query(
            `UPDATE zenithjoy.ai_video_generations SET status='failed', error_message=$1 WHERE id=$2`,
            [status.error || 'processing failed', jobId]
          );
        }
      } catch {
        // SSH temporary failure — keep polling
      }
    }, 5000);
  }
}
```

#### Step 2b: 更新 Controller

- [ ] **Step 2b-1: 在 ai-video.controller.ts 顶部增加 import，末尾增加两个方法**

在 `apps/api/src/controllers/ai-video.controller.ts` 文件顶部（现有 import 之后）加：

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { AiVideoUploadService } from '../services/ai-video-upload.service';

const uploadService = new AiVideoUploadService();
const LOCAL_BASE = `${process.env.HOME}/video-pipeline/jobs`;
```

在 class 末尾（最后一个 `}` 之前）加两个方法：

```typescript
  async uploadAndProcess(req: Request, res: Response, next: NextFunction) {
    try {
      const files = req.files as Record<string, Express.Multer.File[]>;
      const videoFile = files?.['video']?.[0];
      const logoFile  = files?.['logo']?.[0];

      if (!videoFile) {
        return res.status(400).json({ error: 'video file is required' });
      }
      const scriptText = (req.body.script || req.body.title || '').trim();
      if (!scriptText) {
        return res.status(400).json({ error: 'script or title is required' });
      }

      const jobId = (req as unknown as { jobId: string }).jobId;

      await uploadService.createJob({
        jobId,
        videoPath: videoFile.path,
        scriptText,
        logoPath: logoFile?.path,
      });

      // dispatch() uses execSync(ssh/scp) which blocks the event loop.
      // Calling getGenerationById() after this point risks pg-pool connectionTimeout.
      // Return known data instead.
      uploadService.dispatch({
        jobId,
        videoPath: videoFile.path,
        scriptText,
        logoPath: logoFile?.path,
      }).catch((err) => {
        console.error(`[upload] dispatch error for ${jobId}:`, err);
      });

      res.status(201).json({ id: jobId, status: 'queued', progress: 0, script_text: scriptText });
    } catch (error) {
      next(error);
    }
  }

  async downloadFile(req: Request, res: Response, next: NextFunction) {
    try {
      const { jobId, file } = req.params;
      if (!jobId || !file || file.includes('..') || file.includes('/')) {
        return res.status(400).json({ error: 'invalid params' });
      }
      const filePath = path.join(LOCAL_BASE, jobId, 'out', file);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'file not found' });
      }
      res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  }
```

#### Step 2c: 更新 Route

- [ ] **Step 2c-1: 重写 ai-video.ts，加 multer + upload/download 路由**

将 `apps/api/src/routes/ai-video.ts` 替换为：

```typescript
import { Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { AiVideoController } from '../controllers/ai-video.controller';

const UPLOAD_BASE = `${process.env.HOME}/video-pipeline/jobs`;

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const jobId = (req as unknown as { jobId: string }).jobId;
    const dir = path.join(UPLOAD_BASE, jobId, 'src');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = file.fieldname === 'video' ? `video${ext}` : `logo${ext}`;
    cb(null, name);
  },
});

const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

const router = Router();
const controller = new AiVideoController();

// POST /api/ai-video/upload — Upload video for local Whisper+FFmpeg processing
router.post('/upload', (req, _res, next) => {
  (req as unknown as { jobId: string }).jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  next();
}, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'logo', maxCount: 1 }]),
  controller.uploadAndProcess.bind(controller));

// GET /api/ai-video/download/:jobId/:file — Download processed video
router.get('/download/:jobId/:file', controller.downloadFile.bind(controller));

// GET /api/ai-video/history
router.get('/history', controller.getAllGenerations.bind(controller));

// GET /api/ai-video/active
router.get('/active', controller.getActiveGenerations.bind(controller));

// GET /api/ai-video/task/:id
router.get('/task/:id', controller.getGenerationById.bind(controller));

// POST /api/ai-video/generate
router.post('/generate', controller.createGeneration.bind(controller));

// PUT /api/ai-video/task/:id
router.put('/task/:id', controller.updateGeneration.bind(controller));

// DELETE /api/ai-video/task/:id
router.delete('/task/:id', controller.deleteGeneration.bind(controller));

export default router;
```

#### Step 2d: 写单元测试

- [ ] **Step 2d-1: 创建 controller test**

新建 `apps/api/src/controllers/__tests__/ai-video.controller.test.ts`：

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

vi.mock('../../services/ai-video-upload.service', () => ({
  AiVideoUploadService: vi.fn().mockImplementation(() => ({
    createJob: vi.fn().mockResolvedValue('test-job-id'),
    dispatch: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('POST /api/ai-video/upload', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = (await import('../../app')).default;
  });

  it('no video file → 400 video file is required', async () => {
    const res = await request(app)
      .post('/api/ai-video/upload')
      .set('X-Feishu-User-Id', 'ou_test_001')
      .field('script', 'test script');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('video file is required');
  });

  it('video but no script/title → 400 script or title is required', async () => {
    const res = await request(app)
      .post('/api/ai-video/upload')
      .set('X-Feishu-User-Id', 'ou_test_001')
      .attach('video', Buffer.from('fake-video-data'), 'test.mp4');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('script or title is required');
  });

  it('valid video + script → 201 queued', async () => {
    const res = await request(app)
      .post('/api/ai-video/upload')
      .set('X-Feishu-User-Id', 'ou_test_001')
      .attach('video', Buffer.from('fake-video-data'), 'test.mp4')
      .field('script', 'my test script');

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('queued');
    expect(res.body.progress).toBe(0);
    expect(res.body.script_text).toBe('my test script');
    expect(res.body.id).toBeTruthy();
  });
});
```

- [ ] **Step 2d-2: 创建 service test**

新建 `apps/api/src/services/__tests__/ai-video-upload.service.test.ts`：

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '../../db/connection';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

vi.mock('child_process', () => ({ execSync: vi.fn() }));
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
}));

describe('AiVideoUploadService.createJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts queued record and returns jobId', async () => {
    const mockQuery = vi.mocked(pool.query);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    const { AiVideoUploadService } = await import('../ai-video-upload.service');
    const svc = new AiVideoUploadService();
    const result = await svc.createJob({
      jobId: 'job-test-123',
      videoPath: '/tmp/video.mp4',
      scriptText: 'hello world',
    });

    expect(result).toBe('job-test-123');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO zenithjoy.ai_video_generations'),
      expect.arrayContaining(['job-test-123', 'local-whisper-ffmpeg', 'queued', 0])
    );
  });
});
```

- [ ] **Step 2d-3: 创建 route test**

新建 `apps/api/src/routes/__tests__/ai-video.test.ts`：

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

vi.mock('../../services/ai-video-upload.service', () => ({
  AiVideoUploadService: vi.fn().mockImplementation(() => ({
    createJob: vi.fn().mockResolvedValue('test-job'),
    dispatch: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('POST /api/ai-video/upload route', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = (await import('../../app')).default;
  });

  it('non-multipart request → 400 (no video file)', async () => {
    const res = await request(app)
      .post('/api/ai-video/upload')
      .set('Content-Type', 'application/json')
      .set('X-Feishu-User-Id', 'ou_test_001')
      .send({ script: 'test' });

    expect(res.status).toBe(400);
  });
});
```

#### Step 2e: 运行测试验证

- [ ] **Step 2e-1: 运行新增的三个测试文件**

```bash
cd /Users/administrator/worktrees/zenithjoy/fix-ai-video-upload
npx vitest run apps/api/src/controllers/__tests__/ai-video.controller.test.ts \
  apps/api/src/services/__tests__/ai-video-upload.service.test.ts \
  apps/api/src/routes/__tests__/ai-video.test.ts 2>&1 | tail -20
```

Expected: 全部 PASS（5 个 test cases）。

- [ ] **Step 2e-2: 运行 TypeScript 类型检查**

```bash
cd /Users/administrator/worktrees/zenithjoy/fix-ai-video-upload/apps/api
npx tsc --noEmit 2>&1 | head -20
```

Expected: 无错误输出。

- [ ] **Step 2f: Commit 实现 + 测试**

```bash
cd /Users/administrator/worktrees/zenithjoy/fix-ai-video-upload
git add apps/api/src/services/ai-video-upload.service.ts \
        apps/api/src/controllers/ai-video.controller.ts \
        apps/api/src/routes/ai-video.ts \
        apps/api/src/controllers/__tests__/ai-video.controller.test.ts \
        apps/api/src/services/__tests__/ai-video-upload.service.test.ts \
        apps/api/src/routes/__tests__/ai-video.test.ts \
        docs/superpowers/specs/2026-05-25-ai-video-upload-fix-design.md \
        docs/superpowers/plans/2026-05-25-ai-video-upload-fix.md
git commit -m "fix(ai-video): upload 端点 — AiVideoUploadService + 不查 DB 直接返回 + 配套测试"
```

---

### Task 3：推送并创建 PR

- [ ] **Step 3-1: Push 分支**

```bash
cd /Users/administrator/worktrees/zenithjoy/fix-ai-video-upload
git push -u origin cp-20260525-fix-ai-video-upload
```

- [ ] **Step 3-2: 创建 PR**

```bash
gh pr create \
  --title "[CONFIG] fix(ai-video): upload 端点 — 去掉 dispatch 后 DB 查询 + 补测试" \
  --body "$(cat <<'EOF'
## Summary

- **根因**：dispatch() 调 execSync(ssh/scp) 阻塞事件循环，之后 getGenerationById() pg-pool 超时
- **修复**：upload 后直接返回 {id, status, progress}，不再查 DB
- **补全**：AiVideoUploadService + 更新 controller/route + 补全 3 个配套 test 文件

## 本 PR 推进

把 视频剪辑 Journey Step 1（本地视频上传）的上传端点从 ❌ 推到 ✅

## Test Plan

- [ ] `lint-test-pairing` 通过（3 个 src 文件各有配套 test）
- [ ] `lint-tdd-commit-order` 通过（smoke commit-1 在 impl commit-2 之前）
- [ ] `API Typecheck` 通过（multer + @types/multer 已在 package.json）
- [ ] `CI Config Audit` 通过（标题含 [CONFIG]）
- [ ] `API Test` 通过（新增 3 个单元测试全绿）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3-3: 关闭旧 PR #294**

```bash
gh pr close 294 --comment "此 PR 已在 #<new-pr-number> 中重新实现并修复所有 CI 问题"
```
