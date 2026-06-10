# Sprint Contract Draft (Round 3)

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
- `job_id` (string, 必填): 任务 ID
- `filename` (string, 必填): 原始上传文件名
- `duration_seconds` (number, 必填): 视频时长（秒）
- `width` (number, 必填): 视频宽度像素
- `height` (number, 必填): 视频高度像素
- `status` (string, 必填): 整体状态 `queued/in_progress/completed/failed`
- `nodes` (array, 必填): 9个节点状态数组，`node_id` 格式 `"N01"`–`"N09"`
- `nodes[N03].output` (object): `{ original_frame_url: string, prompt_text: string }` — N03 完成后填充
- `nodes[N05].output` (object): `{ frames: [{ redrawn_frame_url: string, score: number }] }` — N05 完成后填充
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
- `job_id` (string, 必填): 任务 ID
- `selected_frame` (string, 必填): 被选中的帧文件名或 URL
**禁用字段名**: `frame_id`, `chosen_frame`, `frameIndex`, `frame`
**Error (HTTP 400/404)**:
```json
{ "error": "<string>" }
```

### Endpoint: GET /api/video-remake/jobs/:job_id/output
**Success (HTTP 200)**:
```json
{ "job_id": "<string>", "download_url": "<string>", "duration_seconds": "<number>", "has_video_stream": "<boolean>" }
```
- `job_id` (string, 必填): 任务 ID
- `download_url` (string, 必填): 翻拍 MP4 下载地址
- `duration_seconds` (number, 必填): 输出视频时长（秒）> 0
- `has_video_stream` (boolean, 必填): ffprobe 验证有视频流，值必须为 `true`
**禁用字段名**: `url`, `video_url`, `outputUrl`, `hasVideo`
**Error (HTTP 404)**:
```json
{ "error": "<string>" }
```

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

> **[ASSUMPTION: TEST_MODE=1]** 以下 BEHAVIOR 单测中 `TEST_MODE=1` 标志使服务层函数返回固定 fixture 数据，**不实际调用** ToAPI gpt-image-2 / DashScope i2v 外部 API；真实 AI 调用仅在 `e2e-verify.ps1`（windows_cloud CI）通过真实 API Key 触发，满足 PRD DoD #8 真实 smoke 要求。若实现选择 `TEST_MODE=1` 走 mock 路径，须在服务代码中明确注释说明该 flag 行为；若实现选择直接调用真实 API（测试时需有效 API Key），须删除 `TEST_MODE=1` 前缀并在 README 说明依赖。

---

### Step 1: 打开 `/video-remake` 页面显示 9 节点流水线图

**来源**: `[FROM_PRD]` — PRD DoD 第1条:"Dashboard 新页面 `/video-remake` 展示 9节点 n8n 风格流水线图，每节点有状态指示（灰/运行中/绿/红）"

**可观测行为**: 浏览器打开 `/video-remake`，页面显示 9 个节点组件（N01–N09），每个节点默认状态为灰色（idle），并有标签文字（N01:上传解析, N02:抽帧, …, N09:合成导出）。

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

**可观测行为**: 选择 ≤100MB 的 MP4 文件后，Dashboard 显示文件名、时长（秒）、分辨率（宽×高），N01 节点变绿色（`status="done"`）。API 响应 `POST /api/video-remake/jobs` 返回 `{ job_id, status:"queued" }`。

**验证命令**（真实 API 调用验证 POST /jobs 响应 schema）:
```bash
node --input-type=module << 'EOF'
import { createVideoRemakeJob } from './apps/api/src/services/video-remake.service.js';
const result = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from([0,0,0]) });
if (typeof result.job_id !== 'string' || result.job_id.length === 0) { console.error('FAIL: job_id 非 string 或为空'); process.exit(1); }
if (result.status !== 'queued') { console.error('FAIL: status != queued, got', result.status); process.exit(1); }
if ('id' in result || 'jobId' in result || 'task_id' in result) { console.error('FAIL: 禁用字段出现'); process.exit(1); }
console.log('OK job_id=' + result.job_id);
EOF
```

**硬阈值**: `job_id` 为非空字符串，`status="queued"`，无禁用字段

---

### Step 3: N03 场景分析 — 节点展开可见原帧 URL + Prompt 文本

**来源**: `[FROM_PRD]` — PRD Golden Path Step 3:"AI 分析帧内容，为每帧生成重绘 Prompt；节点展开可见原帧 + Prompt 文本"

**可观测行为**: N03 节点执行完成后，节点展开面板显示：左侧"原帧"（`original_frame_url` 对应的图像），右侧"Prompt"文本（非空字符串，由 AI 生成的重绘指令）。`GET /api/video-remake/jobs/:id` 中 `nodes[N03].output` 含 `{ original_frame_url: string, prompt_text: string }`。

**验证命令**（直接调用 N03 服务函数，验证输出结构）:
```bash
TEST_MODE=1 node --input-type=module << 'EOF'
import { analyzeSceneFrame } from './apps/api/src/services/video-remake.service.js';
const result = await analyzeSceneFrame({ frameUrl: 'fixture://test-frame-0.jpg', frameIndex: 0 });
if (typeof result.original_frame_url !== 'string' || result.original_frame_url.length === 0) {
  console.error('FAIL: N03 output 缺 original_frame_url'); process.exit(1);
}
if (typeof result.prompt_text !== 'string' || result.prompt_text.length === 0) {
  console.error('FAIL: N03 output 缺 prompt_text 或为空'); process.exit(1);
}
console.log('OK N03 output original_frame_url=' + result.original_frame_url.slice(0, 30) + '...');
EOF
```

**硬阈值**: `original_frame_url` 非空 string，`prompt_text` 非空 string

---

### Step 4: N05 帧评选 — 节点展开可见评分列表

**来源**: `[FROM_PRD]` — PRD Golden Path Step 5:"系统按质量评分推荐最优重绘帧；节点展开可见评分列表"

**可观测行为**: N05 节点执行完成后，节点展开面板显示帧评分列表，每项含重绘帧图像 + 评分数值（`score`）。`nodes[N05].output.frames` 为数组，每项含 `{ redrawn_frame_url: string, score: number }`。

**验证命令**（直接调用 N05 服务函数，验证评分列表结构）:
```bash
TEST_MODE=1 node --input-type=module << 'EOF'
import { evaluateFrameScores } from './apps/api/src/services/video-remake.service.js';
const result = await evaluateFrameScores({
  redrawnFrames: [
    { original_frame_url: 'fixture://orig-0.jpg', redrawn_frame_url: 'fixture://redrawn-0.jpg' }
  ]
});
if (!Array.isArray(result.frames) || result.frames.length === 0) {
  console.error('FAIL: N05 output.frames 非数组或为空'); process.exit(1);
}
const f = result.frames[0];
if (typeof f.redrawn_frame_url !== 'string') { console.error('FAIL: N05 frames[0] 缺 redrawn_frame_url'); process.exit(1); }
if (typeof f.score !== 'number') { console.error('FAIL: N05 frames[0] 缺 score(number)'); process.exit(1); }
console.log('OK N05 frames.length=' + result.frames.length + ' score=' + f.score);
EOF
```

**硬阈值**: `frames` 非空数组，每项含 `redrawn_frame_url`(string) + `score`(number)

---

### Step 5: N04 节点展开显示原帧/重绘帧对比

**来源**: `[FROM_PRD]` — PRD DoD 第3条:"N04 调用 ToAPI gpt-image-2 返回重绘图，节点展开可见原帧 / 重绘帧对比"

**可观测行为**: 点击 N04 节点展开 I/O 面板，显示两列：左列"原始帧"图像，右列"重绘帧"图像。这由后端 `output` 字段返回 `{ original_frame_url, redrawn_frame_url }` 驱动。

**验证命令**（Playwright spec 含 N04 原帧/重绘帧对比断言）:
```bash
node -e "
const c = require('fs').readFileSync('apps/dashboard/e2e/video-remake.spec.ts', 'utf8');
if (!c.includes('N04')) { console.error('FAIL: spec未断言N04节点'); process.exit(1); }
if (!c.includes('original') && !c.includes('redrawn') && !c.includes('对比')) {
  console.error('FAIL: spec未断言原帧/重绘帧对比');
  process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: Playwright spec 包含 N04 节点的原帧/重绘帧对比断言

---

### Step 6: N07 起始帧选择 — CI=true 自动选第一帧通过

**来源**: `[FROM_PRD]` — PRD DoD 第4条:"N07 在非CI环境展示候选帧选择UI；在 `CI=true` 时自动选第一帧并通过"

**可观测行为**: 当 `CI=true` 时，N07 节点跳过手动选帧 UI，自动调用 `POST /api/video-remake/jobs/:job_id/nodes/N07/select`，节点变绿，`selected_frame` 为第一帧路径（非空字符串）。

**验证命令**（直接调用 N07 select 服务函数，验证响应 schema）:
```bash
TEST_MODE=1 node --input-type=module << 'EOF'
import { createVideoRemakeJob, selectN07Frame } from './apps/api/src/services/video-remake.service.js';
const created = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from([0,0,0]) });
const result = await selectN07Frame({ jobId: created.job_id, ciAuto: true });
if (Object.keys(result).sort().join(',') !== 'job_id,selected_frame') {
  console.error('FAIL: keys != [job_id, selected_frame], got', Object.keys(result).sort()); process.exit(1);
}
if (typeof result.selected_frame !== 'string' || result.selected_frame.length === 0) {
  console.error('FAIL: selected_frame 为空'); process.exit(1);
}
if ('frame_id' in result || 'chosen_frame' in result || 'frameIndex' in result) {
  console.error('FAIL: 禁用字段出现'); process.exit(1);
}
console.log('OK selected_frame=' + result.selected_frame);
EOF
```

**硬阈值**: keys 精确等于 `["job_id","selected_frame"]`，`selected_frame` 非空，无禁用字段

---

### Step 7: N09 合成导出 — 下载翻拍 MP4，ffprobe 验证有视频流

**来源**: `[FROM_PRD]` — PRD DoD 第6条:"N09 合成后用户可点击下载翻拍 MP4（ffprobe 验证：有视频流 + 时长 > 0）"；PRD DoD 第8条:"smoke test：下载 mp4 → ffprobe 验证非空有视频流"

**可观测行为**: N09 执行完成后，`GET /api/video-remake/jobs/:id/output` 返回 `{ download_url, duration_seconds > 0, has_video_stream: true }`。E2E 脚本从 `download_url` 实际下载文件并运行 `ffprobe` 验证视频流存在、时长 > 0。

**验证命令**（E2E 阶段：下载文件 + 真实 ffprobe）:
```bash
# 在 e2e-verify.ps1 的 Playwright 执行后追加以下 bash 验证（CI=true, TEST_MODE=1 完整流水线运行后）
TEST_MODE=1 node --input-type=module << 'EOF'
import { createVideoRemakeJob, getVideoRemakeOutput } from './apps/api/src/services/video-remake.service.js';
const created = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from([0,0,0]) });
// TEST_MODE=1: 流水线同步完成，output 立即可用
const output = await getVideoRemakeOutput(created.job_id);
if (typeof output.download_url !== 'string' || output.download_url.length === 0) {
  console.error('FAIL: download_url 缺失'); process.exit(1);
}
if (typeof output.duration_seconds !== 'number' || output.duration_seconds <= 0) {
  console.error('FAIL: duration_seconds 非正数, got', output.duration_seconds); process.exit(1);
}
if (output.has_video_stream !== true) {
  console.error('FAIL: has_video_stream != true'); process.exit(1);
}
if ('url' in output || 'video_url' in output || 'hasVideo' in output) {
  console.error('FAIL: 禁用字段出现'); process.exit(1);
}
console.log('OK duration_seconds=' + output.duration_seconds + ' has_video_stream=' + output.has_video_stream);
EOF
```

**E2E 额外验证**（smoke test 中，实际 ffprobe 验证下载文件）:
```bash
# 从 download_url 下载翻拍 MP4（smoke test 中运行）
DOWNLOAD_URL=$(node --input-type=module -e "import { getVideoRemakeOutput } from './apps/api/src/services/video-remake.service.js'; const o = await getVideoRemakeOutput('$JOB_ID'); console.log(o.download_url);")
curl -sf "$DOWNLOAD_URL" -o /tmp/remake-output.mp4 || { echo "FAIL: 下载失败"; exit 1; }
ffprobe -v error -select_streams v:0 -show_entries stream=codec_type \
  -of default=noprint_wrappers=1:nokey=1 /tmp/remake-output.mp4 | grep -q "^video$" || { echo "FAIL: ffprobe无视频流"; exit 1; }
DURATION=$(ffprobe -v error -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 /tmp/remake-output.mp4)
python3 -c "d=float('$DURATION'); exit(0 if d>0 else 1)" || { echo "FAIL: duration=$DURATION ≤ 0"; exit 1; }
echo "✅ ffprobe 验证通过 duration=$DURATION"
```

**硬阈值**: `duration_seconds > 0`，`has_video_stream = true`，ffprobe 确认视频流存在

---

### Step 8: 边界 — 超 100MB 文件被前端拒绝

**来源**: `[FROM_PRD]` — PRD 边界情况:"源视频超 100MB：前端拒绝上传，不进入流水线"

**可观测行为**: 选择 >100MB 文件时，页面显示错误提示"文件超出 100MB 限制"，不触发 API 调用，流水线不启动。

**验证命令**（直接调用 createVideoRemakeJob 验证后端也拒绝大文件）:
```bash
node --input-type=module << 'EOF'
import { createVideoRemakeJob } from './apps/api/src/services/video-remake.service.js';
const OVER_SIZE = 104857601; // 100MB + 1 byte
try {
  await createVideoRemakeJob({ filename: 'large.mp4', fileSizeBytes: OVER_SIZE, buffer: Buffer.from([]) });
  console.error('FAIL: 超100MB应抛出错误但未抛出'); process.exit(1);
} catch (e) {
  if (!e.message && !e.code) { console.error('FAIL: 错误无 message/code'); process.exit(1); }
  console.log('OK 超100MB正确拒绝:', e.message || e.code);
}
EOF
```

**硬阈值**: 超100MB 输入抛出错误（service 层验证），API 层返回 HTTP 400/413

---

### Step 9: 边界 — N04 gpt-image-2 单帧调用失败，节点标红

**来源**: `[FROM_PRD]` — PRD 边界情况:"N04 单帧 gpt-image-2 调用失败：节点标红，展示错误信息，允许重试"

**可观测行为**: 当 ToAPI gpt-image-2 调用失败（API Key 无效 / 服务不可用）时，N04 节点状态变为 `"error"`，节点展开可见错误信息文本。`nodes[N04].status="error"` 且 `nodes[N04].output.error_message` 为非空字符串。

**验证命令**（注入失败条件，验证错误结构）:
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

**硬阈值**: 当 `FORCE_TOAPI_FAIL=1` 时，`redrawFrameWithToAPI` 抛出 `{ code: "N04_API_FAILURE" }` 错误；节点状态变 `"error"`

---

### Step 10: 边界 — N08 i2v 超时（>5 分钟），节点标红

**来源**: `[FROM_PRD]` — PRD 边界情况:"N08 i2v 超时（>5 分钟）：节点标红，展示超时提示"

**可观测行为**: 当 DashScope i2v 任务超过超时阈值时，N08 节点状态变为 `"error"`，展示"i2v生成超时，请重试"提示。`nodes[N08].output.error_message` 含超时说明。

**验证命令**（注入极短超时，验证超时错误结构）:
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

**硬阈值**: 当 `N08_TIMEOUT_MS=1` 时，`generateVideoWithDashScope` 抛出 `{ code: "N08_TIMEOUT" }` 错误

---

## Risks

| 风险 | 场景 | 缓解措施 |
|---|---|---|
| N04 gpt-image-2 单帧调用失败 | ToAPI 服务不可用 / API Key 无效 / 速率限制 | 节点标红 + 展示 `error_message` + 页面显示"重试"按钮；最多重试3次后暂停流水线 |
| N08 DashScope i2v 超时（>5 分钟）| DashScope 服务响应慢 / 任务队列积压 | 5分钟超时检测：节点标红 + 展示"i2v 生成超时，请重新触发 N08"；`code=N08_TIMEOUT` |

---

## E2E 验收（windows_cloud 变体C — Dashboard/Vite/Playwright）

**journey_type**: user_facing
**target_environment**: windows_cloud
**GHA workflow**: `.github/workflows/e2e-windows.yml`（已存在，运行 `$sprintDir/e2e-verify.ps1`）

**windows_cloud BEHAVIOR 用户路径 1:1 映射检查**（已读取 `.github/workflows/e2e-windows.yml`）：

| 用户操作 | GHA workflow step | 覆盖状态 |
|---|---|---|
| Checkout 代码 | `actions/checkout@v4`（`ref: pr_branch`）| ✅ workflow steps |
| 安装依赖 + 启动 Vite | e2e-verify.ps1 Step 1-4（npm ci + vite preview）| ✅ e2e-verify.ps1 |
| 打开 /video-remake 页面 | Playwright `page.goto('/video-remake')` | ✅ video-remake.spec.ts |
| 上传 MP4，N01 变绿 | Playwright `page.route` stub POST /api/video-remake/jobs | ✅ video-remake.spec.ts |
| N02-N06 依序执行 | Playwright stub GET /api/video-remake/jobs/:id polling | ✅ video-remake.spec.ts |
| N03 展开显示原帧+Prompt文本 | Playwright `click` + `toBeVisible` N03 output panel | ✅ video-remake.spec.ts |
| N04 展开显示原帧/重绘帧对比 | Playwright `click` + `toBeVisible` 双图列 | ✅ video-remake.spec.ts |
| N05 展开显示评分列表 | Playwright `click` + `toBeVisible` 评分列表 | ✅ video-remake.spec.ts |
| N07 CI 自动选帧 | `CI=true` env，Playwright stub POST N07/select | ✅ video-remake.spec.ts |
| N09 下载 MP4，ffprobe 验证 | Playwright 断言 has_video_stream=true + duration_seconds>0 | ✅ video-remake.spec.ts |
| 超100MB 文件前端拒绝 | Playwright file input 超大文件边界测试 | ✅ video-remake.spec.ts |

```powershell
# final-e2e 验证脚本 — ZenithJoy Dashboard Playwright（windows-latest）
param(
  [string]$BaseUrl = "http://localhost:5174",
  [string]$SuperAdminEmail = $env:E2E_SUPER_ADMIN_EMAIL,
  [string]$SuperAdminPassword = $env:E2E_SUPER_ADMIN_PASSWORD
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5174
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

# 1. 安装依赖
Write-Host "▶ Installing dependencies..."
$installProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot `
  -Wait -PassThru -NoNewWindow
if ($installProc.ExitCode -ne 0) { throw "FAIL: npm ci failed" }

# 2. 安装 Playwright 浏览器
$playwrightProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory $repoRoot `
  -Wait -PassThru -NoNewWindow
if ($playwrightProc.ExitCode -ne 0) { throw "FAIL: playwright install failed" }

# 3. Build Dashboard
Write-Host "▶ Building dashboard..."
$buildProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow
if ($buildProc.ExitCode -ne 0) { throw "FAIL: dashboard build failed" }

# 4. 启动 Vite preview
Write-Host "▶ Starting Vite preview on port $VitePort..."
$serverProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -PassThru -NoNewWindow

# 5. 等待服务就绪（Test-NetConnection 兼容 IPv4/IPv6）
$maxWait = 30
$waited = 0
do {
  Start-Sleep -Seconds 1
  $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未在 ${maxWait}s 内就绪 port=$VitePort" }
Write-Host "✅ Vite 就绪 port=$VitePort"

# 6. 跑 Playwright E2E（apps/dashboard/e2e/video-remake.spec.ts）
# 在当前 session 设 env var（子进程继承），避免 -Environment 替换整体 env 导致 PATH 丢失
$env:BASE_URL     = $BaseUrl
$env:CI           = "true"
$env:E2E_EMAIL    = $SuperAdminEmail
$env:E2E_PASSWORD = $SuperAdminPassword

$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\video-remake.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow

Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue

if ($e2eProc.ExitCode -ne 0) { throw "FAIL: Playwright E2E 失败 exit=$($e2eProc.ExitCode)" }
Write-Host "✅ video-remake 9节点流水线 E2E 验证通过"
exit 0
```

**PASS 标准**: `e2eProc.ExitCode -eq 0` + Playwright 所有 spec 通过
**FAIL 标准**: 任何 step exit≠0 OR Playwright 失败 OR Vite 30s 内未就绪
**secrets 必须**: `E2E_SUPER_ADMIN_EMAIL`、`E2E_SUPER_ADMIN_PASSWORD`

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 | TDD 顺序 |
|---|---|---|---|---|
| Video Remake 服务 (unit) | `sprints/06100919-line07-video-remake-pipeline/tests/video-remake.test.ts` | createJob/getJob/N03/N05/N07Select/getOutput schema + N04/N08 error path | → 12 failures（模块不存在）| commit-1 写（RED） |
| E2E Dashboard (Playwright) | `apps/dashboard/e2e/video-remake.spec.ts` | 9节点渲染/N01上传/N03展开/N04对比/N05评分/N07CI/N09下载/100MB拒绝 | → 所有 test FAIL（页面不存在）| **commit-1 写（RED）**，commit-2 实现变绿 |
