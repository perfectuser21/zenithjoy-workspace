# Sprint Contract Draft (Round 1)

## Golden Path

[Admin 打开 /operator] → [点击"登录"按钮] → [bind-start 下发 Agent task] → [Agent CDP 扫码] → [upload-cookies 存 GitHub Secret] → [Dashboard 状态更新为绿] → [GHA 4x/日巡检正确读 *_COOKIES]

---

### Step 1: Admin 打开 `/operator` 看到 8 主号行各有"登录"按钮

**来源**: `[FROM_PRD]` — PRD "Golden Path 核心场景 → 首次使用 Step 1"

**可观测行为**: `/operator` 页面每个平台（抖音/快手/小红书/视频号/头条/微博/知乎/公众号）的 MAIN 行有 `data-testid="login-btn-{platform}"` 按钮，未配置时灰色显示 `status=missing`。

**验证命令**:
```bash
# Mode A（evaluator 逐 WS）— 检查 OperatorPage.tsx 含正确 data-testid
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/pages/OperatorPage.tsx','utf8');
if (!c.includes('login-btn-')) { console.error('FAIL: 缺少 login-btn- data-testid'); process.exit(1); }
if (!c.includes('bind-start')) { console.error('FAIL: 缺少 bind-start 调用'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: 文件含 `login-btn-` + `bind-start`，缺一项 FAIL

---

### Step 2: Admin 点击"抖音主号 → 登录" → `POST /api/operator/sessions/bind-start` 返回 `{ok: true, taskId: "<uuid>"}`

**来源**: `[FROM_PRD]` — PRD "Golden Path Step 2 + Response Schema → bind-start"

**可观测行为**: 
- 请求体 `{platform: "douyin"}` 
- 成功响应 HTTP 200，body 顶层 keys 完全等于 `["ok","taskId"]`
- `ok = true`，`taskId` 为 UUID 字符串
- **禁用 key**：`id`/`task`/`result`/`data`

**验证命令**:
```bash
# Mode A — 检查路由文件实现了正确的 response schema
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/operator-sessions.ts','utf8');
if (!c.includes(\"'ok'\") && !c.includes('\"ok\"')) { console.error('FAIL: 缺少 ok 字段'); process.exit(1); }
if (!c.includes('taskId')) { console.error('FAIL: 缺少 taskId 字段'); process.exit(1); }
if (c.match(/res\.json\(.*\"id\"/) || c.match(/res\.json\(.*'id'/)) { console.error('FAIL: 禁用字段 id 出现'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: 含 `ok`、`taskId`，不含禁用字段 `id`/`task`/`result`/`data` 作为 response key

---

### Step 3: 后端向 xian-pc Agent 下发 `qr_bind/douyin` task

**来源**: `[FROM_PRD]` — PRD "Golden Path Step 3"

**可观测行为**: `bind-start` 接口通过现有 Agent task dispatch 机制向 xian-pc 发送 `{task_type: "qr_bind/douyin"}` task，返回对应 taskId。

**验证命令**:
```bash
# Mode A — 检查 bind-start 路由含 task dispatch 逻辑
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/operator-sessions.ts','utf8');
if (!c.includes('qr_bind') && !c.includes('qr-bind')) { console.error('FAIL: 缺少 qr_bind task dispatch'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: 含 `qr_bind` 或 `qr-bind` 调度逻辑

---

### Step 4: xian-pc Agent `qr-bind-{platform}.ts` handler — CDP 连 Chrome:19222 → 等待扫码

**来源**: `[FROM_PRD]` — PRD "Golden Path Step 4 + 范围内：7 个新增 handler"

**可观测行为**: 7 个新 qr-bind handler 文件各 export 一个 handle 函数，loginUrl 对应各自平台 creator 域名，URL 离开 `/login` 即判定登录成功。

**验证命令**:
```bash
# Mode A — 检查 7 个 handler 文件全部存在，各含正确 loginUrl
node -e "
const fs = require('fs');
const handlers = [
  ['services/agent/src/handlers/qr-bind-kuaishou.ts', 'cp.kuaishou.com'],
  ['services/agent/src/handlers/qr-bind-xiaohongshu.ts', 'xiaohongshu.com'],
  ['services/agent/src/handlers/qr-bind-shipinhao.ts', 'channels.weixin.qq.com'],
  ['services/agent/src/handlers/qr-bind-toutiao.ts', 'mp.toutiao.com'],
  ['services/agent/src/handlers/qr-bind-weibo.ts', 'weibo.com'],
  ['services/agent/src/handlers/qr-bind-zhihu.ts', 'zhihu.com'],
  ['services/agent/src/handlers/qr-bind-gongzhonghao.ts', 'mp.weixin.qq.com'],
];
let fail = false;
for (const [path, domain] of handlers) {
  if (!fs.existsSync(path)) { console.error('FAIL: missing ' + path); fail = true; continue; }
  const c = fs.readFileSync(path, 'utf8');
  if (!c.includes(domain)) { console.error('FAIL: ' + path + ' 缺少 ' + domain); fail = true; }
}
if (fail) process.exit(1);
console.log('OK');
"
```

**硬阈值**: 7 个文件全部存在且各含正确平台域名

---

### Step 5: Agent 抓取 `storageState` → `POST /api/operator/sessions/upload-cookies` → 后端 Octokit 写 `DOUYIN_COOKIES` Secret

**来源**: `[FROM_PRD]` — PRD "Golden Path Step 5+6 + Response Schema → upload-cookies"

**可观测行为**:
- 请求体 `{platform: "douyin", cookies: {...}}`
- 成功响应 HTTP 200，顶层 keys 完全等于 `["ok","secretName","updatedAt"]`
- `ok = true`，`secretName = "DOUYIN_COOKIES"`，`updatedAt` 为 ISO string
- **禁用 key**：`secret`/`key`/`name`/`result`/`message`/`msg`/`timestamp`/`time`/`updated`/`at`

**验证命令**:
```bash
# Mode A — 检查 upload-cookies 含正确 response schema
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/operator-sessions.ts','utf8');
if (!c.includes('secretName')) { console.error('FAIL: 缺少 secretName 字段'); process.exit(1); }
if (!c.includes('updatedAt')) { console.error('FAIL: 缺少 updatedAt 字段'); process.exit(1); }
if (!c.includes('COOKIES')) { console.error('FAIL: 缺少 *_COOKIES Secret 命名逻辑'); process.exit(1); }
const forbidden = ['\"secret\"', '\"key\"', '\"name\"', '\"timestamp\"', '\"message\"'];
for (const f of forbidden) {
  if (c.includes('json({' + f) || c.includes('json({ ' + f)) { console.error('FAIL: 禁用字段 ' + f); process.exit(1); }
}
console.log('OK');
"
```

**硬阈值**: 含 `secretName`/`updatedAt`/`COOKIES`，不含禁用字段作为 response key，keys 完全集合 = `["ok","secretName","updatedAt"]`

---

### Step 6: `GH_SECRETS_WRITE_PAT` 未配置 → HTTP 500 + `{error: "GH_SECRETS_WRITE_PAT 未配置"}`

**来源**: `[AI_ADDED]` — PRD "边界情况"段明确列出，防止 Octokit 在无 PAT 时 unhandled crash 导致 500 无 body

**可观测行为**: upload-cookies 调用时若 `GH_SECRETS_WRITE_PAT` 环境变量未设置，返回 HTTP 500 + `{error: "GH_SECRETS_WRITE_PAT 未配置"}`

**验证命令**:
```bash
# Mode A — 检查路由含 GH_SECRETS_WRITE_PAT 未配置的明确报错
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/operator-sessions.ts','utf8');
if (!c.includes('GH_SECRETS_WRITE_PAT')) { console.error('FAIL: 缺少 GH_SECRETS_WRITE_PAT 检查'); process.exit(1); }
if (!c.includes('503') && !c.includes('500')) { console.error('FAIL: 缺少错误状态码'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: 含 `GH_SECRETS_WRITE_PAT` 检查 + 5xx 错误响应

---

### Step 7: Agent 不在线 → `POST /api/operator/sessions/bind-start` 返回 HTTP 503 + `{error: "Agent 不在线"}`

**来源**: `[AI_ADDED]` — PRD "边界情况"段明确列出，防止 Agent 离线时前端无限等待

**可观测行为**: xian-pc Agent 不在线时，`bind-start` 返回 HTTP 503 + `{error: "Agent 不在线"}`

**验证命令**:
```bash
# Mode A — 检查 bind-start 含 Agent 在线检测逻辑
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/operator-sessions.ts','utf8');
if (!c.includes('503') && !c.includes('Agent')) { console.error('FAIL: 缺少 Agent 离线处理'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: 含 `503` + Agent 离线判断

---

### Step 8: Dashboard `GET /api/operator/sessions/status` 轮询 → 格子变绿 ✅ 显示 `updatedAt`

**来源**: `[FROM_PRD]` — PRD "Golden Path Step 7 + Response Schema → status"

**可观测行为**: 
- 响应数组每项 keys 含 `platform`/`secretName`/`status`/`checkedAt`
- `status` 枚举：`ok`/`expired`/`missing`，**禁用** `healthy`/`active`/`inactive`/`good`
- Dashboard 格子 status=ok 时显示绿色 `✅ 在线`，expired 红色 `❌ 过期`

**验证命令**:
```bash
# Mode A — 检查 status endpoint 含正确字段
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/operator-sessions.ts','utf8');
if (!c.includes('checkedAt')) { console.error('FAIL: 缺少 checkedAt 字段'); process.exit(1); }
const forbidden = ['healthy', 'active', 'inactive'];
for (const f of forbidden) {
  if (c.includes('\"' + f + '\"') || c.includes(\"'\" + f + \"'\")) {
    console.error('FAIL: 禁用 status 值 ' + f); process.exit(1);
  }
}
console.log('OK');
"
```

**硬阈值**: 含 `checkedAt`，status 值不含禁用词

---

### Step 9: `check-health.js` `*_MAIN → *_COOKIES` 修复 + `missing=ok` bug 修复

**来源**: `[FROM_PRD]` — PRD "背景"段两个阻塞问题

**可观测行为**:
- PLATFORMS 数组中所有主号 `secretEnv` 改为 `*_COOKIES` 格式（`DOUYIN_COOKIES`/`KUAISHOU_COOKIES` 等）
- Secret 环境变量为空字符串时，`status` 必须为 `missing`，不得为 `ok`
- `session-health-check.yml` env 段同步改为 `DOUYIN_COOKIES: ${{ secrets.DOUYIN_COOKIES }}`

**验证命令**:
```bash
# 9-A: 无 *_MAIN secretEnv（主号部分）
node -e "
const c = require('fs').readFileSync('scripts/sessions/check-health.js','utf8');
const match = c.match(/secretEnv.*_(MAIN)/g);
if (match) { console.error('FAIL: 仍含 _MAIN secretEnv:', match[0]); process.exit(1); }
console.log('OK');
"

# 9-B: 含 DOUYIN_COOKIES 等 *_COOKIES 条目
node -e "
const c = require('fs').readFileSync('scripts/sessions/check-health.js','utf8');
if (!c.includes('DOUYIN_COOKIES')) { console.error('FAIL: 缺少 DOUYIN_COOKIES'); process.exit(1); }
if (!c.includes('KUAISHOU_COOKIES')) { console.error('FAIL: 缺少 KUAISHOU_COOKIES'); process.exit(1); }
console.log('OK');
"

# 9-C: GHA YAML 引用 *_COOKIES
node -e "
const c = require('fs').readFileSync('.github/workflows/session-health-check.yml','utf8');
if (!c.includes('DOUYIN_COOKIES')) { console.error('FAIL: GHA YAML 缺少 DOUYIN_COOKIES'); process.exit(1); }
if (c.includes('DOUYIN_MAIN:') && c.includes('secrets.DOUYIN_MAIN')) {
  console.error('FAIL: GHA YAML 仍引用 DOUYIN_MAIN Secret'); process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: check-health.js 无 `_MAIN` secretEnv；有 `DOUYIN_COOKIES`；GHA YAML 有 `DOUYIN_COOKIES:` 引用

---

### Step 10: GHA `session-health-check.yml` 每日 4 次触发，真实 HTTP 巡检各平台 cookie 有效性

**来源**: `[FROM_PRD]` — PRD "日常巡检"段

**可观测行为**: GHA workflow `session-health-check.yml` 在 `env:` 段引用 `DOUYIN_COOKIES: ${{ secrets.DOUYIN_COOKIES }}`（而非 `DOUYIN_MAIN`），任意主号 expired → 飞书 Bot push + Dashboard 标红。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('.github/workflows/session-health-check.yml','utf8');
const cookies = ['DOUYIN_COOKIES','KUAISHOU_COOKIES','XIAOHONGSHU_COOKIES','SHIPINHAO_COOKIES',
  'TOUTIAO_COOKIES','WEIBO_COOKIES','ZHIHU_COOKIES','GONGZHONGHAO_COOKIES'];
let fail = false;
for (const key of cookies) {
  if (!c.includes(key + ':')) { console.error('FAIL: GHA YAML 缺少 ' + key); fail = true; }
}
if (fail) process.exit(1);
console.log('OK');
"
```

**硬阈值**: GHA YAML 含 8 个 `*_COOKIES:` 引用

---

## E2E 验收（final-e2e — target_environment: windows_cloud）

**journey_type**: user_facing
**target_environment**: windows_cloud（ZenithJoy Dashboard — GitHub Actions windows-latest + Playwright）

按 `target_environment = windows_cloud` 变体 C（Dashboard/Web App）执行。

```powershell
# sprints/line00-session-health-medium/e2e-verify.ps1
# final-e2e 验证脚本 — ZenithJoy Dashboard Playwright（windows-latest）
param(
  [string]$BaseUrl = "http://localhost:5174",
  [string]$OperatorEmail = $env:E2E_OPERATOR_EMAIL,
  [string]$OperatorPassword = $env:E2E_OPERATOR_PASSWORD
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

# 5. 等待服务就绪
$maxWait = 30; $waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未在 ${maxWait}s 内就绪 port=$VitePort" }
Write-Host "✅ Vite 就绪 port=$VitePort"

# 6. 跑 Playwright E2E
$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\operator-sessions.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow `
  -Environment @{
    BASE_URL          = $BaseUrl
    E2E_OPERATOR_EMAIL    = $OperatorEmail
    E2E_OPERATOR_PASSWORD = $OperatorPassword
  }

Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
if ($e2eProc.ExitCode -ne 0) { throw "FAIL: Playwright E2E 失败 exit=$($e2eProc.ExitCode)" }
Write-Host "✅ windows_cloud Dashboard E2E 验证通过"
exit 0
```

**PASS 标准**: `e2eProc.ExitCode -eq 0` + Playwright spec `operator-sessions.spec.ts` 所有 test 通过
**FAIL 标准**: 任何 step exit≠0 OR Playwright 失败 OR Vite 30s 未就绪
**GHA workflow**: `.github/workflows/e2e-windows.yml`（`workflow_dispatch` + `windows-latest`）
**secrets 必须**: `E2E_OPERATOR_EMAIL`、`E2E_OPERATOR_PASSWORD`（`xuxiao21xx@icloud.com` 账户）

---

## Workstreams

workstream_count: 7

### Workstream 1: check-health.js 修复 + GHA YAML 同步 + smoke script

**范围**: `*_MAIN→*_COOKIES` secretEnv 重命名（8 主号）、missing=ok bug 修复（空 Secret 值断言 status='missing'）、session-health-check.yml Secret 引用同步、新建 session-health-medium-smoke.sh
**大小**: S（~80 行净增/改，3 文件）
**依赖**: 无

---

### Workstream 2: Agent qr-bind batch A（快手/小红书/视频号）

**范围**: 新建 `qr-bind-kuaishou.ts`、`qr-bind-xiaohongshu.ts`、`qr-bind-shipinhao.ts`，仿 `qr-bind-douyin.ts` 模式，loginUrl 各平台 creator 域名
**大小**: M（~180 行净增，3 文件）
**依赖**: Workstream 1 完成后

---

### Workstream 3: Agent qr-bind batch B（头条/微博/知乎）

**范围**: 新建 `qr-bind-toutiao.ts`、`qr-bind-weibo.ts`、`qr-bind-zhihu.ts`
**大小**: M（~180 行净增，3 文件）
**依赖**: Workstream 2 完成后

---

### Workstream 4: Agent qr-bind batch C（公众号）+ 注册 7 个 handler 到 agent index.ts

**范围**: 新建 `qr-bind-gongzhonghao.ts`；更新 `services/agent/src/index.ts` import 并在 task dispatch switch 中注册 7 个新 handler（`qr_bind/kuaishou` 等）
**大小**: S（~90 行净增，2 文件）
**依赖**: Workstream 3 完成后

---

### Workstream 5: 后端 API `apps/api/src/routes/operator-sessions.ts`

**范围**: 新建 operator-sessions 路由，含三个端点：`POST /api/operator/sessions/bind-start`（dispatch qr_bind task 给 xian-pc Agent）、`POST /api/operator/sessions/upload-cookies`（Octokit 写 GitHub Secret）、`GET /api/operator/sessions/status`（返回各平台状态数组）
**大小**: M（~170 行净增，1 文件）
**依赖**: Workstream 4 完成后

---

### Workstream 6: Dashboard OperatorPage.tsx 升级 + Playwright E2E spec

**范围**: OperatorPage.tsx 主号行添加"登录"/"重新登录"按钮，调 `/api/operator/sessions/bind-start`，页面轮询 `/api/operator/sessions/status`，status=ok 显绿 ✅/expired 显红 ❌；新建 `apps/dashboard/e2e/operator-sessions.spec.ts` Playwright 测试
**大小**: M（~200 行净增，2 文件）
**依赖**: Workstream 5 完成后

---

### Workstream 7: e2e-verify.ps1（final-e2e 验收脚本）

**范围**: 新建 `sprints/line00-session-health-medium/e2e-verify.ps1`，按 windows_cloud 变体 C 模板，npm ci → playwright install → build → vite preview → 跑 operator-sessions.spec.ts
**大小**: S（~100 行净增，1 文件）
**依赖**: Workstream 6 完成后

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/check-health.test.ts` | secretEnv 命名、missing=ok 修复、GHA YAML 同步 | ≥3 failures |
| WS2 | `tests/ws2/qr-bind-batch-a.test.ts` | 3 handler 文件存在+loginUrl 正确 | ≥3 failures |
| WS3 | `tests/ws3/qr-bind-batch-b.test.ts` | 3 handler 文件存在+loginUrl 正确 | ≥3 failures |
| WS4 | `tests/ws4/qr-bind-batch-c.test.ts` | gongzhonghao handler + agent index 注册 | ≥2 failures |
| WS5 | `tests/ws5/operator-sessions.test.ts` | API schema、禁用字段、error path | ≥4 failures |
| WS6 | `tests/ws6/operator-page.test.ts` | login-btn testid、bind-start 调用、status 轮询 | ≥3 failures |
| WS7 | `tests/ws7/e2e-verify.test.ts` | ps1 文件存在+含 operator-sessions spec 引用 | ≥1 failure |
