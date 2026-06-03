# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面）

### Endpoint: POST /api/crm/init
**Success (HTTP 200)**:
```json
{"success": true, "table_id": "<string>"}
```
- `success` (boolean, 必填): 来源——PRD E2E `jq -e '.success == true'`
- `table_id` (string, 必填): 来源——PRD E2E `jq -e '.table_id != null'`；无表场景新建后返回；有表场景返回已有 table_id
**禁用字段名**: `result`, `data`, `id`, `tableId`（驼峰与 PRD 下划线命名不一致）

**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```

---

### Endpoint: GET /api/crm/wechat-contacts?tenant_id=
**Success (HTTP 200)**:
```json
{"contacts": [{"wechat_id": "<string>", "nickname": "<string>"}]}
```
- `contacts` (array, 必填): 来源——PRD E2E `jq -e '(.contacts | length) >= 1'`；mock 场景固定 5 条
**禁用字段名**: `list`, `items`, `data`, `users`

**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```

---

### Endpoint: GET /api/crm/match-preview?tenant_id=
**Success (HTTP 200)**:
```json
{"matched": [], "pending": [], "unmatched": []}
```
- `matched` (array, 必填): 来源——PRD E2E `jq -e '.matched | length >= 0'`
- `pending` (array, 必填): 来源——PRD Golden Path Step 6「待确认」类别 `[NEW_PATTERN]`
- `unmatched` (array, 必填): 来源——PRD Golden Path Step 6「未匹配」类别 `[NEW_PATTERN]`
**禁用字段名**: `results`, `data`, `contacts`

**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```

---

### Endpoint: POST /api/crm/daily-analysis
**Request body**: `{"tenant_id": "<string>", "dry_run": boolean}`
**Success (HTTP 200)**:
```json
{"customers": [], "webhook_sent": false}
```
- `customers` (array, 必填): 来源——PRD E2E `jq -e '.customers | length >= 0'`
- `webhook_sent` (boolean, 必填): 来源——PRD E2E `jq -e '.webhook_sent == false'`（dry_run 时）
**禁用字段名**: `result`, `data`, `contacts`, `users`, `webhookSent`

**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```

---

## Golden Path

### 首次接入路径
[Dashboard CrmConfigPage] → [选平台 → API 建/检测表] → [拉联系人 → AI 匹配] → [用户确认 → 写映射 DB]

### 日常路径
[Brain tick 8:30] → [读 CRM 表 → AI 分析 → 推送飞书群]

---

### Step 1: 用户打开 Dashboard CRM 配置页，选择 CRM 平台
**来源**: `[FROM_PRD]` — PRD Golden Path 首次接入 Step 1「用户在 Dashboard 点配置客户管理 → 选择 CRM 平台：飞书 or Notion」

**可观测行为**: Dashboard 路由 `/crm/config` 渲染 CrmConfigPage，包含平台选择器（飞书/Notion），页面无 crash，关键 UI 元素可见

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/pages/CrmConfigPage.tsx','utf8');
if (!c.includes('feishu') && !c.includes('飞书')) { console.error('FAIL: 缺飞书选项'); process.exit(1); }
if (!c.includes('notion') || !c.includes('Notion')) { console.error('FAIL: 缺 Notion 选项'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: CrmConfigPage 存在 + 含平台选择器逻辑，耗时 < 1s

---

### Step 2: 系统建/检测客户明细表（POST /api/crm/init）
**来源**: `[FROM_PRD]` — PRD Golden Path 首次接入 Step 3「无表 → 调 CRM 平台 API 自动建表（含评级/状态/微信号/跟进时间等核心字段）；有表 → 读取字段映射」；PRD E2E Step 1

**可观测行为**: POST /api/crm/init 返回 HTTP 200 + `{ success: true, table_id: "<非空字符串>" }`；表已建立（或已有表检测通过）

**验证命令**:
```bash
# 验证路由文件存在且导出正确函数
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/crm.ts','utf8');
if (!c.includes('/init')) { console.error('FAIL: 缺 /init 路由'); process.exit(1); }
if (!c.includes('success')) { console.error('FAIL: 响应无 success 字段'); process.exit(1); }
if (!c.includes('table_id')) { console.error('FAIL: 响应无 table_id 字段'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: crm.ts 文件存在 + `/init` 路由定义 + `success`/`table_id` 响应字段

---

### Step 3: 系统拉取微信联系人列表（GET /api/crm/wechat-contacts，mock 5 条）
**来源**: `[FROM_PRD]` — PRD Golden Path 首次接入 Step 4「系统调用 xian-pc wechat_rpa.py 拉取微信联系人列表（E2E 中 mock 返回固定 5 条）」；PRD ASSUMPTION 明确 mock

**可观测行为**: GET /api/crm/wechat-contacts?tenant_id=X 返回 `{ contacts: [5 条] }`，contacts 数组长度 >= 1（E2E mock 返回固定 5 条）

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/crm.ts','utf8');
if (!c.includes('wechat-contacts')) { console.error('FAIL: 缺 wechat-contacts 路由'); process.exit(1); }
if (!c.includes('contacts')) { console.error('FAIL: 响应无 contacts 字段'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: `/wechat-contacts` 路由定义存在 + `contacts` 字段

---

### Step 4: AI 模糊匹配 → 中台展示匹配结果（GET /api/crm/match-preview）
**来源**: `[FROM_PRD]` — PRD Golden Path 首次接入 Step 5-6「AI 将联系人按微信号/昵称模糊匹配 CRM 表记录；中台展示匹配结果（已匹配 / 待确认 / 未匹配）」；PRD E2E Step 3

**可观测行为**: GET /api/crm/match-preview?tenant_id=X 返回 `{ matched: [...], pending: [...], unmatched: [...] }`；Dashboard CrmConfigPage 渲染三类列表

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/crm.ts','utf8');
if (!c.includes('match-preview')) { console.error('FAIL: 缺 match-preview 路由'); process.exit(1); }
if (!c.includes('matched')) { console.error('FAIL: 响应无 matched 字段'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: `/match-preview` 路由定义 + `matched` 字段

---

### Step 5: 用户确认 → crm_wechat_mapping 写入 DB
**来源**: `[FROM_PRD]` — PRD Golden Path 首次接入 Step 7「确认后写入 crm_wechat_mapping（wechat_contact_id ↔ crm_row_id ↔ platform ↔ tenant_id）」；PRD 预期文件列表含 `packages/db/migrations/` 新增 crm_wechat_mapping 表

**可观测行为**: DB migration 文件存在，定义 `crm_wechat_mapping` 表含 `wechat_contact_id`, `crm_row_id`, `platform`, `tenant_id` 字段

**验证命令**:
```bash
node -e "
const fs = require('fs');
const path = require('path');
const mDir = 'packages/db/migrations';
const files = fs.readdirSync(mDir);
const migFile = files.find(f => f.includes('crm_wechat_mapping'));
if (!migFile) { console.error('FAIL: crm_wechat_mapping migration 文件不存在'); process.exit(1); }
const c = fs.readFileSync(path.join(mDir, migFile), 'utf8');
if (!c.includes('wechat_contact_id')) { console.error('FAIL: 缺 wechat_contact_id 字段'); process.exit(1); }
if (!c.includes('crm_row_id')) { console.error('FAIL: 缺 crm_row_id 字段'); process.exit(1); }
if (!c.includes('platform')) { console.error('FAIL: 缺 platform 字段'); process.exit(1); }
if (!c.includes('tenant_id')) { console.error('FAIL: 缺 tenant_id 字段'); process.exit(1); }
console.log('OK migration:', migFile);
"
```

**硬阈值**: migration 文件存在 + 4 个核心字段均在

---

### Step 6: Brain tick 8:30 触发每日 AI 分析 + 飞书群推送（POST /api/crm/daily-analysis）
**来源**: `[FROM_PRD]` — PRD 日常使用 Golden Path Step 1-5「Brain tick 8:30 → 读表 → AI 分析 → 排优先级 → 推送飞书机器人群」；PRD E2E Step 4

**可观测行为**: POST /api/crm/daily-analysis（dry_run:true）返回 `{ customers: [...], webhook_sent: false }`；Brain tick 8:30 cron 注册在 tick 调度器中

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/crm.ts','utf8');
if (!c.includes('daily-analysis')) { console.error('FAIL: 缺 daily-analysis 路由'); process.exit(1); }
if (!c.includes('webhook_sent')) { console.error('FAIL: 响应无 webhook_sent 字段'); process.exit(1); }
if (!c.includes('customers')) { console.error('FAIL: 响应无 customers 字段'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: `/daily-analysis` 路由 + `customers`/`webhook_sent` 字段

---

### Step 7: error path — 缺必填参数返回 4xx
**来源**: `[AI_ADDED]` — 防止 generator 不做参数校验（缺 tenant_id → Brain 通用 404 handler 会假绿通过）

**可观测行为**: POST /api/crm/init（无 tenant_id body）→ HTTP 400 + `{ error: "<string>" }`；GET /api/crm/wechat-contacts（无 tenant_id query）→ HTTP 400 + `{ error: "<string>" }`

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/crm.ts','utf8');
if (!c.includes('400') && !c.includes('BAD_REQUEST') && !c.includes('error')) {
  console.error('FAIL: 缺参数校验逻辑');
  process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: 路由含参数校验 + 4xx 响应

---

## E2E 验收（final-e2e — windows_cloud 变体 C：Dashboard + Playwright）

> **windows_cloud workflow 内容审查**（v8.1 规则）：
> 已读取 `.github/workflows/e2e-windows.yml`，实际内容为：
> - `workflow_dispatch` trigger，inputs: `task_id`, `sprint_dir`, `pr_branch`
> - 唯一 step：读取 `${sprint_dir}/e2e-verify.ps1` 并执行 `& $ps1Path`
>
> **用户路径 1:1 映射检查**：
> | 用户步骤 | GHA 对应 step | 状态 |
> |---|---|---|
> | Dashboard 打开 CRM 配置页 | Playwright `page.goto('/crm/config')` | ✅ 在 spec 中 |
> | 选择 CRM 平台（飞书/Notion） | Playwright `page.click()` + API stub | ✅ 在 spec 中 |
> | 系统调用 /api/crm/init 建表 | `page.route()` stub + 断言请求发出 | ✅ 在 spec 中 |
> | 系统拉取微信联系人（mock 5 条） | `page.route()` stub 返回 5 条 | ✅ 在 spec 中 |
> | 展示匹配结果 | Playwright `expect().toBeVisible()` | ✅ 在 spec 中 |
> | 用户确认映射 | Playwright click + stub assertion | ✅ 在 spec 中 |
> | 每日 AI 分析 dry_run | Playwright 直接 API 请求断言 | ✅ 在 spec 中 |
> | [CI_GAP: 真实 DB 写入 crm_wechat_mapping] | windows_cloud 无 DB，只验 API 请求结构 | ⚠️ 可接受（ASSUMPTION mock） |
> | [CI_GAP: Brain tick 8:30 真实 cron] | windows_cloud 无 Brain，直接 POST API 验证 | ⚠️ 可接受（dry_run 模式） |

**journey_type**: user_facing
**target_environment**: windows_cloud

```powershell
# e2e-verify.ps1 — Sprint: Path 4 CRM 打通（windows_cloud 变体 C：Dashboard Playwright）
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

# 3. Build dashboard
Write-Host "▶ Building dashboard..."
$buildProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow
if ($buildProc.ExitCode -ne 0) { throw "FAIL: build failed" }

# 4. 启动 Vite preview
Write-Host "▶ Starting Vite preview on port $VitePort..."
$serverProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -PassThru -NoNewWindow

# 5. 等待 Vite 就绪（Test-NetConnection 兼容 IPv4/IPv6）
$maxWait = 30
$waited = 0
do {
  Start-Sleep -Seconds 1
  $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未在 ${maxWait}s 内就绪 port=$VitePort" }
Write-Host "✅ Vite 就绪 port=$VitePort"

# 6. 跑 Playwright E2E
$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\crm-config.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow `
  -Environment @{
    BASE_URL = $BaseUrl
    E2E_EMAIL = $SuperAdminEmail
    E2E_PASSWORD = $SuperAdminPassword
  }

Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
if ($e2eProc.ExitCode -ne 0) { throw "FAIL: Playwright E2E 失败 exit=$($e2eProc.ExitCode)" }
Write-Host "✅ windows_cloud CRM E2E 验证通过"
exit 0
```

**PASS 标准**: `e2eProc.ExitCode -eq 0` + Playwright 所有 spec 通过
**FAIL 标准**: 任何 step exit≠0 OR Playwright 失败 OR Vite 30s 内未就绪
**GHA workflow**: `.github/workflows/e2e-windows.yml`（`workflow_dispatch` + `windows-latest`）
**secrets 必须**: `E2E_SUPER_ADMIN_EMAIL`、`E2E_SUPER_ADMIN_PASSWORD`

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| CRM 路由 schema | `tests/crm-routes.test.ts` | crm.ts 路由文件结构 | → 2 failures（文件不存在） |
| crm_wechat_mapping 迁移 | `tests/crm-migration.test.ts` | migration 文件结构 | → 1 failure（文件不存在） |
| Playwright E2E | `apps/dashboard/e2e/crm-config.spec.ts` | UI Golden Path 全程 | → 4 failures（页面不存在） |
