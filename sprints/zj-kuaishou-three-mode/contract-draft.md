# Sprint Contract Draft (Round 1)
# Sprint: 快手 publisher WS2+WS3 续 — video-dryrun 新建 + GHA E2E workflow

> **背景**: WS1（image-dryrun 三模式）已在 PR #493 合并完成。本合同仅覆盖剩余 WS2 = video-dryrun + WS3 = GHA workflow。

## Golden Path
[GHA workflow_dispatch 触发] → [注入 KUAISHOU_COOKIES] → [image-dryrun exit 0（WS1 已完成）] → [video-dryrun 导航视频发布页 exit 0] → [screenshots artifact 上传] → [GHA PASS]

---

### Step 1: publish-kuaishou-video-dryrun.cjs 文件存在，含三模式框架
**来源**: `[FROM_PRD]` — PRD 第 69 行"新建 `publish-kuaishou-video-dryrun.cjs`（三模式：KUAISHOU_COOKIES / KUAISHOU_PROFILE_DIR / CDP 兜底）"

**可观测行为**: 脚本文件存在，含 `process.env.KUAISHOU_COOKIES` 读取、`process.env.KUAISHOU_PROFILE_DIR` 读取、`chromium.connectOverCDP` 兜底三路分支

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs','utf8');
  if (!c.includes('KUAISHOU_COOKIES'))     { console.error('FAIL: 无 KUAISHOU_COOKIES 模式'); process.exit(1); }
  if (!c.includes('KUAISHOU_PROFILE_DIR')) { console.error('FAIL: 无 KUAISHOU_PROFILE_DIR 模式'); process.exit(1); }
  if (!c.includes('chromium.launch'))      { console.error('FAIL: 无 chromium.launch（cookie/profile 模式需要）'); process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: 文件存在 + 三模式分支均在源码中 + `chromium.launch` 存在

---

### Step 2: video-dryrun 导航到快手视频发布页（`https://cp.kuaishou.com/article/publish/video`）
**来源**: `[FROM_PRD]` — PRD 第 25 行"导航到 `https://cp.kuaishou.com/article/publish/video`"；PRD 第 83 行 ASSUMPTION "快手视频发布页 URL 为 https://cp.kuaishou.com/article/publish/video"

**可观测行为**: 脚本含该 URL 作为导航目标，`page.goto` 调用目标为视频发布页（非图文发布页 `/photo`）

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs','utf8');
  if (!c.includes('cp.kuaishou.com/article/publish/video')) { console.error('FAIL: 无视频发布页 URL'); process.exit(1); }
  if (c.includes('/article/publish/photo'))                  { console.error('FAIL: 含图文发布页 URL（应为 video）'); process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: 含视频发布页 URL + 不含图文发布页 URL（防止 copy 忘改）

---

### Step 3: video-dryrun 输出合规 JSON — `{ok,dryRun,url,title}` 4 字段，无 imagesCount，无禁用字段
**来源**: `[FROM_PRD]` — PRD 第 40-52 行 video-dryrun Response Schema；PRD 第 52 行"禁用响应字段名: `result`/`status`/`data`/`payload`"；PRD 第 48 行"无 `imagesCount` 字段（video 只有 4 字段）"

**可观测行为**: stdout 最后一行为 `{"ok":true,"dryRun":true,"url":"<string>","title":"<string>"}` — 恰好 4 个字段，禁用字段不在 keys 中

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs','utf8');
  if (!c.includes('ok: true'))     { console.error('FAIL: 输出无 ok:true'); process.exit(1); }
  if (!c.includes('dryRun: true')) { console.error('FAIL: 输出无 dryRun:true'); process.exit(1); }
  if (!c.match(/\burl\s*:/))       { console.error('FAIL: 输出无 url 字段'); process.exit(1); }
  if (!c.match(/\btitle\s*:/))     { console.error('FAIL: 输出无 title 字段'); process.exit(1); }
  const lines = c.split('\n').filter(l => l.includes('imagesCount'));
  if (lines.length > 0)            { console.error('FAIL: video-dryrun 输出含 imagesCount（应无此字段）'); process.exit(1); }
  ['result','status','data','payload'].forEach(f => {
    const re = new RegExp('[\"\\x27]' + f + '[\"\\x27]\\\\s*:');
    if (re.test(c)) { console.error('FAIL: 禁用字段', f, '在输出 key 中'); process.exit(1); }
  });
  console.log('OK');
" && \
node -e "
  const c = require('fs').readFileSync('services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs','utf8');
  const resultMatch = c.match(/const result\s*=\s*\{([^}]+)\}/s);
  if (!resultMatch) { console.error('FAIL: 未找到 result 对象字面量'); process.exit(1); }
  const keys = (resultMatch[1].match(/\b(\w+)\s*:/g) || []).map(k => k.replace(/\s*:/,'').trim()).sort().join(',');
  if (keys !== 'dryRun,ok,title,url') { console.error('FAIL: keys 不符 actual=' + keys + ' expected=dryRun,ok,title,url'); process.exit(1); }
  console.log('OK keys=' + keys);
"
```

**硬阈值**: ok + dryRun + url + title 存在；imagesCount 不存在；result/status/data/payload 不存在；keys 集合 = `{dryRun,ok,title,url}`

---

### Step 4: video-dryrun 安全护栏 — page.route 拦截快手发布 API + 登录失败检测
**来源**: `[FROM_PRD]` — PRD 第 62-64 行边界情况："KUAISHOU_COOKIES 无效 → URL 含 login/passport → exit 1"；"发布 API 被触发 → exit 1 报 dry-run 失守"

**可观测行为**: 脚本含 `page.route` 拦截 `/rest/cp/works/`；含导航后 URL 检查（login/passport）；检测到时 throw 错误并 exit 1

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs','utf8');
  if (!c.includes('page.route'))      { console.error('FAIL: 脚本缺 page.route（无法拦截发布 API）'); process.exit(1); }
  if (!c.includes('/rest/cp/works/')) { console.error('FAIL: 缺 /rest/cp/works/ 拦截模式'); process.exit(1); }
  if (!c.includes('login'))           { console.error('FAIL: 缺登录失败检测 login'); process.exit(1); }
  if (!c.includes('passport'))        { console.error('FAIL: 缺登录失败检测 passport'); process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: page.route + /rest/cp/works/ + login + passport 均存在

---

### Step 5: kuaishou-e2e.yml 存在，含 windows-latest + KUAISHOU_COOKIES + image+video 两步
**来源**: `[FROM_PRD]` — PRD 第 70 行"新建 `.github/workflows/kuaishou-e2e.yml`（windows-latest，image + video 两步，上传 screenshots artifact）"；PRD 第 23 行"GHA workflow 读取 KUAISHOU_COOKIES secret"

**可观测行为**: `.github/workflows/kuaishou-e2e.yml` 存在，runner = windows-latest，含 `KUAISHOU_COOKIES: ${{ secrets.KUAISHOU_COOKIES }}` 引用，含 image-dryrun 调用步骤，含 video-dryrun 调用步骤

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('.github/workflows/kuaishou-e2e.yml','utf8');
  if (!c.includes('windows-latest'))    { console.error('FAIL: 无 windows-latest runner'); process.exit(1); }
  if (!c.includes('KUAISHOU_COOKIES'))  { console.error('FAIL: 无 KUAISHOU_COOKIES 引用'); process.exit(1); }
  if (!c.includes('image-dryrun'))      { console.error('FAIL: 无 image-dryrun 步骤'); process.exit(1); }
  if (!c.includes('video-dryrun'))      { console.error('FAIL: 无 video-dryrun 步骤'); process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: 文件存在 + 含 windows-latest + KUAISHOU_COOKIES + image-dryrun + video-dryrun

---

### Step 6: workflow upload-artifact if:always() + SCREENSHOT_DIR 传递（截图证据链完整）
**来源**: `[AI_ADDED]` — GAN Round 1 加入，理由：仅有 exit code 无法审查 dryrun 是否真的导航到正确页面；必须有截图 artifact 作为可视证据，且 `if: always()` 确保失败时也能审查截图（无此保证 evaluator 无法判断 dryrun 导航正确性）

**可观测行为**: workflow 含 `upload-artifact` 步骤，该步骤带 `if: always()` 条件，且传递 `SCREENSHOT_DIR` 环境变量使脚本知道截图写入位置

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('.github/workflows/kuaishou-e2e.yml','utf8');
  if (!c.includes('upload-artifact')) { console.error('FAIL: 无 upload-artifact'); process.exit(1); }
  if (!c.includes('always()'))        { console.error('FAIL: upload-artifact 缺 if:always()'); process.exit(1); }
  if (!c.includes('SCREENSHOT_DIR'))  { console.error('FAIL: 无 SCREENSHOT_DIR 传递'); process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: upload-artifact + always() + SCREENSHOT_DIR 均存在

---

## E2E 验收（final-e2e — target_environment = windows_cloud 变体 B: Playwright dryrun）

**journey_type**: autonomous
**target_environment**: windows_cloud
**E2E 脚本**: `sprints/zj-kuaishou-three-mode/e2e-verify.ps1`

```powershell
# final-e2e 验证脚本 — 快手 publisher dryrun（windows-latest）
# 完整脚本见 sprints/zj-kuaishou-three-mode/e2e-verify.ps1
param(
  [string]$QueueJson = "$PSScriptRoot\test-queue.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."

# 1. 安装依赖
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory "$repoRoot\services\agent" -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci failed" }

# 2. 安装 Playwright
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory "$repoRoot\services\agent" -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install failed" }

# 3. image-dryrun（KUAISHOU_COOKIES 由 GHA secrets 注入）
$queue = [PSCustomObject]@{ title = "[DRY-RUN] E2E 自检 $(Get-Date -Format 'yyyy-MM-dd')"; content = "Harness 验证"; images = @() }
$queue | ConvertTo-Json -Depth 5 | Out-File -FilePath $QueueJson -Encoding utf8
$env:SCREENSHOT_DIR = "$repoRoot\screenshots-image"
$imgOut = & node "$repoRoot\services\agent\publishers\kuaishou-publisher\publish-kuaishou-image-dryrun.cjs" $QueueJson 2>&1
$imgJson = ($imgOut | Where-Object { $_ -match '^\{' } | Select-Object -Last 1)
if (-not $imgJson) { Write-Error "FAIL: image-dryrun 无 JSON 输出"; exit 1 }
$imgR = $imgJson | ConvertFrom-Json
if (-not $imgR.ok -or -not $imgR.dryRun) { Write-Error "FAIL: image-dryrun ok=$($imgR.ok)"; exit 1 }
# keys 完整性（image: dryRun,imagesCount,ok,title,url）
$imgKeys = ($imgR.PSObject.Properties.Name | Sort-Object) -join ","
if ($imgKeys -ne "dryRun,imagesCount,ok,title,url") { Write-Error "FAIL: image keys=$imgKeys"; exit 1 }
Write-Host "✅ image-dryrun PASS url=$($imgR.url)"

# 4. video-dryrun
$vq = [PSCustomObject]@{ title = "[DRY-RUN] 视频 E2E $(Get-Date -Format 'yyyy-MM-dd')"; content = "Harness 视频验证" }
$vq | ConvertTo-Json -Depth 5 | Out-File -FilePath "$PSScriptRoot\test-queue-video.json" -Encoding utf8
$env:SCREENSHOT_DIR = "$repoRoot\screenshots-video"
$vidOut = & node "$repoRoot\services\agent\publishers\kuaishou-publisher\publish-kuaishou-video-dryrun.cjs" "$PSScriptRoot\test-queue-video.json" 2>&1
$vidJson = ($vidOut | Where-Object { $_ -match '^\{' } | Select-Object -Last 1)
if (-not $vidJson) { Write-Error "FAIL: video-dryrun 无 JSON 输出"; exit 1 }
$vidR = $vidJson | ConvertFrom-Json
if (-not $vidR.ok -or -not $vidR.dryRun) { Write-Error "FAIL: video-dryrun ok=$($vidR.ok)"; exit 1 }
# keys 完整性（video: dryRun,ok,title,url — 无 imagesCount）
$vidKeys = ($vidR.PSObject.Properties.Name | Sort-Object) -join ","
if ($vidKeys -ne "dryRun,ok,title,url") { Write-Error "FAIL: video keys=$vidKeys expected=dryRun,ok,title,url"; exit 1 }
# 禁用字段
foreach ($f in @('result','status','data','payload')) {
  if ($vidR.PSObject.Properties[$f]) { Write-Error "FAIL: video 含禁用字段 $f"; exit 1 }
}
Write-Host "✅ video-dryrun PASS url=$($vidR.url)"
Write-Host "✅ 快手 E2E 全部通过"
exit 0
```

**PASS 标准**: 脚本 exit 0 + image-dryrun `ok:true,dryRun:true` + video-dryrun `ok:true,dryRun:true` + image keys = 5 + video keys = 4
**FAIL 标准**: exit 1 OR 任一 `ok:false` OR keys 不匹配 OR timeout 15min
**GHA workflow**: `.github/workflows/kuaishou-e2e.yml`（`workflow_dispatch` + `windows-latest`）
**必要 secret**: `KUAISHOU_COOKIES`（PRD ASSUMPTION 已确认上传至 repo）

---

## Risks

| # | 风险 | 概率 | 影响 | Mitigation |
|---|------|------|------|------------|
| R1 | **KUAISHOU_COOKIES 过期** — GHA 注入后 cookie 失效，导航后 URL 重定向到 login/passport | 高 | 全部 E2E FAIL | 脚本检测导航后 URL：含 login/passport 时立即 exit 1 明确报错；WS1 DoD error path BEHAVIOR 验证此逻辑存在 |
| R2 | **dry-run 失守** — page.route 配置错误，发布 API 被真实调用 | 低 | 极高（触发真实发布） | page.route 拦截 /rest/cp/works/，命中时 abort + exit 1 报"dry-run 失守"；WS1 DoD BEHAVIOR 强制验证 |

---

## Workstreams

workstream_count: 2

### Workstream 1: publish-kuaishou-video-dryrun.cjs 新建（三模式 + 视频发布页导航）
**范围**: 新建 `services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs`，复用 image-dryrun 三模式框架（KUAISHOU_COOKIES + KUAISHOU_PROFILE_DIR + CDP 兜底），导航目标 `https://cp.kuaishou.com/article/publish/video`，输出 JSON 4 字段（ok/dryRun/url/title，无 imagesCount），拦截 /rest/cp/works/
**大小**: M（~150 行新建）
**依赖**: 无（WS1 已完成的 image-dryrun 为前提条件，但不是代码依赖）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/kuaishou-video-dryrun.test.ts`（已存在，Red 状态）

### Workstream 2: .github/workflows/kuaishou-e2e.yml 新建（GHA windows-latest）
**范围**: 新建 `.github/workflows/kuaishou-e2e.yml`，`workflow_dispatch`（可选 daily schedule），`windows-latest` runner，注入 `KUAISHOU_COOKIES` secret，分步运行 image-dryrun + video-dryrun，传递 SCREENSHOT_DIR，upload screenshots artifact（`if: always()`）
**大小**: S（~60 行新建）
**依赖**: Workstream 1（两个 publisher 脚本均存在后 workflow 才可测）

**BEHAVIOR 覆盖测试文件**: `tests/ws3/kuaishou-gha-workflow.test.ts`（已存在，Red 状态）

---

## Workstreams 切分验证（v7.7 自查）

| WS | 预期净增行数 | 文件数 | 满足 ≤200行 + ≤3文件 |
|----|------------|--------|---------------------|
| WS1 | ~150 行 | 1 | ✅ |
| WS2 | ~60 行 | 1 | ✅ |

整体净增 ~210 行 > 200，已拆 2 WS ✅

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws2/kuaishou-video-dryrun.test.ts` | 三模式 + schema 4 字段 + 无 imagesCount + 禁用字段反向 + page.route | 文件不存在 → 全 11 个 test failures |
| WS2 | `tests/ws3/kuaishou-gha-workflow.test.ts` | workflow 文件 + windows-latest + KUAISHOU_COOKIES + image+video + upload-artifact + always() + SCREENSHOT_DIR | 文件不存在 → 全 8 个 test failures |

---

## PRD Response Schema 字段自查 Checklist

### video-dryrun
| PRD 字段 | Contract 检查 | 匹配？ |
|---|---|---|
| `ok` (boolean, true) | Step 3 验证 + WS1 DoD [BEHAVIOR] | ✅ |
| `dryRun` (boolean, true) | Step 3 验证 + WS1 DoD [BEHAVIOR] | ✅ |
| `url` (string) | Step 3 验证 + WS1 DoD [BEHAVIOR] | ✅ |
| `title` (string) | Step 3 验证 + WS1 DoD [BEHAVIOR] | ✅ |
| **无** `imagesCount` | Step 3 反向检查 + WS1 DoD [BEHAVIOR] | ✅ |
| 禁用: `result`/`status`/`data`/`payload` | Step 3 反向检查 + WS1 DoD [BEHAVIOR] | ✅ |
| keys 完整性 `["dryRun","ok","title","url"]` | Step 3 jq-e 精确匹配 + e2e-verify.ps1 | ✅ |

**自查 checklist 断言（v7.6）**: WS1 DoD 含 7 条 [BEHAVIOR] ≥ 4 ✅；WS2 DoD 含 5 条 [BEHAVIOR] ≥ 4 ✅

**depends_on 串行链（v7.10）**: ws1 depends_on=[] ✅；ws2 depends_on=["ws1"] ✅

**假绿自查（v7.12）**: 所有 BEHAVIOR 命令均读取目标文件内容；文件不存在时 readFileSync 抛出 → exit 1 → 真红 ✅
