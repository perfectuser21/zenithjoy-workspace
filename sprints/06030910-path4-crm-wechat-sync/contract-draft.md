# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: PRD字面）

### Endpoint: POST /api/crm/init
**Success (HTTP 200)**: `{"success": true, "table_id": "<string>"}`
- `success` (boolean): PRD E2E `jq -e '.success == true'`
- `table_id` (string): PRD E2E `jq -e '.table_id != null'`；create/detect 两种 mode 均返回
**禁用字段名**: `result`, `data`, `id`, `tableId`
**Error**: `{"error": "<string>"}`

### Endpoint: GET /api/crm/wechat-contacts?tenant_id=
**Success (HTTP 200)**: `{"contacts": [{"wechat_id": "<string>", "nickname": "<string>"}]}`
- `contacts` (array): PRD E2E + ASSUMPTION mock 固定 **精确 5 条**，每条含 `wechat_id` + `nickname`
**禁用字段名**: `list`, `items`, `data`, `users`
**Error**: `{"error": "<string>"}`

### Endpoint: GET /api/crm/match-preview?tenant_id=
**Success (HTTP 200)**: `{"matched": [], "pending": [], "unmatched": []}`
- `matched`/`pending`/`unmatched` (array): PRD Step 6 三类展示
**禁用字段名**: `results`, `data`, `contacts`
**Error**: `{"error": "<string>"}`

### Endpoint: POST /api/crm/daily-analysis
**Request**: `{"tenant_id": "<string>", "dry_run": boolean}`
**Success (HTTP 200)**: `{"customers": [], "webhook_sent": false}`
- `webhook_sent`: dry_run=true 时固定 false
**禁用字段名**: `result`, `data`, `contacts`, `users`, `webhookSent`
**Error**: `{"error": "<string>"}`

---

## Golden Path

### 首次接入路径
[Dashboard CrmConfigPage] → [选平台 → OAuth → 建/检测表] → [拉联系人 → AI 匹配] → [用户确认 → 写 DB]

### 日常路径
[Brain tick 8:30] → [读 CRM 表 → AI 分析 → 推飞书群 → 写回 AI 建议列]

---

### Step 1: 用户打开 Dashboard CRM 配置页，选择 CRM 平台
**来源**: `[FROM_PRD]` — PRD 首次接入 Step 1「用户在 Dashboard 点配置客户管理 → 选飞书 or Notion」

**可观测行为**: `/crm/config` 渲染 CrmConfigPage，含飞书/Notion 平台选择器，无 crash

**硬阈值**: CrmConfigPage 文件存在 + 含平台选择器逻辑

---

### Step 2a: 系统无表场景 — 调 CRM API 自动建客户明细表（mode=create）
**来源**: `[FROM_PRD]` — PRD 首次接入 Step 3「无表 → 调 CRM 平台 API 自动建表（含评级/状态/微信号/跟进时间字段）」；PRD E2E Step 1

**可观测行为**: POST /api/crm/init（mode:"create"）返回 HTTP 200 + `{success:true, table_id:"<非空>"}`

**硬阈值**: HTTP 200，success=true，table_id 非空，耗时 < 5s

---

### Step 2b: 系统有表场景 — 检测已有客户明细表，返回已有 table_id（mode=detect）
**来源**: `[FROM_PRD]` — PRD 首次接入 Step 3「有表 → 读取字段映射，返回「找到 N 条记录，是否导入」」

**可观测行为**: POST /api/crm/init（mode:"detect"）返回 HTTP 200 + `{success:true, table_id:"<已有表>"}`；中台显示字段映射预览

**硬阈值**: HTTP 200，success=true，table_id 与已有表对应

---

### Step 3: 系统拉取微信联系人列表（GET /api/crm/wechat-contacts，mock 精确 5 条）
**来源**: `[FROM_PRD]` — PRD 首次接入 Step 4「mock 返回固定 5 条」；PRD ASSUMPTION 明确

**可观测行为**: GET /api/crm/wechat-contacts?tenant_id=X 返回 `{contacts:[5条]}`，每条含 `wechat_id`（微信号）+ `nickname`（昵称）字段

**硬阈值**: contacts.length == 5（精确卡），每条对象含 wechat_id + nickname 两字段

---

### Step 4: AI 模糊匹配 → 中台展示匹配结果（GET /api/crm/match-preview）
**来源**: `[FROM_PRD]` — PRD 首次接入 Step 5-6「AI 按微信号/昵称模糊匹配；展示已匹配/待确认/未匹配」；PRD E2E Step 3

**可观测行为**: GET /api/crm/match-preview?tenant_id=X 返回 `{matched:[…], pending:[…], unmatched:[…]}`；Dashboard 渲染三类列表

**硬阈值**: matched/pending/unmatched 三字段均为数组，HTTP 200

---

### Step 5: 用户确认 → crm_wechat_mapping 写入 DB
**来源**: `[FROM_PRD]` — PRD 首次接入 Step 7「确认后写入 crm_wechat_mapping（wechat_contact_id ↔ crm_row_id ↔ platform ↔ tenant_id）」

**可观测行为**: DB migration 文件存在，定义 crm_wechat_mapping 表含 4 核心字段

**硬阈值**: migration 文件存在 + wechat_contact_id/crm_row_id/platform/tenant_id 四字段均在

---

### Step 6a: Brain tick 8:30 触发每日 AI 分析 + 飞书群推送（POST /api/crm/daily-analysis）
**来源**: `[FROM_PRD]` — PRD 日常使用 Step 1-5「Brain tick 8:30 → 读表 → AI 分析 → 排优先级 → 推飞书机器人群」；PRD E2E Step 4

**可观测行为**: POST /api/crm/daily-analysis（dry_run:true）返回 `{customers:[…], webhook_sent:false}`；服务含 FEISHU_NOTIFY_WEBHOOK 读取

**硬阈值**: customers 为数组，webhook_sent == false（dry_run），耗时 < 10s

---

### Step 6b: daily-analysis 写回 CRM 表「AI 建议」列
**来源**: `[FROM_PRD]` — PRD 日常使用 Step 6「更新 CRM 表「AI 建议」列」

**可观测行为**: daily-crm-analysis.ts 生成沟通策略后，调飞书 Bitable / Notion page update API 写回对应行 AI 建议字段（dry_run=false 时真写回）

**硬阈值**: daily-crm-analysis.ts 含 AI 建议列写回逻辑（飞书 update 或 Notion update API 调用）

---

## Risks

| 风险 | PRD 定义 | Mitigation |
|---|---|---|
| wechat_rpa 联系人拉取失败 | PRD 边界「拉取失败 → 飞书群告警 + 日志，不阻塞已有映射」 | /wechat-contacts 失败返 4xx + error 字段；不级联中断 daily-analysis |
| Notion token 过期 | PRD 边界「token 过期 → 飞书群推告警，标记 token_expired」 | notion-crm.ts 捕获 401/403 → 调 FEISHU_NOTIFY_WEBHOOK + 状态改为 token_expired |
| 有表字段映射不匹配 | PRD 边界「显示字段映射预览，用户确认后才导入」 | mode=detect 返回字段差异列表，Dashboard 展示预览，二次确认后才写 crm_wechat_mapping |
| 联系人改名/删好友 | PRD 边界「下次同步标记 contact_lost，不删已有映射」 | 同步时联系人不存在 → crm_wechat_mapping.status = contact_lost |

---

## E2E 验收（final-e2e — windows_cloud 变体 C：Dashboard + Playwright）

> **windows_cloud workflow 内容审查**（v8.1）：已读 `.github/workflows/e2e-windows.yml`，结构：workflow_dispatch → 唯一 step 执行 `${sprint_dir}/e2e-verify.ps1`
>
> **用户路径 1:1 映射检查**：
> | 用户步骤 | spec/ps1 对应 | 状态 |
> |---|---|---|
> | 打开 CRM 配置页，选飞书/Notion | `page.goto('/crm/config')` + click | ✅ |
> | POST /init mode=create（建表） | `page.route()` stub + 请求断言 | ✅ |
> | POST /init mode=detect（有表检测） | spec 含 mode=detect 分支测试 | ✅ |
> | GET /wechat-contacts（mock 5条 shape） | stub 5条含 wechat_id/nickname；`toHaveCount(5)` | ✅ |
> | 展示匹配结果三栏 | `expect().toBeVisible()` 三栏 | ✅ |
> | 用户确认写映射 | stub assertion + success toast | ✅ |
> | POST /daily-analysis dry_run=true | API 请求断言 | ✅ |
> | [CI_GAP: 真实 DB crm_wechat_mapping 写入] | windows_cloud 无 DB，验 API 请求结构 | ⚠️ mock 可接受 |
> | [CI_GAP: Brain tick 8:30 真实 cron] | 直接 POST API dry_run 验证 | ⚠️ dry_run 可接受 |
> | [CI_GAP: AI建议列真实写回 Feishu/Notion] | dry_run=false 场景无凭据，服务层单测覆盖 | ⚠️ 可接受 |

**journey_type**: user_facing / **target_environment**: windows_cloud

```powershell
# e2e-verify.ps1 — Sprint: Path 4 CRM 打通（windows_cloud 变体 C）
param(
  [string]$BaseUrl = "http://localhost:5174",
  [string]$SuperAdminEmail = $env:E2E_SUPER_ADMIN_EMAIL,
  [string]$SuperAdminPassword = $env:E2E_SUPER_ADMIN_PASSWORD
)
Set-StrictMode -Version Latest; $ErrorActionPreference = "Stop"
$VitePort = 5174; $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

$p = Start-Process "cmd.exe" "/c npm.cmd ci --prefer-offline" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci" }
$p = Start-Process "cmd.exe" "/c npx.cmd playwright install chromium --with-deps" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install" }
$p = Start-Process "cmd.exe" "/c npm.cmd run build" -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: build" }

$srv = Start-Process "cmd.exe" "/c npx.cmd vite preview --port $VitePort --host" -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow
$n = 0; do { Start-Sleep 1; $n++; $c = Test-NetConnection localhost -Port $VitePort -WarningAction SilentlyContinue } while (-not $c.TcpTestSucceeded -and $n -lt 30)
if (-not $c.TcpTestSucceeded) { throw "FAIL: Vite 未就绪" }

$e2e = Start-Process "cmd.exe" "/c npx.cmd playwright test e2e\crm-config.spec.ts --reporter=list" -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow -Environment @{ BASE_URL=$BaseUrl; E2E_EMAIL=$SuperAdminEmail; E2E_PASSWORD=$SuperAdminPassword }
Stop-Process $srv.Id -Force -ErrorAction SilentlyContinue
if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright E2E exit=$($e2e.ExitCode)" }
Write-Host "✅ windows_cloud CRM E2E 验证通过"; exit 0
```

**PASS 标准**: Playwright 所有 spec 通过 / **secrets 必须**: `E2E_SUPER_ADMIN_EMAIL`、`E2E_SUPER_ADMIN_PASSWORD`

---

## Test Contract

| 功能 | Test File | 红证据（R2 机检确认） |
|---|---|---|
| CRM 路由 schema + Dashboard | `tests/crm-routes.test.ts` | `npx vitest run sprints/06030910-path4-crm-wechat-sync/tests/ --reporter=verbose` → **2 files failed, 14 tests failed** ✅ |
| crm_wechat_mapping 迁移 | `tests/crm-migration.test.ts` | 含在上述 2 files 14 failures 中 ✅ |
| Playwright E2E + contacts shape | `apps/dashboard/e2e/crm-config.spec.ts` | 文件不存在 → playwright 运行即 FAIL ✅ |
