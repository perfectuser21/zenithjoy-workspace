# Sprint Contract Draft (Round 1)

## Golden Path

[GHA 触发 workflow_dispatch] → [注入 KUAISHOU_COOKIES secret] → [image-dryrun 三模式执行 → 截图 kuaishou-image-*.png] → [video-dryrun 三模式执行 → API 拦截 + 截图 kuaishou-video-*.png] → [两 Job 均 exit 0，artifact 上传，CI 全绿]

---

### Step 1: handler type 路由 — 按 content.type 分发正确脚本，未知 type 显式抛错

**来源**: `[FROM_PRD]` — PRD "范围限定"段明确："`kuaishou-publish.ts` handler：`resolveKuaishouScriptPath()` + `ZENITHJOY_AGENT_REAL_PUBLISH` 开关 + `content.type` 路由 image/video（未知 type 显式抛错）"；"边界情况"段："`content.type` 为未知值（非 `image` / `video`）时 handler 必须显式抛错，禁止静默 fallback"

**可观测行为**: `resolveKuaishouScriptPath('image')` 返回含 `kuaishou-image-dryrun` 的路径；`resolveKuaishouScriptPath('video')` 返回含 `kuaishou-video-dryrun` 的路径；`resolveKuaishouScriptPath('unknown')` 抛出含 `no script for type` 的 Error

**验证命令**:
```bash
# 验证 handler 含 resolveKuaishouScriptPath + ZENITHJOY_AGENT_REAL_PUBLISH
node -e "
const c = require('fs').readFileSync('/workspace/services/agent/src/handlers/kuaishou-publish.ts', 'utf8');
if (!c.includes('resolveKuaishouScriptPath')) { console.error('FAIL: 缺 resolveKuaishouScriptPath'); process.exit(1); }
if (!c.includes('ZENITHJOY_AGENT_REAL_PUBLISH')) { console.error('FAIL: 缺 REAL_PUBLISH 开关'); process.exit(1); }
if (!c.includes('no script for type')) { console.error('FAIL: 缺未知 type 抛错'); process.exit(1); }
console.log('OK');
" || { echo "FAIL: handler 未实现 type 路由"; exit 1; }
```

**硬阈值**: 命令 exit 0，三个关键字符串全部存在（WS1 未实现时 `resolveKuaishouScriptPath` 不在旧文件 → 真红）

---

### Step 2: image-dryrun 三模式 — KUAISHOU_COOKIES cookie 注入首选 → profile dir → CDP 19223 兜底

**来源**: `[FROM_PRD]` — PRD "范围限定"段："`publish-kuaishou-image-dryrun.cjs`：加 KUAISHOU_COOKIES 注入模式（三模式首位）"；"边界情况"段："`KUAISHOU_COOKIES` 缺失时脚本降级 profile dir 模式，再降级 CDP（端口 **19223**）兜底"；"假设"段："[ASSUMPTION: KUAISHOU_COOKIES 格式与抖音一致（Playwright cookies JSON 数组），可直接用 `addCookies()` 注入]"

**可观测行为**: 脚本含三模式启动逻辑（KUAISHOU_COOKIES → addCookies → profile dir → CDP 19223）；CDP 端口硬编码 19223；截图命名含 `kuaishou-image-`

**验证命令**:
```bash
# 验证 image-dryrun 含 cookie 注入 + addCookies + 正确端口
node -e "
const c = require('fs').readFileSync('/workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs', 'utf8');
if (!c.includes('KUAISHOU_COOKIES')) { console.error('FAIL: 缺 KUAISHOU_COOKIES'); process.exit(1); }
if (!c.includes('addCookies')) { console.error('FAIL: 缺 addCookies'); process.exit(1); }
if (!c.includes('19223')) { console.error('FAIL: 缺 CDP 端口 19223'); process.exit(1); }
if (c.includes('19222')) { console.error('FAIL: 混用抖音端口 19222'); process.exit(1); }
console.log('OK');
" || { echo "FAIL: image-dryrun 三模式未实现"; exit 1; }
```

**硬阈值**: 旧文件不含 `addCookies` / `KUAISHOU_COOKIES` → 真红；命令 exit 0 表示三模式已实现且端口正确

---

### Step 3: video-dryrun 新建 — 三模式 + 视频 URL + `/rest/cp/works/` API 拦截

**来源**: `[FROM_PRD]` — PRD "范围限定"段："新建 `publish-kuaishou-video-dryrun.cjs`：三模式（cookie注入 / profile dir / CDP兜底）"；PRD "Golden Path 具体"第 3 条："video-dryrun：导航至 `https://cp.kuaishou.com/article/publish/video` → 拦截 `/rest/cp/works/` API（命中即 dryrun 失守）→ 截图 → exit 0"

**可观测行为**: 新文件存在；含视频发布 URL；含 `/rest/cp/works/` 拦截逻辑（命中即 fail）；含三模式启动；CDP 端口 19223；输出 `{ok:true,dryRun:true}`

**验证命令**:
```bash
# 验证 video-dryrun 文件存在且含 4 个核心逻辑
node -e "
const c = require('fs').readFileSync('/workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs', 'utf8');
if (!c.includes('article/publish/video')) { console.error('FAIL: 缺视频 URL'); process.exit(1); }
if (!c.includes('/rest/cp/works/')) { console.error('FAIL: 缺 API 拦截'); process.exit(1); }
if (!c.includes('KUAISHOU_COOKIES')) { console.error('FAIL: 缺 cookie 注入'); process.exit(1); }
if (!c.includes('19223')) { console.error('FAIL: 缺 CDP 端口 19223'); process.exit(1); }
if (c.includes('19222')) { console.error('FAIL: 混用抖音端口 19222'); process.exit(1); }
console.log('OK');
" || { echo "FAIL: video-dryrun 未实现"; exit 1; }
```

**硬阈值**: 文件不存在或缺任一关键逻辑 → exit 1 → 真红（WS3 完成前文件根本不存在）

---

### Step 4: GHA workflow — windows-latest + 两个 dryrun step + KUAISHOU_COOKIES secret + screenshot artifact

**来源**: `[FROM_PRD]` — PRD "范围限定"段："新建 `.github/workflows/kuaishou-e2e.yml`：windows-latest + KUAISHOU_COOKIES secret + 分别跑两个 dryrun + 上传截图 artifact"；"Golden Path"最终到达态："CI 上传截图 artifact，两个 job 全绿"

**可观测行为**: `kuaishou-e2e.yml` 存在；含 `windows-latest`；含 `KUAISHOU_COOKIES` secret 引用；含 image-dryrun 执行步骤；含 video-dryrun 执行步骤；含 `upload-artifact` 步骤

**验证命令**:
```bash
# 验证 GHA workflow 五项配置
node -e "
const c = require('fs').readFileSync('/workspace/.github/workflows/kuaishou-e2e.yml', 'utf8');
if (!c.includes('windows-latest')) { console.error('FAIL: 缺 windows-latest'); process.exit(1); }
if (!c.includes('KUAISHOU_COOKIES')) { console.error('FAIL: 缺 KUAISHOU_COOKIES secret'); process.exit(1); }
if (!c.includes('kuaishou-image-dryrun')) { console.error('FAIL: 缺 image-dryrun step'); process.exit(1); }
if (!c.includes('kuaishou-video-dryrun')) { console.error('FAIL: 缺 video-dryrun step'); process.exit(1); }
if (!c.includes('upload-artifact')) { console.error('FAIL: 缺 upload-artifact'); process.exit(1); }
console.log('OK');
" || { echo "FAIL: kuaishou-e2e.yml 未实现或配置不完整"; exit 1; }
```

**硬阈值**: 文件不存在 → exit 1 → 真红（WS4 完成前文件根本不存在）

---

### Step 5: CDP 端口隔离验证 — 快手 19223 ≠ 抖音 19222，两个 dryrun 脚本均不混用

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD"边界情况"明确"快手 CDP 端口 **19223**，区别于抖音 19222，禁止混用"；image-dryrun 旧文件已含 19223 但 cookie 注入新增代码可能不慎引入 19222；video-dryrun 是新文件，generator 可能复制抖音模板带入 19222。需单独断言防止 port 混用导致跨平台账号泄露。

**可观测行为**: `publish-kuaishou-image-dryrun.cjs` 和 `publish-kuaishou-video-dryrun.cjs` 均不含字符串 `19222`

**验证命令**:
```bash
# 两文件端口隔离验证（任一含 19222 即 FAIL）
for f in \
  /workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs \
  /workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs; do
  if grep -q "19222" "$f" 2>/dev/null; then
    echo "FAIL: $f 含抖音端口 19222（混用禁止）"; exit 1
  fi
done
echo OK
```

**硬阈值**: 两文件均无 `19222`；video-dryrun 不存在时 `grep` 返 exit 2 → 仍 FAIL → 依赖 Step 3 完成

---

### Step 6: GHA final-e2e — image/video 两个 dryrun 在 windows-latest 上均 exit 0 + 截图文件存在

**来源**: `[FROM_PRD]` — PRD E2E 验收段："`ls screenshots/kuaishou-image-*.png`" 和 "`ls screenshots/kuaishou-video-*.png`"；PRD "到达"态："两个 dryrun 均 PASS，截图 artifact 上传，CI 全绿"

**可观测行为**: 在 GHA windows-latest 环境中，两个脚本分别 exit 0，截图文件各至少 1 张

**验证命令** (final-e2e 在 GHA 跑，见下方 E2E 验收脚本):
```powershell
# 见 E2E 验收（windows_cloud 变体 B）段落
```

**硬阈值**: image-dryrun exit 0 + `kuaishou-image-*.png` 存在 ≥ 1 张；video-dryrun exit 0 + `kuaishou-video-*.png` 存在 ≥ 1 张

---

## E2E 验收（final-e2e — windows_cloud 变体 B：Playwright dryrun，GHA windows-latest）

**journey_type**: agent_remote
**target_environment**: windows_cloud

> 适用：sprint 目标是验证 `publish-kuaishou-image-dryrun.cjs` 和 `publish-kuaishou-video-dryrun.cjs` 在 GitHub Actions windows-latest 上执行，非安装包交付。
> GHA workflow：`.github/workflows/kuaishou-e2e.yml`（`workflow_dispatch` + `windows-latest`）

**E2E 验收步骤（写入 `sprints/e2e-verify.ps1`）**：

```powershell
# final-e2e 验证脚本 — 快手三模式 dryrun（windows-latest）
param(
  [string]$Platform = "kuaishou",
  [string]$QueueImageJson = "$env:GITHUB_WORKSPACE\queue-image.json",
  [string]$QueueVideoJson  = "$env:GITHUB_WORKSPACE\queue-video.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = $env:GITHUB_WORKSPACE
$agentDir = "$repoRoot\services\agent"
$screenshotDir = "$repoRoot\screenshots"

# 1. 安装依赖
Write-Host "▶ npm ci..."
Set-Location $agentDir
npm ci --prefer-offline 2>&1 | Select-Object -Last 5

Write-Host "▶ playwright install chromium..."
npx playwright install chromium --with-deps 2>&1 | Select-Object -Last 5

# 2. 创建截图目录
New-Item -ItemType Directory -Force -Path $screenshotDir | Out-Null

# 3. 创建 image 队列文件
@{
  title   = "快手图文 dryrun 验证 $(Get-Date -Format 'HH:mm')"
  content = "GHA E2E 自检"
  images  = @()
} | ConvertTo-Json | Out-File -FilePath $QueueImageJson -Encoding utf8

# 4. 执行 image-dryrun
Write-Host "▶ image-dryrun..."
$env:SCREENSHOT_DIR = $screenshotDir
$imgOut = node "$agentDir\publishers\kuaishou-publisher\publish-kuaishou-image-dryrun.cjs" $QueueImageJson 2>&1
$imgLastJson = ($imgOut | Where-Object { $_ -match '^\{' } | Select-Object -Last 1)
if (-not $imgLastJson) { Write-Error "FAIL: image-dryrun 无 JSON 输出"; exit 1 }
$imgResult = $imgLastJson | ConvertFrom-Json
if (-not $imgResult.ok -or -not $imgResult.dryRun) {
  Write-Error "FAIL: image-dryrun ok=$($imgResult.ok) dryRun=$($imgResult.dryRun)"
  exit 1
}

# 5. 验证 image 截图
$imgScreenshots = Get-ChildItem -Path $screenshotDir -Filter "kuaishou-image-*.png" -ErrorAction SilentlyContinue
if ($imgScreenshots.Count -eq 0) { Write-Error "FAIL: image-dryrun 无截图"; exit 1 }
Write-Host "✅ image-dryrun PASS screenshots=$($imgScreenshots.Count)"

# 6. 创建 video 队列文件
@{
  title      = "快手视频 dryrun 验证 $(Get-Date -Format 'HH:mm')"
  content    = "GHA E2E 自检"
  video_path = ""
} | ConvertTo-Json | Out-File -FilePath $QueueVideoJson -Encoding utf8

# 7. 执行 video-dryrun
Write-Host "▶ video-dryrun..."
$vidOut = node "$agentDir\publishers\kuaishou-publisher\publish-kuaishou-video-dryrun.cjs" $QueueVideoJson 2>&1
$vidLastJson = ($vidOut | Where-Object { $_ -match '^\{' } | Select-Object -Last 1)
if (-not $vidLastJson) { Write-Error "FAIL: video-dryrun 无 JSON 输出"; exit 1 }
$vidResult = $vidLastJson | ConvertFrom-Json
if (-not $vidResult.ok -or -not $vidResult.dryRun) {
  Write-Error "FAIL: video-dryrun ok=$($vidResult.ok) dryRun=$($vidResult.dryRun)"
  exit 1
}

# 8. 验证 video 截图
$vidScreenshots = Get-ChildItem -Path $screenshotDir -Filter "kuaishou-video-*.png" -ErrorAction SilentlyContinue
if ($vidScreenshots.Count -eq 0) { Write-Error "FAIL: video-dryrun 无截图"; exit 1 }
Write-Host "✅ video-dryrun PASS screenshots=$($vidScreenshots.Count)"

Write-Host "✅ 快手三模式 dryrun E2E 全通过 image=$($imgResult.ok) video=$($vidResult.ok)"
exit 0
```

**PASS 标准**：脚本 exit 0 + image/video 两个 JSON `ok:true, dryRun:true` + 截图文件各 ≥ 1 张
**FAIL 标准**：exit 1 OR `ok:false` OR 截图不存在 OR timeout 15min
**GHA workflow**：`.github/workflows/kuaishou-e2e.yml`（`workflow_dispatch` + `windows-latest`）
**secrets 必须**：`KUAISHOU_COOKIES`（PrepPRD 前置条件，人工在 GHA repo secrets 界面完成）

---

## Workstreams

workstream_count: 4

### Workstream 1: kuaishou-publish.ts handler 重写 + unit tests

**范围**: 重写 `kuaishou-publish.ts`，提取 `resolveKuaishouScriptPath(type, env)` 函数（type=image → image-dryrun/real，type=video → video-dryrun/real，未知 type 显式抛 Error）；加 `ZENITHJOY_AGENT_REAL_PUBLISH` 环境变量开关（默认 dryrun）；新建 `__tests__/kuaishou-publish.test.ts` 覆盖所有 type 路由路径
**大小**: M（~150 行，两文件）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/kuaishou-publish.test.ts`

---

### Workstream 2: publish-kuaishou-image-dryrun.cjs 三模式升级

**范围**: 现有 CDP-only 脚本加 KUAISHOU_COOKIES cookie injection 首选模式（`addCookies` Playwright API），profile dir 第二选（`userDataDir`），保留 CDP 19223 兜底；截图命名改为 `kuaishou-image-{timestamp}.png`；输出 JSON 末行 `{ok:true,dryRun:true}`
**大小**: M（~120 行改动）
**依赖**: Workstream 1 完成后

---

### Workstream 3: publish-kuaishou-video-dryrun.cjs 新建

**范围**: 新建视频 dryrun 脚本，三模式（KUAISHOU_COOKIES 注入 / profile dir / CDP 19223），导航 `https://cp.kuaishou.com/article/publish/video`，拦截 `/rest/cp/works/` POST/PUT（命中即抛 dryrun-失守 Error），截图命名 `kuaishou-video-{timestamp}.png`，stdout 末行 JSON `{ok:true,dryRun:true}`
**大小**: M（~140 行，新文件）
**依赖**: Workstream 2 完成后

---

### Workstream 4: .github/workflows/kuaishou-e2e.yml 新建

**范围**: 新建 GHA workflow，`workflow_dispatch` 触发，`windows-latest` runner，注入 `KUAISHOU_COOKIES` env（来自 repo secret），分两 step 跑 image-dryrun 和 video-dryrun，最终 `upload-artifact` 上传 `screenshots/`（`if: always()` 确保失败也保存截图）
**大小**: S（~80 行，新 YAML）
**依赖**: Workstream 3 完成后

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/kuaishou-publish.test.ts` | type 路由正确性 + 未知 type 抛错 + REAL_PUBLISH 开关 | WS1 → 4 failures（resolveKuaishouScriptPath 未导出）|
| WS2 | `tests/ws2/kuaishou-image-dryrun.test.ts` | 三模式启动逻辑 + CDP 端口 + 截图命名 | WS2 → 文件内容断言失败 |
| WS3 | `tests/ws3/kuaishou-video-dryrun.test.ts` | 文件存在 + 视频 URL + API 拦截 + 端口 | WS3 → 文件不存在 |
| WS4 | `tests/ws4/kuaishou-e2e-workflow.test.ts` | workflow YAML 五项配置 | WS4 → 文件不存在 |
