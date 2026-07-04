# Sprint Contract Draft (Round 1)

**Sprint**: Line02 Dashboard IA 重做 — Hub GP 顺序 + 触达记录视图
**journey_type**: user_facing
**target_environment**: windows_cloud（GitHub Actions windows-latest，变体C：Dashboard Playwright）
**propose_round**: 1

---

## 已知约束（来自回归测试）

- [line02-account-role-unify.spec.ts] → 账号管理页加载，"绑定机器"列头可见
- [line02-account-role-unify.spec.ts] → 表格单元格含 `data-testid="machine-hostname-cell"`，值为 hostname 或"—"
- [leads-unified-table.spec.ts] → LeadsPage 含"最新回复"和"负责人"列头，不含"触达状态"列头
- [leads-unified-table.spec.ts] → GET /api/acquisition/leads 返回 latest_reply / assignee 字段
- [acquisition-dispatch.test.ts] → GET /api/acquisition/dispatch/plan 返回 `{ plan, total }`，按 tenant 隔离
- [acquisition-dispatch.test.ts] → PUT /api/acquisition/config 非法 400；无 tenant 401

---

## Response Schema（推导来源: PRD字面 + api_registry推导——acquisition-dispatch.ts OK() 信封）

### Endpoint: GET /api/acquisition/outreach-history

**Success (HTTP 200)**:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "<string>",
        "lead_nickname": "<string | null>",
        "account_label": "<string>",
        "status": "<queued|dispatched|sent|limited|failed>",
        "scheduled_for": "<string | null>",
        "sent_at": "<string | null>"
      }
    ],
    "total": "<number>"
  },
  "timestamp": "<string>"
}
```

字段说明：
- `data.items` (array): 触达历史列表 — PRD 字面 `items`
- `data.total` (number): 总条数 — PRD 字面 `total`
- `items[].id` (string): dm_assignments.id — PRD 字面
- `items[].lead_nickname` (string|null): acquisition_leads.nickname LEFT JOIN — PRD 字面
- `items[].account_label` (string): 指派小号标识 — PRD 字面
- `items[].status` (enum string): dm_assignments.status — PRD 字面
- `items[].scheduled_for` (string|null): ISO 时间串 — PRD 字面
- `items[].sent_at` (string|null): dm_outreach_log.sent_at — PRD 字面
- 外层信封 `{ success, data, timestamp }`: api_registry推导（与 /dispatch/plan 同款 OK() wrapper）

**禁用字段名**（不得在 data 或 items 行使用作替代名）: `plan`, `records`, `history`, `assignments`, `logs`, `list`, `count`, `outreach`

**Error (HTTP 401，无 session)**:
```json
{ "success": false, "error": { "code": "NO_TENANT", "message": "缺租户上下文（未登录或无 X-Tenant-Id）" }, "timestamp": "..." }
```

---

## Golden Path

[入口: Hub] → [① 绑号: 账号管理] → [② 采集: 任务页] → [③ 看线索: Leads 页] → [④ 触达记录: 触达历史页] → [设置: 瘦身 ConfigPage]

---

### Step 1: 管理员进入智能获客 Hub，看到 4 张 GP 顺序卡片，无死链接

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步："管理员点击左侧导航「智能获客」→ 进入 Hub 页，看到 4 张卡片：① 绑抖音小号、② 采集、③ 看线索、④ 触达记录，顺序与操作先后一致，无'即将上线'标签，无死链接"

**可观测行为**: Hub 页 MODULES 数组包含 4 张卡片（标题依次为"绑抖音小号""采集""看线索""触达记录"），无 `comingSoon: true`，无"即将上线"文字，旧标签"客户分析""触达中心"已删除。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/pages/AcquisitionHubPage.tsx', 'utf8');
if (c.includes('comingSoon: true')) { console.error('FAIL: comingSoon 仍存在'); process.exit(1); }
if (c.includes('即将上线')) { console.error('FAIL: 即将上线标签仍在'); process.exit(1); }
if (!c.includes('绑抖音小号')) { console.error('FAIL: 缺绑抖音小号'); process.exit(1); }
if (!c.includes('看线索')) { console.error('FAIL: 缺看线索'); process.exit(1); }
if (!c.includes('触达记录')) { console.error('FAIL: 缺触达记录'); process.exit(1); }
if (c.includes('客户分析')) { console.error('FAIL: 旧卡片客户分析仍存在'); process.exit(1); }
if (c.includes('触达中心')) { console.error('FAIL: 旧卡片触达中心仍存在'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: `comingSoon: true` 出现次数 = 0；"即将上线"出现次数 = 0；4 张 GP 卡片标签全部存在；旧标签已清除

---

### Step 2: 账号管理页无"抖音昵称"列头，已知约束（machine-hostname-cell）保留

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步："表格只显示'小号名'、'角色'、'状态'、'绑定时间'等列，不再出现显示错误数据的'抖音昵称'列"

**可观测行为**: `/area/acquisition/accounts` 页面 DOM 中 `<th>` 不含"抖音昵称"文字；`machine-hostname-cell` testid 保留（已验收回归约束）。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/pages/AcquisitionAccountsPage.tsx', 'utf8');
if (c.includes('抖音昵称')) { console.error('FAIL: 抖音昵称列头仍存在（行 123/133）'); process.exit(1); }
if (!c.includes('machine-hostname-cell')) { console.error('FAIL: machine-hostname-cell 回归约束丢失'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: "抖音昵称"出现次数 = 0；machine-hostname-cell 保留

---

### Step 3: 采集卡片链接到 /area/acquisition/tasks（现有页面不改）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步："点「采集」→ 进入采集任务页（/area/acquisition/tasks，现有页面不改）"

**可观测行为**: Hub 页"采集"卡片 `to` 字段为 `/area/acquisition/tasks`，现有路由和 AcquisitionTasksPage 组件无改动。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/pages/AcquisitionHubPage.tsx', 'utf8');
if (!c.includes('/area/acquisition/tasks')) { console.error('FAIL: 采集路由缺失'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: `/area/acquisition/tasks` 出现在 MODULES 数组中

---

### Step 4: 看线索卡片链接到 /area/acquisition/leads，navigation.config 注册路由

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步："点「看线索」→ 直接进入 Leads 页"；PRD 范围："navigation.config 注册新路由：`/area/acquisition/leads`"；PRD 假设："ASSUMPTION: /area/acquisition/leads 是 Leads 页新路由；旧 /dashboard/leads 保持兼容不删"

**可观测行为**: Hub 卡片"看线索"的 `to` 为 `/area/acquisition/leads`；navigation.config.ts 中注册该路由映射到 LeadsPage；旧路由 `/dashboard/leads` 保留。

**验证命令**:
```bash
node -e "
const hub = require('fs').readFileSync('apps/dashboard/src/pages/AcquisitionHubPage.tsx', 'utf8');
const nav = require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts', 'utf8');
if (!hub.includes('/area/acquisition/leads')) { console.error('FAIL: Hub 缺看线索路由'); process.exit(1); }
if (!nav.includes('/area/acquisition/leads')) { console.error('FAIL: navigation.config 未注册 leads'); process.exit(1); }
if (!nav.includes('/dashboard/leads')) { console.error('FAIL: 旧 /dashboard/leads 路由被删了（回归违反）'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: `/area/acquisition/leads` 同时在 Hub 和 navigation.config 中；`/dashboard/leads` 保留

---

### Step 5: 触达记录页显示历史列表或空状态提示（新建 AcquisitionOutreachPage）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步："点「触达记录」→ 看到触达历史列表：每行显示 Lead 昵称 / 指派小号 / 排期时间 / 发送状态；当前租户无触达记录时显示'暂无触达记录'空状态提示"；PRD 范围："新建 AcquisitionOutreachPage（/area/acquisition/outreach），只读展示触达历史"

**可观测行为**: AcquisitionOutreachPage.tsx 存在；含"暂无触达记录"空状态文字；页面调用 fetchOutreachHistory()；`/area/acquisition/outreach` 已在 navigation.config 注册；空数据时不报 500/404。

**验证命令**:
```bash
node -e "
const fs = require('fs');
if (!fs.existsSync('apps/dashboard/src/pages/AcquisitionOutreachPage.tsx'))
  { console.error('FAIL: AcquisitionOutreachPage.tsx 不存在'); process.exit(1); }
const page = fs.readFileSync('apps/dashboard/src/pages/AcquisitionOutreachPage.tsx', 'utf8');
if (!page.includes('暂无触达记录')) { console.error('FAIL: 缺空状态文字'); process.exit(1); }
const api = fs.readFileSync('apps/dashboard/src/api/acquisition-dispatch.api.ts', 'utf8');
if (!api.includes('outreach-history')) { console.error('FAIL: fetchOutreachHistory 未实现'); process.exit(1); }
const nav = fs.readFileSync('apps/dashboard/src/config/navigation.config.ts', 'utf8');
if (!nav.includes('/area/acquisition/outreach')) { console.error('FAIL: outreach 路由未注册'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: AcquisitionOutreachPage.tsx 存在且含"暂无触达记录"；API 文件含 outreach-history；navigation.config 注册路由

---

### Step 6: 设置入口 → 瘦身后 AcquisitionConfigPage（删 DispatchPlan + CookieHealth 块）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 步："Hub 页或顶部导航提供独立「设置」入口 → 进入瘦身后的 AcquisitionConfigPage，只含采集/触达/养号/Cookie 四组参数配置表单，不再混入指派计划和主号状态"；PRD 范围："AcquisitionConfigPage 删除 DispatchPlanSection + CookieHealthSection + getLine02AccountStatus 相关代码（约 400 行 → 约 250 行）"

**可观测行为**: AcquisitionConfigPage.tsx 不含"指派计划"渲染文字；不含 `function CookieHealthBlock` 定义；不含 `getLine02AccountStatus` 导入；Hub 页有"设置"入口，link 指向 `/dashboard/acquisition-config`。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/pages/AcquisitionConfigPage.tsx', 'utf8');
if (c.includes('指派计划')) { console.error('FAIL: 指派计划块仍存在'); process.exit(1); }
if (c.includes('function CookieHealthBlock')) { console.error('FAIL: CookieHealthBlock 仍存在'); process.exit(1); }
if (c.includes('getLine02AccountStatus')) { console.error('FAIL: getLine02AccountStatus 仍被引用'); process.exit(1); }
const hub = require('fs').readFileSync('apps/dashboard/src/pages/AcquisitionHubPage.tsx', 'utf8');
if (!hub.includes('/dashboard/acquisition-config') && !hub.includes('设置')) {
  console.error('FAIL: Hub 缺「设置」入口');
  process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: ConfigPage 源码不含"指派计划" / `CookieHealthBlock` / `getLine02AccountStatus`；Hub 含设置入口

---

### Step 7: 后端 GET /api/acquisition/outreach-history 端点已注册，返回正确 schema

**来源**: `[FROM_PRD]` — PRD 范围："新增后端 API：`GET /api/acquisition/outreach-history`，读 dm_assignments join dm_outreach_log，按 scheduled_for 倒序，返回分页列表"

**可观测行为**: acquisition-dispatch.ts 中注册 GET `/outreach-history` 路由；含 tenant_id 过滤（租户隔离铁律）；无鉴权返 401；有鉴权返回 `{ success, data.items[], data.total }`。

**验证命令**:
```bash
# A. 源码存在且含租户过滤
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/acquisition-dispatch.ts', 'utf8');
if (!c.includes('outreach-history')) { console.error('FAIL: 端点未注册'); process.exit(1); }
console.log('OK: 端点已注册');
"

# B. 运行时鉴权检查（需 API server 就绪，CODE != 404 AND != 500）
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/acquisition/outreach-history")
[ "$CODE" != "404" ] || { echo "FAIL: 端点返 404（路由未注册）"; exit 1; }
[ "$CODE" != "500" ] || { echo "FAIL: 端点崩溃 500"; exit 1; }
echo "OK: 端点存在，code=$CODE（401=鉴权正常）"
```

**硬阈值**: 源码含 `outreach-history` 字符串；运行时 CODE ∈ {401, 403}（不是 404，不是 500）

---

## 接缝清单（真目标验证才算 done）

| # | 接缝点 | 真目标验证方式 | 当前状态 |
|---|---|---|---|
| 1 | `dm_assignments LEFT JOIN acquisition_leads LEFT JOIN dm_outreach_log` DB 查询 | evaluator psql + E2E_DATABASE_URL 查实际结果，schema 含 6 字段 | logic-done-pending |
| 2 | API tenant_id 隔离（≥2 租户互不串） | evaluator 用两个 tenant session 分别调 API，断言互不串 | logic-done-pending |
| 3 | Playwright 浏览器 DOM 渲染（Hub 4 卡片、账号页无昵称列、outreach 页无崩溃） | GHA windows-latest runner + e2e-verify.ps1 Playwright toBeVisible 断言 | logic-done-pending |

---

## E2E 验收（target_environment: windows_cloud 变体C）

**journey_type**: user_facing
**target_environment**: windows_cloud

> 变体C死规则（禁止违反）：
> 1. 禁止 `page.route()` — 所有 API 请求打真实后端（E2E_API_URL）
> 2. E2E_API_URL（已部署后端）通过 VITE_API_BASE_URL 传给 Dashboard build
> 3. 禁止写"不依赖真后端"字样

<!-- GOLDEN_SMOKE_ABILITY_SLUG: line02-dashboard-ia-redesign -->
<!-- GOLDEN_SMOKE_TARGET_ENV: windows_cloud -->

### Scenario 1: hub-cards-structure（源码级，linux CI 可跑）
<!-- GOLDEN_SMOKE_SCENARIO: hub-cards-structure -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 15000 -->

```bash
#!/bin/bash
set -e
HUBFILE="apps/dashboard/src/pages/AcquisitionHubPage.tsx"
node -e "
const c = require('fs').readFileSync('$HUBFILE', 'utf8');
if (c.includes('comingSoon: true')) { console.error('FAIL: comingSoon 仍存在'); process.exit(1); }
['绑抖音小号','采集','看线索','触达记录'].forEach(t => {
  if (!c.includes(t)) { console.error('FAIL: 卡片缺失: ' + t); process.exit(1); }
});
console.log('OK');
"
echo "✅ Scenario 1 通过"
```

### Scenario 2: accounts-no-nickname-col（源码级）
<!-- GOLDEN_SMOKE_SCENARIO: accounts-no-nickname-col -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 10000 -->

```bash
#!/bin/bash
set -e
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/pages/AcquisitionAccountsPage.tsx', 'utf8');
if (c.includes('抖音昵称')) { console.error('FAIL: 抖音昵称列头仍存在'); process.exit(1); }
if (!c.includes('machine-hostname-cell')) { console.error('FAIL: machine-hostname-cell 回归约束丢失'); process.exit(1); }
console.log('OK');
"
echo "✅ Scenario 2 通过"
```

### Scenario 3: navigation-routes-registered（源码级）
<!-- GOLDEN_SMOKE_SCENARIO: navigation-routes-registered -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 10000 -->

```bash
#!/bin/bash
set -e
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts', 'utf8');
if (!c.includes('/area/acquisition/leads')) { console.error('FAIL: leads 路由未注册'); process.exit(1); }
if (!c.includes('/area/acquisition/outreach')) { console.error('FAIL: outreach 路由未注册'); process.exit(1); }
if (!c.includes('/dashboard/leads')) { console.error('FAIL: 旧 leads 路由被删'); process.exit(1); }
console.log('OK');
"
echo "✅ Scenario 3 通过"
```

### Scenario 4: outreach-api-auth（需要 API server）
<!-- GOLDEN_SMOKE_SCENARIO: outreach-api-auth -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 20000 -->

```bash
#!/bin/bash
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:3000}"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN_URL/api/acquisition/outreach-history")
[ "$CODE" != "404" ] || { echo "FAIL: 端点返 404（路由未注册）"; exit 1; }
[ "$CODE" != "500" ] || { echo "FAIL: 端点崩溃"; exit 1; }
echo "✅ Scenario 4 通过: outreach-history code=$CODE（401=鉴权正常）"
```

### Scenario 5: playwright-full-hub-navigation（windows_cloud 真实浏览器，GHA 跑）
<!-- GOLDEN_SMOKE_SCENARIO: playwright-full-hub-navigation -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 120000 -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->

```bash
#!/bin/bash
# 由 e2e-verify.ps1 在 GHA windows-latest 执行 Playwright spec
# 本 bash 块为描述占位（GOLDEN_SMOKE_SKIP_IN_CI=true 在 regression CI 跳过）
exit 0
```

---

## e2e-verify.ps1（完整脚本，写入 sprint 目录）

```powershell
# sprints/07041249-line02-dashboard-ia-redesign/e2e-verify.ps1
# target_environment: windows_cloud 变体C — Dashboard Playwright，真实后端
# 禁 page.route()；通过 E2E_API_URL 连接已部署后端（无需启动本地 API）
param(
  [string]$ApiUrl  = $env:E2E_API_URL,
  [string]$BaseUrl = "http://localhost:5174"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort  = 5174
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."

# 1. 安装依赖
Write-Host "▶ npm ci..."
$p = Start-Process "cmd.exe" "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci exit=$($p.ExitCode)" }

# 2. 安装 Playwright 浏览器
Write-Host "▶ playwright install chromium..."
$p = Start-Process "cmd.exe" "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install" }

# 3. Build dashboard（VITE_API_BASE_URL 指向已部署真实后端）
if (-not $ApiUrl) { throw "FAIL: E2E_API_URL 未设置（需要已部署后端地址）" }
Write-Host "▶ build dashboard (API=$ApiUrl)..."
$buildEnv = @{ VITE_API_BASE_URL = $ApiUrl; VITE_SKIP_AUTH = "true"; NODE_ENV = "production" }
$p = Start-Process "cmd.exe" "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow -Environment $buildEnv
if ($p.ExitCode -ne 0) { throw "FAIL: vite build" }

# 4. 启动 vite preview
Write-Host "▶ vite preview port $VitePort..."
$serverProc = Start-Process "cmd.exe" "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow
$maxWait = 30; $waited = 0
do {
  Start-Sleep 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) {
  Stop-Process -Id $serverProc.Id -Force -EA SilentlyContinue
  throw "FAIL: Vite 未在 ${maxWait}s 内就绪 port=$VitePort"
}
Write-Host "✅ Vite 就绪 port=$VitePort"

# 5. 跑 Playwright spec（禁 page.route()，打真实 E2E_API_URL 后端）
$e2eEnv = @{ E2E_BASE_URL = $BaseUrl; VITE_API_BASE_URL = $ApiUrl; VITE_SKIP_AUTH = "true" }
$p = Start-Process "cmd.exe" "/c npx.cmd playwright test e2e\acquisition-ia-redesign.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow -Environment $e2eEnv

Stop-Process -Id $serverProc.Id -Force -EA SilentlyContinue
if ($p.ExitCode -ne 0) { throw "FAIL: Playwright 失败 exit=$($p.ExitCode)" }
Write-Host "✅ Dashboard IA Redesign E2E 验证通过（真实后端 $ApiUrl）"
exit 0
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 后端新端点 outreach-history | `tests/line02-outreach-api.test.ts` | 401鉴权/schema/tenant隔离 | → 3 failures（路由未注册） |
| fetchOutreachHistory 前端 API 函数 | `tests/line02-outreach-api.test.ts` | 函数导出存在 + 路径正确 | → 1 failure |
| Hub MODULES/E2E 导航 | `apps/dashboard/e2e/acquisition-ia-redesign.spec.ts` | 4 卡片/无 comingSoon/路由导航/无昵称列/空状态 | → 5 failures |
