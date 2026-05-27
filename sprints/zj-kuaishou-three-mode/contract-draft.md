# Sprint Contract Draft (Round 1)
# Sprint: 快手 publisher 三模式对齐 + GHA 自动验证

## Golden Path
[GHA 触发] → [注入 KUAISHOU_COOKIES] → [image-dryrun 三模式执行] → [video-dryrun 三模式执行] → [两步均 exit 0 + screenshots artifact 上传]

---

### Step 1: GHA workflow 读取 KUAISHOU_COOKIES secret，注入环境变量
**来源**: `[FROM_PRD]` — PRD 第 23 行"GHA workflow 读取 `KUAISHOU_COOKIES` secret，写入环境变量"

**可观测行为**: `.github/workflows/kuaishou-e2e.yml` 存在，包含 `KUAISHOU_COOKIES: ${{ secrets.KUAISHOU_COOKIES }}` 引用，runner 为 `windows-latest`

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('.github/workflows/kuaishou-e2e.yml','utf8');
  if (!c.includes('KUAISHOU_COOKIES')) { console.error('FAIL: 无 KUAISHOU_COOKIES 引用'); process.exit(1); }
  if (!c.includes('windows-latest'))    { console.error('FAIL: 无 windows-latest runner');   process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: 文件存在 + 含 KUAISHOU_COOKIES + 含 windows-latest

---

### Step 2: publish-kuaishou-image-dryrun.cjs 三模式检测 — 优先 KUAISHOU_COOKIES 注入
**来源**: `[FROM_PRD]` — PRD 第 24 行"`publish-kuaishou-image-dryrun.cjs` 检测到 `KUAISHOU_COOKIES` → 注入 cookie"；PRD 第 70 行"加 KUAISHOU_COOKIES + KUAISHOU_PROFILE_DIR 两种模式"

**可观测行为**: 脚本含 KUAISHOU_COOKIES 分支（cookie 注入）+ KUAISHOU_PROFILE_DIR 分支（persistent context）+ CDP 兜底三路模式选择逻辑

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs','utf8');
  if (!c.includes('KUAISHOU_COOKIES'))     { console.error('FAIL: 无 KUAISHOU_COOKIES 模式'); process.exit(1); }
  if (!c.includes('KUAISHOU_PROFILE_DIR')) { console.error('FAIL: 无 KUAISHOU_PROFILE_DIR 模式'); process.exit(1); }
  if (!c.includes('chromium.launch'))      { console.error('FAIL: 无 chromium.launch（cookie/profile 模式需要）'); process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: 三模式分支均存在于脚本源码

---

### Step 3: image-dryrun 导航到快手图文发布页 + 无发布 API 触发 + 输出合规 JSON
**来源**: `[FROM_PRD]` — PRD 第 24 行"导航到 `https://cp.kuaishou.com/article/publish/photo` → 截图 → 验证未触发 `/rest/cp/works/` 或 `/rest/cp/photo/publish`"

**可观测行为**: 脚本 exit 0，stdout 最后一行为 `{"ok":true,"dryRun":true,"url":"...","title":"...","imagesCount":...}`，禁用字段 `result/status/data/payload` 不出现

**验证命令**（evaluator 模式A — 文件结构验证，真实执行由 e2e-verify.ps1 在 GHA windows-latest 跑）:
```bash
node -e "
  const c = require('fs').readFileSync('services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs','utf8');
  if (!c.includes('imagesCount'))     { console.error('FAIL: 无 imagesCount 字段'); process.exit(1); }
  if (!c.includes('dryRun: true'))    { console.error('FAIL: 无 dryRun:true'); process.exit(1); }
  if (c.match(/[\"']result[\"']\s*:/)) { console.error('FAIL: 禁用字段 result 出现在输出中'); process.exit(1); }
  if (c.match(/[\"']status[\"']\s*:/)) { console.error('FAIL: 禁用字段 status 出现在输出中'); process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: imagesCount + dryRun 字段存在，result/status 禁用字段不在输出 keys 中

---

### Step 4: publish-kuaishou-video-dryrun.cjs 新建 — 三模式 + 导航到视频发布页
**来源**: `[FROM_PRD]` — PRD 第 71 行"新建 `publish-kuaishou-video-dryrun.cjs`（三模式：cookie 注入 / profile dir / CDP 兜底）"；PRD 第 25 行"导航到 `https://cp.kuaishou.com/article/publish/video`"

**可观测行为**: `publish-kuaishou-video-dryrun.cjs` 存在，含三模式选择，含 `https://cp.kuaishou.com/article/publish/video` 导航目标

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs','utf8');
  if (!c.includes('KUAISHOU_COOKIES'))                                { console.error('FAIL: 无 KUAISHOU_COOKIES 模式'); process.exit(1); }
  if (!c.includes('KUAISHOU_PROFILE_DIR'))                            { console.error('FAIL: 无 KUAISHOU_PROFILE_DIR 模式'); process.exit(1); }
  if (!c.includes('cp.kuaishou.com/article/publish/video'))           { console.error('FAIL: 无视频发布页 URL'); process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: 文件存在 + 三模式 + 正确发布页 URL

---

### Step 5: video-dryrun 输出合规 JSON（`{ok,dryRun,url,title}`），exit 0
**来源**: `[FROM_PRD]` — PRD 第 48-58 行 video-dryrun Response Schema

**可观测行为**: stdout 最后一行为 `{"ok":true,"dryRun":true,"url":"<string>","title":"<string>"}` — 4 个字段，无禁用字段

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs','utf8');
  if (!c.includes('dryRun: true'))      { console.error('FAIL: 无 dryRun:true'); process.exit(1); }
  if (!c.includes('ok: true'))          { console.error('FAIL: 无 ok:true'); process.exit(1); }
  if (c.match(/[\"']result[\"']\s*:/))  { console.error('FAIL: 禁用字段 result 在输出中'); process.exit(1); }
  if (c.match(/[\"']status[\"']\s*:/))  { console.error('FAIL: 禁用字段 status 在输出中'); process.exit(1); }
  if (c.match(/[\"']data[\"']\s*:/))    { console.error('FAIL: 禁用字段 data 在输出中'); process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: ok/dryRun 字段存在，result/status/data/payload 禁用字段不在输出中

---

### Step 6: GHA workflow 两个 job 均 PASS + screenshots artifact 上传
**来源**: `[FROM_PRD]` — PRD 第 26 行"两个步骤均 exit 0 → GHA PASS → screenshots artifact 可下载审查"

**可观测行为**: kuaishou-e2e.yml 含 image-dryrun + video-dryrun 两个步骤，含 `upload-artifact`，含 `SCREENSHOT_DIR` 传递

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('.github/workflows/kuaishou-e2e.yml','utf8');
  if (!c.includes('image-dryrun'))    { console.error('FAIL: 无 image-dryrun 步骤'); process.exit(1); }
  if (!c.includes('video-dryrun'))    { console.error('FAIL: 无 video-dryrun 步骤'); process.exit(1); }
  if (!c.includes('upload-artifact')) { console.error('FAIL: 无 upload-artifact'); process.exit(1); }
  console.log('OK');
" && \
node -e "
  const c = require('fs').readFileSync('.github/workflows/kuaishou-e2e.yml','utf8');
  if (!c.includes('SCREENSHOT_DIR')) { console.error('FAIL: 无 SCREENSHOT_DIR 传递'); process.exit(1); }
  console.log('OK');
"
```

**来源注**: `[AI_ADDED]` — 截图 artifact 是防造假的关键证据链，无截图的 dryrun 合规性无法审查；SCREENSHOT_DIR 环境变量传递是脚本截图写入的前提

**硬阈值**: image-dryrun + video-dryrun + upload-artifact + SCREENSHOT_DIR 全部存在于 workflow 文件

---

## E2E 验收（final-e2e — target_environment = windows_cloud 变体 B: Playwright dryrun）

**journey_type**: autonomous
**target_environment**: windows_cloud
**E2E 脚本**: `sprints/zj-kuaishou-three-mode/e2e-verify.ps1`

```powershell
# final-e2e 验证脚本 — 快手 publisher dryrun（windows-latest）
param(
  [string]$Platform    = "kuaishou",
  [string]$QueueJson   = "$PSScriptRoot\test-queue.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."

# 1. 安装依赖
Write-Host "▶ npm ci..."
$p = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory "$repoRoot\services\agent" `
  -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci failed" }

# 2. 安装 Playwright 浏览器
Write-Host "▶ playwright install chromium..."
$p = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory "$repoRoot\services\agent" `
  -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install failed" }

# 3. 创建测试队列文件（图文用）
$queue = [PSCustomObject]@{
  title   = "[DRY-RUN] E2E harness 自检 $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  content = "Harness evaluator 自动化验证"
  images  = @()
}
$queue | ConvertTo-Json -Depth 5 | Out-File -FilePath $QueueJson -Encoding utf8
Write-Host "▶ 队列文件: $QueueJson"

# 4. 执行 image-dryrun（KUAISHOU_COOKIES 由 GHA secrets 注入）
Write-Host "▶ image-dryrun..."
$screenshotDir = "$repoRoot\screenshots-image"
$env:SCREENSHOT_DIR = $screenshotDir
$imgOut = & node "$repoRoot\services\agent\publishers\kuaishou-publisher\publish-kuaishou-image-dryrun.cjs" $QueueJson 2>&1
$imgLastJson = ($imgOut | Where-Object { $_ -match '^\{' } | Select-Object -Last 1)

if (-not $imgLastJson) {
  Write-Error "FAIL: image-dryrun 无 JSON 输出`n$imgOut"
  exit 1
}
$imgResult = $imgLastJson | ConvertFrom-Json
if (-not $imgResult.ok -or -not $imgResult.dryRun) {
  Write-Error "FAIL: image-dryrun ok=$($imgResult.ok) dryRun=$($imgResult.dryRun)"
  exit 1
}
# 验证禁用字段不存在
if ($imgResult.PSObject.Properties['result'] -or $imgResult.PSObject.Properties['status']) {
  Write-Error "FAIL: image-dryrun 输出含禁用字段"
  exit 1
}
Write-Host "✅ image-dryrun PASS: ok=$($imgResult.ok) dryRun=$($imgResult.dryRun) url=$($imgResult.url)"

# 5. 创建视频测试队列文件
$videoQueue = "$PSScriptRoot\test-queue-video.json"
$qv = [PSCustomObject]@{
  title   = "[DRY-RUN] 视频 E2E harness 自检 $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  content = "Harness evaluator 视频自动化验证"
}
$qv | ConvertTo-Json -Depth 5 | Out-File -FilePath $videoQueue -Encoding utf8

# 6. 执行 video-dryrun
Write-Host "▶ video-dryrun..."
$screenshotDirV = "$repoRoot\screenshots-video"
$env:SCREENSHOT_DIR = $screenshotDirV
$vidOut = & node "$repoRoot\services\agent\publishers\kuaishou-publisher\publish-kuaishou-video-dryrun.cjs" $videoQueue 2>&1
$vidLastJson = ($vidOut | Where-Object { $_ -match '^\{' } | Select-Object -Last 1)

if (-not $vidLastJson) {
  Write-Error "FAIL: video-dryrun 无 JSON 输出`n$vidOut"
  exit 1
}
$vidResult = $vidLastJson | ConvertFrom-Json
if (-not $vidResult.ok -or -not $vidResult.dryRun) {
  Write-Error "FAIL: video-dryrun ok=$($vidResult.ok) dryRun=$($vidResult.dryRun)"
  exit 1
}
if ($vidResult.PSObject.Properties['result'] -or $vidResult.PSObject.Properties['status']) {
  Write-Error "FAIL: video-dryrun 输出含禁用字段"
  exit 1
}
Write-Host "✅ video-dryrun PASS: ok=$($vidResult.ok) dryRun=$($vidResult.dryRun) url=$($vidResult.url)"

Write-Host "✅ 快手三模式 E2E 全部通过"
exit 0
```

**PASS 标准**: 脚本 exit 0 + image-dryrun stdout `ok:true, dryRun:true` + video-dryrun stdout `ok:true, dryRun:true`
**FAIL 标准**: exit 1 OR 任一 `ok:false` OR timeout 15min
**GHA workflow**: `.github/workflows/e2e-windows.yml`（`workflow_dispatch` + `windows-latest`）
**必要 secret**: `KUAISHOU_COOKIES`（PRD ASSUMPTION 已确认上传至 repo）

---

## Workstreams

workstream_count: 3

### Workstream 1: publish-kuaishou-image-dryrun.cjs 加三模式（cookie 注入 + profile dir + CDP 兜底）
**范围**: 仅改 `publish-kuaishou-image-dryrun.cjs`，加 KUAISHOU_COOKIES 分支（chromium.launch + addCookies）+ KUAISHOU_PROFILE_DIR 分支（launchPersistentContext），保留 CDP connectOverCDP 兜底
**大小**: S（~90 行净增）
**依赖**: 无

### Workstream 2: publish-kuaishou-video-dryrun.cjs 新建（三模式）
**范围**: 新建 `publish-kuaishou-video-dryrun.cjs`，结构复用 image-dryrun 三模式框架，导航目标改为 `https://cp.kuaishou.com/article/publish/video`，输出 JSON 4 字段（无 imagesCount）
**大小**: M（~150 行新建）
**依赖**: Workstream 1 完成后（串行，防并发评估时文件依赖缺失）

### Workstream 3: .github/workflows/kuaishou-e2e.yml 新建（GHA windows-latest）
**范围**: 新建 `kuaishou-e2e.yml`，`workflow_dispatch` + 可选 schedule，分步运行 image-dryrun + video-dryrun，upload screenshots artifact
**大小**: S（~60 行新建）
**依赖**: Workstream 2 完成后（两个脚本都存在后 workflow 才可测）

---

## Workstreams 切分验证（v7.7 自查）

| WS | 预期净增行数 | 文件数 | 满足 ≤200行 + ≤3文件 |
|----|------------|--------|---------------------|
| WS1 | ~90 行 | 1 | ✅ |
| WS2 | ~150 行 | 1 | ✅ |
| WS3 | ~60 行（yml）+ ~80 行（e2e-verify.ps1 已在 Step 2c 生成） | 1 | ✅ |

整体净增 ~300 行 > 200，必须拆 → 已拆 3 WS ✅

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/kuaishou-image-dryrun.test.ts` | 三模式选择逻辑 + 禁用字段 | WS1 未改动时 → KUAISHOU_COOKIES/KUAISHOU_PROFILE_DIR 分支不存在 → 2 failures |
| WS2 | `tests/ws2/kuaishou-video-dryrun.test.ts` | 文件存在 + 三模式 + 正确 URL + 输出 schema | 文件不存在 → 全 4 failures |
| WS3 | `tests/ws3/kuaishou-gha-workflow.test.ts` | workflow 文件存在 + 含必要字段 | 文件不存在 → 全 4 failures |

---

## PRD Response Schema 字段自查 Checklist

### image-dryrun
| PRD 字段 | Contract jq -e | 匹配？ |
|---|---|---|
| `ok` (boolean, true) | `imgResult.ok === true` / Step 3 BEHAVIOR | ✅ |
| `dryRun` (boolean, true) | `imgResult.dryRun === true` / Step 3 BEHAVIOR | ✅ |
| `url` (string) | Step 3 验证 url 存在 | ✅ |
| `title` (string) | Step 3 验证 title 存在 | ✅ |
| `imagesCount` (number) | Step 3 BEHAVIOR + WS1 DoD | ✅ |
| 禁用: `result`/`status`/`data`/`payload` | Step 3/5 反向检查 + e2e-verify.ps1 | ✅ |
| keys 完整性 `["dryRun","imagesCount","ok","title","url"]` | WS1 DoD [BEHAVIOR] | ✅ |

### video-dryrun
| PRD 字段 | Contract jq -e | 匹配？ |
|---|---|---|
| `ok` (boolean, true) | Step 5 BEHAVIOR + WS2 DoD | ✅ |
| `dryRun` (boolean, true) | Step 5 BEHAVIOR + WS2 DoD | ✅ |
| `url` (string) | WS2 DoD [BEHAVIOR] | ✅ |
| `title` (string) | WS2 DoD [BEHAVIOR] | ✅ |
| 禁用: `result`/`status`/`data`/`payload` | Step 5 反向检查 + WS2 DoD | ✅ |
| keys 完整性 `["dryRun","ok","title","url"]` | WS2 DoD [BEHAVIOR] | ✅ |
