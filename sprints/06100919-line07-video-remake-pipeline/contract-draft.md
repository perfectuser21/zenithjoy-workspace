# Sprint Contract Draft (Round 5)

## 已知约束（来自回归测试）

（暂无已知约束 — apps/dashboard/e2e/ 无 video-remake 相关测试文件，apps/api/src/routes/ 无 video-remake 路由）

---

## Response Schema（推导来源: api_registry推导 + PRD字面）

> 推导依据：`apps/api/src/routes/ai-video-pipeline.ts` 使用 `job_id` 命名风格；`apps/api/src/clients/toapi.client.ts` 现有 ToAPI 集成；DB status 枚举来自现有 ai-video-pipeline: `queued/in_progress/completed/failed`。

### Endpoint: POST /api/video-remake/jobs
**Success (HTTP 200)**:
```json
{ "job_id": "<string>", "status": "queued" }
```
- `job_id` (string, 必填): 由 api_registry ai-video-pipeline 端点推导，保持 `job_id` 命名风格（非 `id`/`jobId`）
- `status` (string, 必填): 初始状态固定为 `"queued"`，与系统 status 枚举对齐
**禁用字段名**: `id`, `task_id`, `jobId`, `job`
**Error (HTTP 400)**:
```json
{ "error": "<string>" }
```

### Endpoint: GET /api/video-remake/jobs/:job_id
**Success (HTTP 200)**:
```json
{
  "job_id": "<string>",
  "filename": "<string>",
  "duration_seconds": "<number>",
  "width": "<number>",
  "height": "<number>",
  "status": "<string>",
  "nodes": [
    { "node_id": "<string>", "label": "<string>", "status": "idle|running|done|error", "input": {}, "output": {} }
  ]
}
```
- `nodes[N02].output` (object): `{ frames: [{ frame_url: string, timestamp_seconds: number }] }` — N02 完成后填充
- `nodes[N03].output` (object): `{ original_frame_url: string, prompt_text: string }` — N03 完成后填充
- `nodes[N04].output` (object): `{ original_frame_url: string, redrawn_frame_url: string }` — N04 完成后填充
- `nodes[N05].output` (object): `{ frames: [{ redrawn_frame_url: string, score: number }] }` — N05 完成后填充
- `nodes[N06].output` (object): `{ approved: true, frames: [{ redrawn_frame_url: string }] }` — N06 完成后填充
- `nodes[N08].output` (object): `{ video_segment_url: string, duration_seconds: number }` — N08 完成后填充
**禁用字段名**: `id`, `node_status`, `nodeId`, `nodes_status`
**Error (HTTP 404)**:
```json
{ "error": "<string>" }
```

### Endpoint: POST /api/video-remake/jobs/:job_id/nodes/N07/select
**Success (HTTP 200)**:
```json
{ "job_id": "<string>", "selected_frame": "<string>" }
```
**禁用字段名**: `frame_id`, `chosen_frame`, `frameIndex`, `frame`

### Endpoint: GET /api/video-remake/jobs/:job_id/output
**Success (HTTP 200)**:
```json
{ "job_id": "<string>", "download_url": "<string>", "duration_seconds": "<number>", "has_video_stream": "<boolean>" }
```
- `has_video_stream` (boolean, 必填): ffprobe 验证有视频流，值必须为 `true`
**禁用字段名**: `url`, `video_url`, `outputUrl`, `hasVideo`

---

## Golden Path

```
[用户打开 /video-remake]
  → [N01 上传 MP4 → 文件名/时长/分辨率展示，节点变绿]
  → [N02 抽帧 → 节点展开见帧缩略图列表，节点变绿]
  → [N03 场景分析 → 节点展开见原帧URL+Prompt文本，节点变绿]
  → [N04 gpt-image-2重绘 → 节点展开见原帧/重绘帧对比，节点变绿]
  → [N05 帧评选 → 节点展开见评分列表(redrawn_frame_url+score)，节点变绿]
  → [N06 重绘审核 → 节点展开见帧序列，点Continue，节点变绿]
  → [N07 起始帧选择 → CI=true自动选第一帧，节点变绿]
  → [N08 i2v生成 → 节点展开见进度+预览，节点变绿]
  → [N09 合成导出 → 下载按钮可见，下载 MP4，ffprobe 确认有视频流+时长>0]
```

> **两阶段验证架构（内部一致）**：
> - **Phase 1（UI 验证）**：`video-remake.spec.ts` 使用 `page.route` API stub，验证 Dashboard 组件行为正确 —— stub 是 UI 集成测试的标准做法，不影响后端正确性。
> - **Phase 2（真实 AI 验证）**：`e2e-verify.ps1` Step 7 启动本地 API server（注入 TOAPI_API_KEY / DASHSCOPE_API_KEY），POST 真实测试视频，轮询直到 N09 completed，下载 MP4 并 ffprobe 验证 — 满足 PRD DoD #3（真实 gpt-image-2）、#5（真实 DashScope i2v）、#8（smoke + ffprobe）。
> - Phase 1 的 `has_video_stream=true` 是 `MOCK_OUTPUT` 常量，仅验证 UI 显示逻辑；真实 ffprobe 验证在 Phase 2。

---

### Step 1: 打开 `/video-remake` 页面显示 9 节点流水线图

**来源**: `[FROM_PRD]` — PRD DoD 第1条:"Dashboard 新页面 `/video-remake` 展示 9节点 n8n 风格流水线图，每节点有状态指示（灰/运行中/绿/红）"

**可观测行为**: 浏览器打开 `/video-remake`，页面显示 9 个节点组件（N01–N09），每个节点默认状态为灰色（idle），并有标签文字。

**验证命令**（Playwright spec 存在且含9节点断言）:
```bash
node -e "
const c = require('fs').readFileSync('apps/dashboard/e2e/video-remake.spec.ts', 'utf8');
['N01','N02','N03','N04','N05','N06','N07','N08','N09'].forEach(id => {
  if (!c.includes(id)) { console.error('FAIL: spec缺节点断言', id); process.exit(1); }
});
if (!c.includes('/video-remake')) { console.error('FAIL: spec缺路由断言'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: 9 个节点 id 均在 spec 中出现，页面路由 `/video-remake` 存在

---

### Step 2: N01 上传 MP4 → Dashboard 显示文件信息，节点变绿

**来源**: `[FROM_PRD]` — PRD Golden Path Step 1:"用户点'选择文件'上传本地 MP4；Dashboard 显示文件名/时长/分辨率；N01节点变绿"

**可观测行为**: 选择 ≤100MB 的 MP4 文件后，Dashboard 显示文件名、时长（秒）、分辨率（宽×高），N01 节点变绿。

**验证命令**（直接调用 createVideoRemakeJob 验证响应 schema）:
```bash
node --input-type=module << 'EOF'
import { createVideoRemakeJob } from './apps/api/src/services/video-remake.service.js';
const r = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from([0,0,0]) });
if (typeof r.job_id !== 'string' || r.job_id.length === 0) { console.error('FAIL: job_id 非 string 或为空'); process.exit(1); }
if (r.status !== 'queued') { console.error('FAIL: status != queued, got', r.status); process.exit(1); }
if ('id' in r || 'jobId' in r || 'task_id' in r) { console.error('FAIL: 禁用字段出现'); process.exit(1); }
console.log('OK job_id=' + r.job_id);
EOF
```

**硬阈值**: `job_id` 为非空字符串，`status="queued"`，无禁用字段

---

### Step 2.5: N02 抽帧 — 节点展开可见帧缩略图列表

**来源**: `[FROM_PRD]` — PRD Golden Path Step 2:"系统均匀抽取关键帧序列；节点展开可见帧缩略图列表"

**可观测行为**: N02 节点执行完成后，节点展开面板显示帧缩略图列表，每项含帧图片 URL + 时间戳。`nodes[N02].output.frames` 为非空数组，每项含 `{ frame_url: string, timestamp_seconds: number }`。

**验证命令**（直接调用 extractFrames 服务函数，验证输出结构）:
```bash
TEST_MODE=1 node --input-type=module << 'EOF'
import { createVideoRemakeJob, extractFrames } from './apps/api/src/services/video-remake.service.js';
const created = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from([0,0,0]) });
const r = await extractFrames({ jobId: created.job_id });
if (!Array.isArray(r.frames) || r.frames.length === 0) {
  console.error('FAIL: N02 output.frames 非数组或为空'); process.exit(1);
}
const f = r.frames[0];
if (typeof f.frame_url !== 'string' || f.frame_url.length === 0) {
  console.error('FAIL: N02 frames[0] 缺 frame_url'); process.exit(1);
}
if (typeof f.timestamp_seconds !== 'number') {
  console.error('FAIL: N02 frames[0] 缺 timestamp_seconds(number)'); process.exit(1);
}
console.log('OK N02 frames.length=' + r.frames.length + ' frame_url=' + f.frame_url.slice(0,40));
EOF
```

**硬阈值**: `frames` 非空数组，每项含 `frame_url`(string) + `timestamp_seconds`(number)

---

### Step 3: N03 场景分析 — 节点展开可见原帧 URL + Prompt 文本

**来源**: `[FROM_PRD]` — PRD Golden Path Step 3:"AI 分析帧内容，为每帧生成重绘 Prompt；节点展开可见原帧 + Prompt 文本"

**可观测行为**: N03 节点执行完成后，节点展开面板显示：左侧"原帧"（`original_frame_url` 对应的图像），右侧"Prompt"文本（非空字符串）。

**验证命令**:
```bash
TEST_MODE=1 node --input-type=module << 'EOF'
import { analyzeSceneFrame } from './apps/api/src/services/video-remake.service.js';
const r = await analyzeSceneFrame({ frameUrl: 'fixture://test-frame-0.jpg', frameIndex: 0 });
if (typeof r.original_frame_url !== 'string' || r.original_frame_url.length === 0) {
  console.error('FAIL: N03 output 缺 original_frame_url'); process.exit(1);
}
if (typeof r.prompt_text !== 'string' || r.prompt_text.length === 0) {
  console.error('FAIL: N03 output 缺 prompt_text 或为空'); process.exit(1);
}
console.log('OK N03 original_frame_url=' + r.original_frame_url.slice(0,30) + '...');
EOF
```

**硬阈值**: `original_frame_url` 非空 string，`prompt_text` 非空 string

---

### Step 4: N05 帧评选 — 节点展开可见评分列表

**来源**: `[FROM_PRD]` — PRD Golden Path Step 5:"系统按质量评分推荐最优重绘帧；节点展开可见评分列表"

**可观测行为**: N05 节点执行完成后，节点展开面板显示帧评分列表，每项含重绘帧图像 + 评分数值（`score`）。

**验证命令**:
```bash
TEST_MODE=1 node --input-type=module << 'EOF'
import { evaluateFrameScores } from './apps/api/src/services/video-remake.service.js';
const r = await evaluateFrameScores({
  redrawnFrames: [{ original_frame_url: 'fixture://orig-0.jpg', redrawn_frame_url: 'fixture://redrawn-0.jpg' }]
});
if (!Array.isArray(r.frames) || r.frames.length === 0) {
  console.error('FAIL: N05 output.frames 非数组或为空'); process.exit(1);
}
const f = r.frames[0];
if (typeof f.redrawn_frame_url !== 'string') { console.error('FAIL: N05 frames[0] 缺 redrawn_frame_url'); process.exit(1); }
if (typeof f.score !== 'number') { console.error('FAIL: N05 frames[0] 缺 score(number)'); process.exit(1); }
console.log('OK N05 frames.length=' + r.frames.length + ' score=' + f.score);
EOF
```

**硬阈值**: `frames` 非空数组，每项含 `redrawn_frame_url`(string) + `score`(number)

---

### Step 5: N04 gpt-image-2 重绘 — 成功路径返回原帧/重绘帧对比

**来源**: `[FROM_PRD]` — PRD DoD 第3条:"N04 调用 ToAPI gpt-image-2 返回重绘图，节点展开可见原帧 / 重绘帧对比"

**可观测行为**: N04 执行成功后，`nodes[N04].output` 含 `{ original_frame_url: string, redrawn_frame_url: string }`，两个 URL 均非空。Phase 2 smoke 中通过真实 TOAPI_API_KEY 调用，返回真实重绘图 URL。

**验证命令**（evaluator 模式A：TEST_MODE=1 验证函数 schema）:
```bash
TEST_MODE=1 node --input-type=module << 'EOF'
import { redrawFrameWithToAPI } from './apps/api/src/services/video-remake.service.js';
const r = await redrawFrameWithToAPI({ frameUrl: 'fixture://test-frame-0.jpg', frameIndex: 0 });
if (typeof r.original_frame_url !== 'string' || r.original_frame_url.length === 0) {
  console.error('FAIL: N04 output 缺 original_frame_url'); process.exit(1);
}
if (typeof r.redrawn_frame_url !== 'string' || r.redrawn_frame_url.length === 0) {
  console.error('FAIL: N04 output 缺 redrawn_frame_url'); process.exit(1);
}
console.log('OK N04 success original_frame_url=' + r.original_frame_url.slice(0,40) + ' redrawn_frame_url=' + r.redrawn_frame_url.slice(0,40));
EOF
```

**硬阈值**: `original_frame_url` 非空 string，`redrawn_frame_url` 非空 string

---

### Step 5.5: N06 重绘审核 — Continue 通过，节点变绿

**来源**: `[FROM_PRD]` — PRD Golden Path Step 6:"预览重绘帧序列，用户可直接 Continue；节点展开可见帧序列"

**可观测行为**: N06 节点显示 N05 评选后的重绘帧序列，用户（CI=true 时自动）点击 Continue，N06 状态变 done。`approveN06Review({ jobId })` 返回 `{ job_id, node_id: "N06", status: "done" }`，`nodes[N06].output.approved = true`。

**验证命令**:
```bash
TEST_MODE=1 node --input-type=module << 'EOF'
import { createVideoRemakeJob, approveN06Review } from './apps/api/src/services/video-remake.service.js';
const created = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from([0,0,0]) });
const r = await approveN06Review({ jobId: created.job_id });
if (r.node_id !== 'N06') { console.error('FAIL: node_id != N06, got', r.node_id); process.exit(1); }
if (r.status !== 'done') { console.error('FAIL: status != done, got', r.status); process.exit(1); }
if (typeof r.job_id !== 'string') { console.error('FAIL: job_id 非 string'); process.exit(1); }
console.log('OK N06 done node_id=' + r.node_id + ' status=' + r.status);
EOF
```

**硬阈值**: `node_id="N06"`，`status="done"`，`job_id` 非空 string

---

### Step 6: N07 起始帧选择 — CI=true 自动选第一帧通过

**来源**: `[FROM_PRD]` — PRD DoD 第4条:"N07 在非CI环境展示候选帧选择UI；在 `CI=true` 时自动选第一帧并通过"

**可观测行为**: 当 `CI=true` 时，N07 节点跳过手动选帧 UI，自动调用 `POST .../nodes/N07/select`，节点变绿，`selected_frame` 为第一帧路径（非空字符串）。

**验证命令**:
```bash
TEST_MODE=1 node --input-type=module << 'EOF'
import { createVideoRemakeJob, selectN07Frame } from './apps/api/src/services/video-remake.service.js';
const created = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from([0,0,0]) });
const r = await selectN07Frame({ jobId: created.job_id, ciAuto: true });
if (Object.keys(r).sort().join(',') !== 'job_id,selected_frame') {
  console.error('FAIL: keys != [job_id, selected_frame], got', Object.keys(r).sort()); process.exit(1);
}
if (typeof r.selected_frame !== 'string' || r.selected_frame.length === 0) {
  console.error('FAIL: selected_frame 为空'); process.exit(1);
}
if ('frame_id' in r || 'chosen_frame' in r || 'frameIndex' in r) {
  console.error('FAIL: 禁用字段出现'); process.exit(1);
}
console.log('OK selected_frame=' + r.selected_frame);
EOF
```

**硬阈值**: keys 精确等于 `["job_id","selected_frame"]`，`selected_frame` 非空，无禁用字段

---

### Step 7: N09 合成导出 — 下载翻拍 MP4，ffprobe 验证有视频流

**来源**: `[FROM_PRD]` — PRD DoD 第6条:"N09 合成后用户可点击下载翻拍 MP4（ffprobe 验证：有视频流 + 时长 > 0）"；DoD 第8条:"smoke test：下载 mp4 → ffprobe 验证非空有视频流"

**可观测行为**: N09 执行完成后，`GET /api/video-remake/jobs/:id/output` 返回 `{ download_url, duration_seconds > 0, has_video_stream: true }`。**Phase 2 smoke** 在 `e2e-verify.ps1` Step 7 中从 `download_url` 实际下载文件并运行 `ffprobe` 验证视频流存在、时长 > 0。

**验证命令**（evaluator 模式A：TEST_MODE=1 验证 output schema）:
```bash
TEST_MODE=1 node --input-type=module << 'EOF'
import { createVideoRemakeJob, getVideoRemakeOutput } from './apps/api/src/services/video-remake.service.js';
const created = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from([0,0,0]) });
const o = await getVideoRemakeOutput(created.job_id);
if (typeof o.download_url !== 'string' || o.download_url.length === 0) {
  console.error('FAIL: download_url 缺失'); process.exit(1);
}
if (typeof o.duration_seconds !== 'number' || o.duration_seconds <= 0) {
  console.error('FAIL: duration_seconds 非正数, got', o.duration_seconds); process.exit(1);
}
if (o.has_video_stream !== true) { console.error('FAIL: has_video_stream != true'); process.exit(1); }
if ('url' in o || 'video_url' in o || 'hasVideo' in o) { console.error('FAIL: 禁用字段出现'); process.exit(1); }
console.log('OK duration_seconds=' + o.duration_seconds + ' has_video_stream=' + o.has_video_stream);
EOF
```

**硬阈值**: `duration_seconds > 0`，`has_video_stream = true`，ffprobe（Phase 2）确认视频流存在

---

### Step 8: 边界 — 超 100MB 文件被前端拒绝

**来源**: `[FROM_PRD]` — PRD 边界情况:"源视频超 100MB：前端拒绝上传，不进入流水线"

**验证命令**:
```bash
node --input-type=module << 'EOF'
import { createVideoRemakeJob } from './apps/api/src/services/video-remake.service.js';
try {
  await createVideoRemakeJob({ filename: 'large.mp4', fileSizeBytes: 104857601, buffer: Buffer.from([]) });
  console.error('FAIL: 超100MB应抛出错误但未抛出'); process.exit(1);
} catch (e) {
  console.log('OK 超100MB正确拒绝:', e.message || e.code);
}
EOF
```

**硬阈值**: 超100MB 输入抛出错误，API 层返回 HTTP 400/413

---

### Step 9: 边界 — N04 gpt-image-2 单帧调用失败，节点标红

**来源**: `[FROM_PRD]` — PRD 边界情况:"N04 单帧 gpt-image-2 调用失败：节点标红，展示错误信息，允许重试"

**验证命令**:
```bash
FORCE_TOAPI_FAIL=1 node --input-type=module << 'EOF'
import { redrawFrameWithToAPI } from './apps/api/src/services/video-remake.service.js';
try {
  await redrawFrameWithToAPI({ frameUrl: 'test.jpg', frameIndex: 0 });
  console.error('FAIL: FORCE_TOAPI_FAIL=1 时应抛出错误'); process.exit(1);
} catch (e) {
  if (e.code !== 'N04_API_FAILURE') {
    console.error('FAIL: 错误 code != N04_API_FAILURE, got', e.code); process.exit(1);
  }
  console.log('OK N04 失败路径正确 code=N04_API_FAILURE');
}
EOF
```

**硬阈值**: `FORCE_TOAPI_FAIL=1` 时抛出 `{ code: "N04_API_FAILURE" }` 错误

---

### Step 10: 边界 — N08 i2v 超时（>5 分钟），节点标红

**来源**: `[FROM_PRD]` — PRD 边界情况:"N08 i2v 超时（>5 分钟）：节点标红，展示超时提示"

**验证命令**:
```bash
N08_TIMEOUT_MS=1 node --input-type=module << 'EOF'
import { generateVideoWithDashScope } from './apps/api/src/services/video-remake.service.js';
try {
  await generateVideoWithDashScope({ frameUrl: 'test.jpg', apiKey: 'test-key' });
  console.error('FAIL: N08_TIMEOUT_MS=1 时应抛出超时错误'); process.exit(1);
} catch (e) {
  if (e.code !== 'N08_TIMEOUT') {
    console.error('FAIL: 错误 code != N08_TIMEOUT, got', e.code); process.exit(1);
  }
  console.log('OK N08 超时路径正确 code=N08_TIMEOUT');
}
EOF
```

**硬阈值**: `N08_TIMEOUT_MS=1` 时抛出 `{ code: "N08_TIMEOUT" }` 错误

---

## Risks

| 风险 | 场景 | 缓解措施 |
|---|---|---|
| N04 gpt-image-2 单帧调用失败 | ToAPI 服务不可用 / API Key 无效 / 速率限制 | 节点标红 + 展示 `error_message` + 页面显示"重试"按钮；最多重试3次后暂停流水线 |
| N08 DashScope i2v 超时（>5 分钟）| DashScope 服务响应慢 / 任务队列积压 | 5分钟超时检测：节点标红 + 展示"i2v 生成超时，请重新触发 N08"；`code=N08_TIMEOUT` |
| Phase 2 smoke 在 GHA 超时 | 真实 i2v 生成耗时 > 40min | GHA timeout-minutes=45，CI=true 使用1s测试视频最小化帧数，预计10-15min完成 |

---

## E2E 验收（windows_cloud 变体C — Dashboard/Vite/Playwright + 后端 smoke）

**journey_type**: user_facing
**target_environment**: windows_cloud
**GHA workflow**: `.github/workflows/e2e-windows.yml`

### windows_cloud BEHAVIOR 用户路径 1:1 映射检查（已读取 e2e-windows.yml）

| 用户操作 | 覆盖层 | 覆盖状态 |
|---|---|---|
| 打开 /video-remake 页面，见9节点 | Phase 1 Playwright spec | ✅ |
| 上传 MP4，N01 变绿，文件名/时长/分辨率展示 | Phase 1 Playwright spec (stub) | ✅ |
| N02-N06 依序执行，各节点变绿 | Phase 1 Playwright spec (stub) | ✅ |
| N03 展开显示原帧+Prompt文本 | Phase 1 Playwright spec (stub) | ✅ |
| N04 展开显示原帧/重绘帧对比 | Phase 1 Playwright spec (stub) | ✅ |
| N05 展开显示评分列表 | Phase 1 Playwright spec (stub) | ✅ |
| N07 CI 自动选帧 | Phase 1 Playwright spec (stub) | ✅ |
| N09 下载按钮可见 | Phase 1 Playwright spec (stub) | ✅ |
| N04 真实 gpt-image-2 调用 | Phase 2 backend smoke (real API) | ✅ |
| N08 真实 DashScope i2v 调用 | Phase 2 backend smoke (real API) | ✅ |
| 下载 MP4 + ffprobe 验证视频流 | Phase 2 backend smoke (real API) | ✅ |
| 超100MB 文件前端拒绝 | Phase 1 Playwright spec | ✅ |
| TOAPI_API_KEY 注入 | e2e-windows.yml env | [CI_GAP → Generator 必须加 secret] |
| DASHSCOPE_API_KEY 注入 | e2e-windows.yml env | [CI_GAP → Generator 必须加 secret] |

### e2e-verify.ps1 完整脚本

```powershell
# final-e2e 验证脚本 — ZenithJoy Dashboard Playwright + backend smoke（windows-latest）
# Phase 1: Playwright UI 测试（API stub）
# Phase 2: 后端 smoke（真实 TOAPI + DashScope 调用，ffprobe 验证）
param(
  [string]$BaseUrl = "http://localhost:5174",
  [string]$SuperAdminEmail = $env:E2E_SUPER_ADMIN_EMAIL,
  [string]$SuperAdminPassword = $env:E2E_SUPER_ADMIN_PASSWORD
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5174
$ApiPort  = 3001
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

# =========================================================
# Phase 1: Playwright UI 测试（API stub，验证 Dashboard 行为）
# =========================================================

# 1. 安装依赖
Write-Host "▶ [Phase 1] Installing dependencies..."
$installProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($installProc.ExitCode -ne 0) { throw "FAIL: npm ci failed" }

# 2. 安装 Playwright 浏览器
$pwProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($pwProc.ExitCode -ne 0) { throw "FAIL: playwright install failed" }

# 3. Build Dashboard
Write-Host "▶ [Phase 1] Building dashboard..."
$buildProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
if ($buildProc.ExitCode -ne 0) { throw "FAIL: dashboard build failed" }

# 4. 启动 Vite preview
Write-Host "▶ [Phase 1] Starting Vite preview port=$VitePort..."
$serverProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow

# 5. 等待 Vite 就绪
$maxWait = 30; $waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) {
  Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: Vite 未在 ${maxWait}s 内就绪"
}
Write-Host "✅ Vite 就绪 port=$VitePort"

# 6. 跑 Playwright E2E
$env:BASE_URL = $BaseUrl; $env:CI = "true"
$env:E2E_EMAIL = $SuperAdminEmail; $env:E2E_PASSWORD = $SuperAdminPassword
$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\video-remake.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
if ($e2eProc.ExitCode -ne 0) { throw "FAIL: Playwright E2E 失败 exit=$($e2eProc.ExitCode)" }
Write-Host "✅ [Phase 1] Playwright UI 验证通过"

# =========================================================
# Phase 2: 后端 smoke — 真实 AI 调用（N04 gpt-image-2 + N08 DashScope i2v）
# =========================================================

Write-Host "▶ [Phase 2] Backend smoke — 真实 AI 调用..."

# 验证 API keys 已注入（缺 key = CI 环境未就绪 = FAIL，禁止 skip）
if ([string]::IsNullOrEmpty($env:TOAPI_API_KEY)) {
  throw "FAIL: TOAPI_API_KEY 未注入。在 e2e-windows.yml 中添加 secrets.TOAPI_API_KEY"
}
if ([string]::IsNullOrEmpty($env:DASHSCOPE_API_KEY)) {
  throw "FAIL: DASHSCOPE_API_KEY 未注入。在 e2e-windows.yml 中添加 secrets.DASHSCOPE_API_KEY"
}

# 启动 API server（注入真实 API keys）
$env:PORT = $ApiPort
$env:NODE_ENV = "production"
$apiProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c node apps/api/src/index.js" `
  -WorkingDirectory $repoRoot -PassThru -NoNewWindow

# 等待 API 就绪
$waited = 0
do {
  Start-Sleep -Seconds 2; $waited += 2
  $conn = Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt 30)
if (-not $conn.TcpTestSucceeded) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: API server 未在 30s 内就绪 port=$ApiPort"
}
Write-Host "✅ API server 就绪 port=$ApiPort"

# 生成 1s 测试 MP4（用 ffmpeg，windows-latest 内置）
$testVideoPath = "$env:TEMP\test-smoke-1s.mp4"
$ffmpegProc = Start-Process -FilePath "ffmpeg" `
  -ArgumentList "-f lavfi -i testsrc=duration=1:size=64x64:rate=1 -f lavfi -i sine=duration=1 -c:v libx264 -c:a aac -y `"$testVideoPath`"" `
  -Wait -PassThru -NoNewWindow -ErrorAction SilentlyContinue
if ($ffmpegProc.ExitCode -ne 0 -or -not (Test-Path $testVideoPath)) {
  # fallback: 用 Node 生成最小有效 MP4 fixture
  $testVideoPath = "$scriptDir\tests\fixtures\test-1s-64x64.mp4"
  if (-not (Test-Path $testVideoPath)) {
    Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
    throw "FAIL: 无法生成测试视频，且 fixture 不存在: $testVideoPath"
  }
}
Write-Host "✅ 测试视频就绪: $testVideoPath"

# POST /api/video-remake/jobs（上传测试视频）
$jobRespRaw = cmd.exe /c "curl -sf -X POST http://localhost:${ApiPort}/api/video-remake/jobs -F video=@`"$testVideoPath`"" 2>&1
if ($LASTEXITCODE -ne 0) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: POST /api/video-remake/jobs 失败: $jobRespRaw"
}
$jobResp = $jobRespRaw | ConvertFrom-Json
$jobId = $jobResp.job_id
if ([string]::IsNullOrEmpty($jobId)) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: job_id 为空: $jobRespRaw"
}
Write-Host "✅ 任务已创建 job_id=$jobId"

# 轮询直到 N09 completed（CI=true 自动选帧，最多 40 分钟）
$maxPoll = 2400; $polled = 0
do {
  Start-Sleep -Seconds 15; $polled += 15
  $statusRaw = cmd.exe /c "curl -sf http://localhost:${ApiPort}/api/video-remake/jobs/$jobId" 2>&1
  $statusObj = $statusRaw | ConvertFrom-Json
  Write-Host "  轮询 ${polled}s status=$($statusObj.status)"
} while ($statusObj.status -notin @('completed','failed') -and $polled -lt $maxPoll)

if ($statusObj.status -eq 'failed') {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: 流水线 status=failed"
}
if ($statusObj.status -ne 'completed') {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: 超时 ${maxPoll}s status=$($statusObj.status)"
}
Write-Host "✅ 流水线 N09 completed"

# 验证 GET /api/video-remake/jobs/:id 响应 schema（filename/duration_seconds/width/height/nodes.Count==9）
if ([string]::IsNullOrEmpty($statusObj.filename)) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: GET /jobs/:id response 缺 filename 或为空"
}
if ($null -eq $statusObj.duration_seconds) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: GET /jobs/:id response 缺 duration_seconds"
}
if ($null -eq $statusObj.width) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: GET /jobs/:id response 缺 width"
}
if ($null -eq $statusObj.height) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: GET /jobs/:id response 缺 height"
}
if ($statusObj.nodes.Count -ne 9) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: GET /jobs/:id response nodes.Count=$($statusObj.nodes.Count) 非 9"
}
Write-Host "✅ GET /jobs/:id schema 验证通过: filename=$($statusObj.filename) w=$($statusObj.width) h=$($statusObj.height) nodes=$($statusObj.nodes.Count)"

# GET /api/video-remake/jobs/:id/output — 验证 has_video_stream + duration_seconds
$outputRaw = cmd.exe /c "curl -sf http://localhost:${ApiPort}/api/video-remake/jobs/$jobId/output" 2>&1
$output = $outputRaw | ConvertFrom-Json
if ($output.has_video_stream -ne $true) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: has_video_stream != true, got $($output.has_video_stream)"
}
if ($output.duration_seconds -le 0) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: duration_seconds <= 0, got $($output.duration_seconds)"
}

# 下载翻拍 MP4，运行 ffprobe
$outputVideoPath = "$env:TEMP\remake-output.mp4"
cmd.exe /c "curl -sf `"$($output.download_url)`" -o `"$outputVideoPath`"" 2>&1
if ($LASTEXITCODE -ne 0) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: 下载翻拍 MP4 失败"
}
$ffprobeCodec = ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "$outputVideoPath" 2>&1
if ($ffprobeCodec -notmatch "video") {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: ffprobe 无视频流 output=$ffprobeCodec"
}
$ffprobeDuration = ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$outputVideoPath" 2>&1
if ([double]$ffprobeDuration -le 0) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: ffprobe duration=$ffprobeDuration <= 0"
}
Write-Host "✅ ffprobe 验证通过 duration=$ffprobeDuration has_video_stream=true"

Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
Write-Host "✅ [Phase 2] backend smoke 验证通过"
Write-Host "✅ video-remake 9节点流水线 E2E 全部通过（Phase 1 UI + Phase 2 smoke）"
exit 0
```

**PASS 标准**: `exit 0` + Phase 1 Playwright 所有 spec 通过 + Phase 2 ffprobe 确认有视频流
**FAIL 标准**: 任何 step exit≠0 OR Playwright 失败 OR Vite 30s 内未就绪 OR TOAPI/DASHSCOPE key 未注入 OR ffprobe 无视频流
**secrets 必须**: `E2E_SUPER_ADMIN_EMAIL`、`E2E_SUPER_ADMIN_PASSWORD`、`TOAPI_API_KEY`、`DASHSCOPE_API_KEY`

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Video Remake 服务 (unit) | `sprints/06100919-line07-video-remake-pipeline/tests/video-remake.test.ts` | createJob/getJob/N02/N03/N04success/N05/N06/N07Select/getOutput schema + N04/N08 error path | → 14+ failures（模块不存在）|
| E2E Dashboard (Playwright) | `apps/dashboard/e2e/video-remake.spec.ts` | 9节点渲染/N01上传/N03展开/N04对比/N05评分/N07CI/N09下载/100MB拒绝 | → 所有 test FAIL（页面不存在）|
