# Sprint Contract Draft (Round 1 — Rev 2)

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

# 补强 gate：运行 TDD 红绿测试（WS1 实现后 Green）
cd /workspace && npx vitest run sprints/tests/ws1/kuaishou-publish.test.ts --reporter=verbose 2>&1 | tail -10
```

**硬阈值**: handler 文件含三关键字 + vitest 测试全 PASS

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
if (!c.includes('kuaishou-image-')) { console.error('FAIL: 缺截图命名 kuaishou-image-'); process.exit(1); }
console.log('OK');
" || { echo "FAIL: image-dryrun 三模式未实现"; exit 1; }
```

**硬阈值**: 旧文件不含 `addCookies` / `KUAISHOU_COOKIES` / `kuaishou-image-` → 真红；命令 exit 0 表示三模式已实现且端口正确

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

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD "边界情况"明确"快手 CDP 端口 **19223**，区别于抖音 19222，禁止混用"；image-dryrun 旧文件已含 19223 但 cookie 注入新增代码可能不慎引入 19222；video-dryrun 是新文件，generator 可能复制抖音模板带入 19222。需单独断言防止 port 混用导致跨平台账号泄露。

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

**验证命令** (在 GHA windows-latest runner PowerShell 环境中执行，由 `sprints/e2e-verify.ps1` 承载):
```powershell
# 验证 image-dryrun exit 0 + 截图存在
$imgResult = node "$agentDir\publishers\kuaishou-publisher\publish-kuaishou-image-dryrun.cjs" $QueueImageJson 2>&1
$imgJson = ($imgResult | Where-Object { $_ -match '^\{' } | Select-Object -Last 1) | ConvertFrom-Json
if (-not $imgJson.ok -or -not $imgJson.dryRun) { Write-Error "FAIL: image-dryrun ok=$($imgJson.ok)"; exit 1 }
$imgs = Get-ChildItem "$screenshotDir\kuaishou-image-*.png" -ErrorAction SilentlyContinue
if ($imgs.Count -eq 0) { Write-Error "FAIL: 无 image 截图"; exit 1 }

# 验证 video-dryrun exit 0 + 截图存在
$vidResult = node "$agentDir\publishers\kuaishou-publisher\publish-kuaishou-video-dryrun.cjs" $QueueVideoJson 2>&1
$vidJson = ($vidResult | Where-Object { $_ -match '^\{' } | Select-Object -Last 1) | ConvertFrom-Json
if (-not $vidJson.ok -or -not $vidJson.dryRun) { Write-Error "FAIL: video-dryrun ok=$($vidJson.ok)"; exit 1 }
$vids = Get-ChildItem "$screenshotDir\kuaishou-video-*.png" -ErrorAction SilentlyContinue
if ($vids.Count -eq 0) { Write-Error "FAIL: 无 video 截图"; exit 1 }
Write-Host "✅ 快手 dryrun E2E 全通过"
```

**硬阈值**: image-dryrun exit 0 + `kuaishou-image-*.png` ≥ 1 张；video-dryrun exit 0 + `kuaishou-video-*.png` ≥ 1 张

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

# 1. 安装依赖（Windows PS1 规则 #2：npm/npx 必须用 cmd.exe /c *.cmd 形式）
Write-Host "▶ npm ci..."
$npmProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $agentDir `
  -Wait -PassThru -NoNewWindow
if ($npmProc.ExitCode -ne 0) { throw "FAIL: npm ci failed exit=$($npmProc.ExitCode)" }

Write-Host "▶ playwright install chromium..."
$pwProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory $agentDir `
  -Wait -PassThru -NoNewWindow
if ($pwProc.ExitCode -ne 0) { throw "FAIL: playwright install failed exit=$($pwProc.ExitCode)" }

# 2. 创建截图目录
New-Item -ItemType Directory -Force -Path $screenshotDir | Out-Null

# 3. 创建 image 队列文件
@{
  title   = "快手图文 dryrun 验证 $(Get-Date -Format 'HH:mm')"
  content = "GHA E2E 自检"
  images  = @()
} | ConvertTo-Json | Out-File -FilePath $QueueImageJson -Encoding utf8

# 4. 执行 image-dryrun（KUAISHOU_COOKIES 由 GHA step env 注入，node 子进程继承）
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

# 6. 创建 video 队列文件（video_path 为空，dryrun 不实际上传视频）
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

**范围**: 重写 `kuaishou-publish.ts`，提取 `resolveKuaishouScriptPath(type, env)` 函数（type=image → image-dryrun/real，type=video → video-dryrun/real，未知 type 显式抛 Error）；加 `ZENITHJOY_AGENT_REAL_PUBLISH` 环境变量开关（默认 dryrun）；新建 `services/agent/src/handlers/__tests__/kuaishou-publish.test.ts` 覆盖所有 type 路由路径
**大小**: M（~150 行，两文件）
**依赖**: 无
**DoD 详情**: 见 `sprints/contract-dod-ws1.md`

> **测试路径说明（防混淆）**：
> - `sprints/tests/ws1/kuaishou-publish.test.ts` — **Proposer 的 TDD 红绿测试**（已存在，WS1 实现前为 Red）
> - `services/agent/src/handlers/__tests__/kuaishou-publish.test.ts` — **Generator 在 WS1 中新建的 unit test**（WS1 产物之一）

**关键 [BEHAVIOR]（≥4，详见 `sprints/contract-dod-ws1.md`）**:
- [BEHAVIOR] handler 含 `resolveKuaishouScriptPath` 函数且按 type 路由 image 脚本
- [BEHAVIOR] handler video type 路由（kuaishou-video 关键字）
- [BEHAVIOR] handler 未知 type 显式抛错（no script for type）
- [BEHAVIOR] handler 含 ZENITHJOY_AGENT_REAL_PUBLISH 开关
- [BEHAVIOR] TDD vitest 测试全 PASS（vitest gate，防注释绕过）

---

### Workstream 2: publish-kuaishou-image-dryrun.cjs 三模式升级

**范围**: 现有 CDP-only 脚本加 KUAISHOU_COOKIES cookie injection 首选模式（`addCookies` Playwright API），profile dir 第二选（`userDataDir`），保留 CDP 19223 兜底；截图命名改为 `kuaishou-image-{timestamp}.png`；输出 JSON 末行 `{ok:true,dryRun:true}`
**大小**: M（~120 行改动）
**依赖**: Workstream 1 完成后
**DoD 详情**: 见 `sprints/contract-dod-ws2.md`

**关键 [BEHAVIOR]（≥4，详见 `sprints/contract-dod-ws2.md`）**:
- [BEHAVIOR] 脚本含 KUAISHOU_COOKIES env 读取和 addCookies cookie 注入调用
- [BEHAVIOR] 脚本 CDP 端口为 19223，且不含抖音端口 19222
- [BEHAVIOR] 脚本含 profile dir 降级模式（userDataDir 关键字）
- [BEHAVIOR] 脚本截图命名含 kuaishou-image- 前缀
- [BEHAVIOR] 脚本含 dryRun:true 输出

---

### Workstream 3: publish-kuaishou-video-dryrun.cjs 新建

**范围**: 新建视频 dryrun 脚本，三模式（KUAISHOU_COOKIES 注入 / profile dir / CDP 19223 兜底），导航 `https://cp.kuaishou.com/article/publish/video`，拦截 `/rest/cp/works/` POST/PUT（命中即抛 dryrun-失守 Error），截图命名 `kuaishou-video-{timestamp}.png`，stdout 末行 JSON `{ok:true,dryRun:true}`
**大小**: M（~140 行，新文件）
**依赖**: Workstream 2 完成后
**DoD 详情**: 见 `sprints/contract-dod-ws3.md`

**关键 [BEHAVIOR]（≥4，详见 `sprints/contract-dod-ws3.md`）**:
- [BEHAVIOR] 文件含视频发布 URL `https://cp.kuaishou.com/article/publish/video`
- [BEHAVIOR] 文件含 `/rest/cp/works/` API 拦截逻辑
- [BEHAVIOR] 文件含 KUAISHOU_COOKIES env 读取和 addCookies cookie 注入
- [BEHAVIOR] 文件 CDP 端口为 19223，且不含抖音端口 19222
- [BEHAVIOR] 文件截图命名含 kuaishou-video- 前缀

---

### Workstream 4: .github/workflows/kuaishou-e2e.yml 新建

**范围**: 新建 GHA workflow，`workflow_dispatch` 触发，`windows-latest` runner，注入 `KUAISHOU_COOKIES` env（来自 repo secret），分两 step 跑 image-dryrun 和 video-dryrun，最终 `upload-artifact` 上传 `screenshots/`（`if: always()` 确保失败也保存截图）
**大小**: S（~80 行，新 YAML）
**依赖**: Workstream 3 完成后
**DoD 详情**: 见 `sprints/contract-dod-ws4.md`

**关键 [BEHAVIOR]（≥4，详见 `sprints/contract-dod-ws4.md`）**:
- [BEHAVIOR] workflow 文件含 windows-latest runner 配置
- [BEHAVIOR] workflow 文件含 KUAISHOU_COOKIES secret 引用
- [BEHAVIOR] workflow 文件含 image-dryrun 执行步骤
- [BEHAVIOR] workflow 文件含 video-dryrun 执行步骤
- [BEHAVIOR] workflow 文件含 upload-artifact 步骤（if: always()）

---

## Test Contract

| Workstream | TDD 红绿测试（Proposer 写，evaluator 跑） | Generator 产物（unit test） | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/kuaishou-publish.test.ts` | `services/agent/src/handlers/__tests__/kuaishou-publish.test.ts`（WS1 新建）| WS1 前旧文件缺 resolveKuaishouScriptPath → 5 failures |
| WS2 | `sprints/tests/ws2/kuaishou-image-dryrun.test.ts` | 无额外 unit test | WS2 前文件缺 addCookies/KUAISHOU_COOKIES → 4 failures |
| WS3 | `sprints/tests/ws3/kuaishou-video-dryrun.test.ts` | 无额外 unit test | WS3 前文件不存在 → ENOENT → 5 failures |
| WS4 | `sprints/tests/ws4/kuaishou-e2e-workflow.test.ts` | 无额外 unit test | WS4 前文件不存在 → ENOENT → 5 failures |

---

## Risks

| # | Risk | 影响 | Mitigation |
|---|---|---|---|
| R1 | `KUAISHOU_COOKIES` 未在 GHA repo secrets 配置，或 cookie 已过期 | image/video-dryrun 无法注入 cookie → 跳转登录页 → exit 1 | 三模式降级：缺 KUAISHOU_COOKIES 时降级 profile dir，再降级 CDP 19223。GHA secret 配置为 PrepPRD 前置条件，sprint 不 block |
| R2 | 快手 CP 页面结构变更（`https://cp.kuaishou.com/article/publish/photo` 重定向或 UI 改动） | dryrun 导航成功但截图显示错误页面 → 无法验证登录状态 | dryrun 脚本加 URL 检查断言（`if url.includes('login')` 逻辑已有）；PRD 页面 URL 以 ASSUMPTION 标注，变更时重新评估 |
| R3 | GHA windows-latest Playwright Chromium 安装超时（大依赖包 + 网络不稳定） | `npx playwright install chromium` 超时 → CI 全卡 | e2e-verify.ps1 安装步骤设置 timeout（Playwright install 通常 <5min）；workflow 设置 `timeout-minutes: 15`；`--with-deps` 一次性装依赖 |
| R4 | video-dryrun `video_path: ""` 空路径导致脚本 crash | stdout 无 JSON → evaluator 判 FAIL | video-dryrun 脚本必须对空 video_path 容忍（dryrun 模式不实际上传视频，空路径合法）；验证命令包含 `if (-not $vidLastJson)` 检查 |
