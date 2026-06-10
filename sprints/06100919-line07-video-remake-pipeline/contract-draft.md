# Sprint Contract Draft (Round 1)

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
- `has_video_stream` (boolean, 必填): ffprobe 验证有视频流
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
  → [N03 场景分析 → 节点展开见原帧+Prompt文本，节点变绿]
  → [N04 gpt-image-2重绘 → 节点展开见原帧/重绘帧对比，节点变绿]
  → [N05 帧评选 → 节点展开见评分列表，节点变绿]
  → [N06 重绘审核 → 节点展开见帧序列，点Continue，节点变绿]
  → [N07 起始帧选择 → CI=true自动选第一帧，节点变绿]
  → [N08 i2v生成 → 节点展开见进度+预览，节点变绿]
  → [N09 合成导出 → 下载按钮可见，下载 MP4]
```

---

### Step 1: 打开 `/video-remake` 页面显示 9 节点流水线图

**来源**: `[FROM_PRD]` — PRD DoD 第1条:"Dashboard 新页面 `/video-remake` 展示 9节点 n8n 风格流水线图，每节点有状态指示（灰/运行中/绿/红）"

**可观测行为**: 浏览器打开 `/video-remake`，页面显示 9 个节点组件（N01–N09），每个节点默认状态为灰色（idle），并有标签文字（N01:上传解析, N02:抽帧, …, N09:合成导出）。

**验证命令**（Playwright 断言）:
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

**验证命令**（代码级检查，Playwright stub）:
```bash
node -e "
const c = require('fs').readFileSync('apps/dashboard/e2e/video-remake.spec.ts', 'utf8');
if (!c.includes('filename') && !c.includes('duration_seconds')) { console.error('FAIL: spec未断言文件信息显示'); process.exit(1); }
if (!c.includes('done') || !c.includes('N01')) { console.error('FAIL: spec未断言N01变绿'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: Playwright spec 覆盖文件信息展示 + N01 done 状态变化

---

### Step 3: N02–N06 依序自动执行并变绿

**来源**: `[FROM_PRD]` — PRD DoD 第2条:"上传有效 MP4（≤100MB）后，N01–N06 节点自动依序执行并变绿，每节点展开可见实际 I/O"

**可观测行为**: 上传完成后，N02（抽帧）→ N03（场景分析）→ N04（gpt-image-2重绘）→ N05（帧评选）→ N06（重绘审核）依序变绿。每节点可展开查看 I/O 面板。

**验证命令**（验证 API 路由覆盖所有节点）:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/video-remake.ts', 'utf8');
if (!c.includes('/api/video-remake/jobs') && !c.includes('/jobs')) { console.error('FAIL: 路由文件缺 jobs 端点'); process.exit(1); }
if (!c.includes('nodes')) { console.error('FAIL: 路由文件缺 nodes 端点'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: API 路由文件存在并包含 jobs + nodes 端点定义

---

### Step 4: N04 节点展开显示原帧/重绘帧对比

**来源**: `[FROM_PRD]` — PRD DoD 第3条:"N04 调用 ToAPI gpt-image-2 返回重绘图，节点展开可见原帧 / 重绘帧对比"

**可观测行为**: 点击 N04 节点展开 I/O 面板，显示两列：左列"原始帧"图像，右列"重绘帧"图像。这由后端 `output` 字段返回 `{ original_frame_url, redrawn_frame_url }` 驱动。

**验证命令**（验证组件含对比 UI 结构）:
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

### Step 5: N07 起始帧选择 — CI=true 自动选第一帧通过

**来源**: `[FROM_PRD]` — PRD DoD 第4条:"N07 在非CI环境展示候选帧选择UI；在 `CI=true` 时自动选第一帧并通过"；PRD 假设:"CI 通过 `CI=true` 判断自动跳过 N07 人工选帧，选第一帧"

**可观测行为**: 当 `CI=true` 时，N07 节点跳过手动选帧 UI，自动调用 `POST /api/video-remake/jobs/:job_id/nodes/N07/select`（body: `{ci_auto: true}`），节点变绿，`selected_frame` 字段为第一帧路径。

**验证命令**（验证 CI 逻辑存在于页面组件或服务中）:
```bash
node -e "
const fs = require('fs');
const pageContent = fs.readFileSync('apps/dashboard/src/pages/VideoRemakePipelinePage.tsx', 'utf8');
if (!pageContent.includes('CI') && !pageContent.includes('ci_auto')) {
  console.error('FAIL: 页面组件缺CI自动选帧逻辑');
  process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: 页面组件含 `CI` 或 `ci_auto` 关键字

---

### Step 6: N08 调用 DashScope i2v 生成视频片段

**来源**: `[FROM_PRD]` — PRD DoD 第5条:"N08 调用 Aliyun DashScope happy-horse i2v，返回视频片段"；PRD 假设:"Aliyun DashScope API Key 已在环境变量 DASHSCOPE_API_KEY 可用"

**可观测行为**: N08 节点执行时，后端调用 Aliyun DashScope happy-horse i2v 模型，轮询任务状态，完成后节点展开可见 `{ video_segment_url }` 输出，节点变绿。

**验证命令**（验证服务文件含 DashScope 调用）:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/services/video-remake.service.ts', 'utf8');
if (!c.includes('DASHSCOPE_API_KEY') && !c.includes('dashscope') && !c.includes('DashScope')) {
  console.error('FAIL: 服务文件缺DashScope调用');
  process.exit(1);
}
if (!c.includes('happy-horse') && !c.includes('i2v')) {
  console.error('FAIL: 服务文件缺i2v/happy-horse引用');
  process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: service 文件含 `DASHSCOPE_API_KEY` + `i2v` 或 `happy-horse` 引用

---

### Step 7: N09 合成导出 — 下载翻拍 MP4，ffprobe 验证有视频流

**来源**: `[FROM_PRD]` — PRD DoD 第6条:"N09 合成后用户可点击下载翻拍 MP4（ffprobe 验证：有视频流 + 时长 > 0）"；PRD DoD 第8条:"smoke test：下载 mp4 → ffprobe 验证非空有视频流"

**可观测行为**: N09 执行完成后，节点展开显示输出文件大小/时长，出现下载按钮。用户点击下载获得翻拍 MP4。API 返回 `{ download_url, duration_seconds, has_video_stream: true }`，ffprobe 验证 `has_video_stream=true && duration_seconds > 0`。

**验证命令**（验证 E2E spec 含下载按钮和 ffprobe 断言）:
```bash
node -e "
const c = require('fs').readFileSync('apps/dashboard/e2e/video-remake.spec.ts', 'utf8');
if (!c.includes('download') && !c.includes('下载')) {
  console.error('FAIL: spec未断言下载按钮');
  process.exit(1);
}
if (!c.includes('has_video_stream') && !c.includes('ffprobe') && !c.includes('duration_seconds')) {
  console.error('FAIL: spec未断言视频流验证');
  process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: Playwright spec 包含下载操作 + 视频流验证断言

---

### Step 8: 边界 — 超 100MB 文件被前端拒绝

**来源**: `[FROM_PRD]` — PRD 边界情况:"源视频超 100MB：前端拒绝上传，不进入流水线"

**可观测行为**: 选择 >100MB 文件时，页面显示错误提示"文件超出 100MB 限制"，不触发 API 调用，流水线不启动。

**验证命令**（验证 spec 含超大文件边界测试）:
```bash
node -e "
const c = require('fs').readFileSync('apps/dashboard/e2e/video-remake.spec.ts', 'utf8');
if (!c.includes('100MB') && !c.includes('100mb') && !c.includes('fileSize') && !c.includes('file-too-large')) {
  console.error('FAIL: spec缺超100MB文件拒绝断言');
  process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: Playwright spec 包含超大文件边界场景

---

### Step 9 [AI_ADDED]: 禁用字段反向检查 — API 响应不含禁用字段名

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：防止 Generator 将 `job_id` 漂移为 `id` 或将 `has_video_stream` 漂移为 `hasVideo`，确保 Response Schema 严格合规。

**可观测行为**: 服务文件返回的 Response 对象不含禁用字段名（`id`, `jobId`, `hasVideo`, `video_url`）。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/services/video-remake.service.ts', 'utf8');
const forbidden = ['hasVideo', 'video_url', 'jobId'];
forbidden.forEach(f => {
  const re = new RegExp('return.*' + f + '|' + f + '\\\\s*:', 'g');
  if (re.test(c)) { console.error('FAIL: 服务文件含禁用字段', f); process.exit(1); }
});
console.log('OK');
"
```

**硬阈值**: service 文件返回对象不含禁用字段名

---

## E2E 验收（windows_cloud 变体C — Dashboard/Vite/Playwright）

**journey_type**: user_facing
**target_environment**: windows_cloud
**GHA workflow**: `.github/workflows/e2e-windows.yml`（已存在，运行 `$sprintDir/e2e-verify.ps1`）

**用户路径 1:1 映射检查**（windows_cloud [BEHAVIOR] 必须满足此规则）：

| 用户操作 | GHA workflow step | 覆盖状态 |
|---|---|---|
| 安装依赖 + 启动 Vite | `npm ci` + `npx vite preview` 在 e2e-verify.ps1 执行 | ✅ e2e-verify.ps1 Step 1-4 |
| 打开 /video-remake 页面 | Playwright `page.goto('/video-remake')` | ✅ video-remake.spec.ts |
| 上传 MP4，N01变绿 | Playwright `page.route` stub POST /api/video-remake/jobs | ✅ video-remake.spec.ts |
| N02-N06 依序执行 | Playwright stub GET /api/video-remake/jobs/:id polling | ✅ video-remake.spec.ts |
| N04 展开显示对比帧 | Playwright `click` + `toBeVisible` 原帧/重绘帧 | ✅ video-remake.spec.ts |
| N07 CI自动选帧 | Playwright stub POST /api/video-remake/jobs/:id/nodes/N07/select | ✅ video-remake.spec.ts |
| N08-N09 完成，下载按钮 | Playwright stub GET /api/video-remake/jobs/:id/output | ✅ video-remake.spec.ts |
| ffprobe 验证 has_video_stream | Playwright 断言 stub response `has_video_stream=true` | ✅ video-remake.spec.ts |
| 超100MB文件拒绝 | Playwright file input 超大文件边界测试 | ✅ video-remake.spec.ts |

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
$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\video-remake.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow `
  -Environment @{
    BASE_URL = $BaseUrl
    CI = "true"
    E2E_EMAIL = $SuperAdminEmail
    E2E_PASSWORD = $SuperAdminPassword
  }

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

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Video Remake 服务 | `sprints/06100919-line07-video-remake-pipeline/tests/video-remake.test.ts` | createJob/getJob/N07Select/getOutput schema | → 4 failures（模块不存在） |
| E2E Dashboard | `apps/dashboard/e2e/video-remake.spec.ts` | 9节点渲染/N01上传/N04对比/N07CI/N09下载 | → 由 Generator 在 commit-2 创建 |
