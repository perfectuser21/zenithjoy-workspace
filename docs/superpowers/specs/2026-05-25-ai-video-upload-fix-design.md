# AI Video Upload 端点补全设计

## 背景

PR #294 实现了 POST /api/ai-video/upload 端点，但因 CI 失败未合并。核心 bug：dispatch() 调用 execSync(ssh/scp) 阻塞 Node.js 事件循环，期间 getGenerationById() 因 pg-pool connectionTimeout 超时失败。

## 解决方案

### 架构

```
POST /api/ai-video/upload (multipart)
  ↓
multer diskStorage → ~/video-pipeline/jobs/:jobId/src/
  ↓
AiVideoUploadService.createJob() → DB INSERT (status=queued)
  ↓
AiVideoUploadService.dispatch() → fire-and-forget (ssh/scp 到 xian-m4)
  ↓
立即返回 201 { id, status:'queued', progress:0, script_text }
```

关键修复：upload 后**不再调用** getGenerationById()，直接返回已知数据，绕开 pg-pool 超时。

### 组件

**`ai-video-upload.service.ts`**
- `createJob(params)`: DB INSERT，返回 jobId
- `dispatch(params)`: fire-and-forget，ssh/scp 传文件到 xian-m4，启动 polling loop
- `startPolling()`: setInterval 每 5s 轮询 xian-m4 status.json，更新 DB 进度

**`ai-video.controller.ts`** 新增：
- `uploadAndProcess()`: 接收 multer 文件，调 createJob + dispatch，返回 201
- `downloadFile()`: 从本地 out/ 目录返回处理结果视频

**`ai-video.ts`** 路由新增：
- `POST /upload` + multer.fields(['video', 'logo'])
- `GET /download/:jobId/:file`

### 测试策略

- **smoke test** (E2E): POST /api/ai-video/upload 无 video 文件 → 400
- **unit test** (controller): uploadAndProcess 三路：无文件→400，无script→400，有效→201
- **unit test** (service): createJob → DB mock 接受正确参数
- **unit test** (route): POST /upload 无 multipart → 400

### CI 合规

- lint-test-pairing: 三个修改/新增的 src 文件各有配套测试 ✅
- lint-tdd-commit-order: commit-1 smoke → commit-2 impl ✅
- ci-config-audit: PR 标题加 [CONFIG] 因为 smoke 在 .github/workflows/ 下 ✅
- typecheck: multer + @types/multer 已在 package.json ✅
