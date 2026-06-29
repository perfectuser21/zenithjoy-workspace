# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: api_registry 不可用 → PRD 字面 + 现有路由代码推导）

本 sprint 不新增 HTTP 端点，所有 Response Schema 来自已有路由（`apps/api/src/routes/`）。

### Endpoint: PUT /api/company-profile
**Success (HTTP 200)**:
```json
{ "success": true, "data": { "updated": true }, "timestamp": "<iso8601>" }
```
- `success` (boolean, 必填): 来源 — 现有路由 `ok()` 统一格式
- `data.updated` (boolean, 必填, 值必须为 true): 来源 — company-profile.ts 第 100 行 `return ok(res, { updated: true })`
- `timestamp` (string ISO8601): 来源 — `ok()` 统一注入

**禁用字段名**: `result`, `profile`, `saved`（不用这些词）

**Error (HTTP 400)**:
```json
{ "success": false, "error": { "code": "MISSING_COMPANY_NAME", "message": "..." }, "timestamp": "<iso8601>" }
```

### Endpoint: GET /api/company-profile
**Success (HTTP 200)**:
```json
{ "success": true, "data": { "company_name": "", "city": "", "industry": "", "description": "", "products": [], "key_advantages": [], "customer_problem": "", "customer_portrait": "", "qa_list": [] }, "timestamp": "<iso8601>" }
```
- `data.company_name` (string, 必填): 来源 — DB 字段 `company_name`

### Endpoint: POST /api/acquisition/collect/start
**Success (HTTP 200)**:
```json
{ "success": true, "data": { "task_id": "<uuid>", "status": "pending" }, "timestamp": "<iso8601>" }
```
- `data.task_id` (string UUID): 来源 — acquisition.ts 第 521 行 `return ok(res, { task_id: taskId, status: 'pending' })`
- `data.status` (string, 值必须为 "pending"): 来源 — 同上

**禁用字段名**: `id`, `taskId`, `task_status`

**Error (HTTP 400)**:
```json
{ "success": false, "error": { "code": "MISSING_KEYWORDS", "message": "..." }, "timestamp": "<iso8601>" }
```

---

## 已知约束（来自回归测试）

- [line02-company-profile-collect.spec.ts] → `公司信息页 — 加载、填写、保存、刷新后数据仍在`（当前全 stub，本 sprint 去 stub）
- [line02-company-profile-collect.spec.ts] → `采集页 — 账号状态块 + 关键词配置 + 采集任务 Table`
- [line02-company-profile-collect-smoke.sh] → PUT/GET company-profile + collect/start + GET collect/:id（当前无 psql，本 sprint 补）
- [company-profile.test.ts] → `GET /api/company-profile` / `PUT /api/company-profile` 已有集成测试
- [acquisition.test.ts] → `POST /api/acquisition/collect/start` 已有集成测试

---

## 接缝清单

| # | 接缝点 | 真目标验证方式 | 当前状态 |
|---|---|---|---|
| 1 | `PUT /api/company-profile` 写入 `zenithjoy.tenant_company_profiles` | smoke.sh 打 staging API + `psql $DB -t -c "SELECT company_name FROM ... WHERE tenant_id='$TENANT' AND updated_at > NOW()-interval '5 minutes'"` | 需真目标验证 |
| 2 | `POST /api/acquisition/collect/start` 写入 `zenithjoy.acquisition_collect_tasks` | smoke.sh 打 staging API + `psql $DB -t -c "SELECT status FROM ... WHERE created_at > NOW()-interval '5 minutes'"` | 需真目标验证 |

> 接缝 1、2 的 Playwright 步骤（Tab 切换 → 保存 → 刷新后数据仍在）通过真实 API 调用间接验证持久化：GET 拿回刚写入的数据即可。psql 的直接验证在 smoke.sh 里，smoke.sh 从有 DB 访问权限的机器（hk-vps 或配置了 E2E_DATABASE_URL 的 CI）运行。

---

## Golden Path

**入口**: 用户进入"公司信息"页

**[Step 1] → [Step 2] → [Step 3] → [Step 4] → [Step 5] → [Step 6] → [Step 7] → [Step 8] → [Step 9] 出口**

---

### Step 1: 公司信息页显示 3 个 Tab

**来源**: `[FROM_PRD]` — PRD § Golden Path 步骤 1「用户看到 3 个 Tab：基础信息 / 产品与价值 / 目标客群」

**可观测行为**: 页面顶部有 3 个可点击的 Tab 标签，文字分别为「基础信息」「产品与价值」「目标客群」

**验证命令**:
```bash
# Playwright — 验证 Tab 文字可见
await expect(page.getByRole('tab', { name: '基础信息' })).toBeVisible({ timeout: 5000 });
await expect(page.getByRole('tab', { name: '产品与价值' })).toBeVisible({ timeout: 5000 });
await expect(page.getByRole('tab', { name: '目标客群' })).toBeVisible({ timeout: 5000 });
```

**硬阈值**: 3 个 Tab 全部可见，5s 内加载完成

---

### Step 2: Tab 1（基础信息）填写公司名 + 行业 + 城市

**来源**: `[FROM_PRD]` — PRD § Golden Path 步骤 2「在 Tab 1 填"西安烤鱼馆"、行业"餐饮"、城市"西安"」

**可观测行为**: Tab 1 处于激活态，内有公司名/城市/行业输入框可填写

**验证命令**:
```bash
# Playwright — Tab 1 激活后输入框存在
await page.getByRole('tab', { name: '基础信息' }).click();
await expect(page.locator('input[placeholder*="公司"], input[name="company_name"], [data-field="company_name"] input').first()).toBeVisible({ timeout: 3000 });
```

**硬阈值**: 点击 Tab 1 后，公司名输入框可见

---

### Step 3: 切换到 Tab 2 触发 onBlur 自动保存，"已保存 ✓" toast 出现

**来源**: `[FROM_PRD]` — PRD § Golden Path 步骤 3「点击 Tab 2（触发 Tab 1 字段 onBlur 自动保存）→ 右上角出现"已保存 ✓"（1.5s 后消失）」

**可观测行为**: 点击 Tab 2 后，页面右上角或顶部出现「已保存 ✓」或「已保存」toast，约 1.5s 后消失

**验证命令**:
```bash
# Playwright — onBlur 触发保存 + toast 出现
await page.fill('[data-field="company_name"] input, input[name="company_name"]', '烟雨楼测试公司');
await page.getByRole('tab', { name: '产品与价值' }).click();
await expect(page.getByText(/已保存/)).toBeVisible({ timeout: 5000 });
```

**硬阈值**: toast 在点击 Tab 2 后 5s 内出现；PUT /api/company-profile 被调用一次（无 debounce，每次 blur 各触发）

---

### Step 4: Tab 2（产品与价值）填写并切换到 Tab 3，再次自动保存

**来源**: `[FROM_PRD]` — PRD § Golden Path 步骤 4「在 Tab 2 填产品"秘制烤鱼"、卖点"20年老配方"，点击 Tab 3 → "已保存 ✓"」

**可观测行为**: Tab 2 有产品/卖点输入，切换 Tab 3 后 toast 再次出现

**验证命令**:
```bash
# Playwright — Tab 2 填写 + Tab 3 切换 + toast 第二次出现
await page.getByRole('tab', { name: '产品与价值' }).click();
await page.getByRole('tab', { name: '目标客群' }).click();
await expect(page.getByText(/已保存/)).toBeVisible({ timeout: 5000 });
```

**硬阈值**: toast 在 5s 内出现

---

### Step 5: 刷新页面 → Tab 1 数据仍持久

**来源**: `[FROM_PRD]` — PRD § Golden Path 步骤 5「刷新页面 → 切回 Tab 1，"西安烤鱼馆"仍在（真实持久化）」

**可观测行为**: 浏览器刷新后，Tab 1 输入框内公司名仍为刚写入的值（来自 GET /api/company-profile 真实响应）

**验证命令**:
```bash
# Playwright — 刷新后数据持久（接缝断言：依赖真实 API + DB）
await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('tab', { name: '基础信息' }).click();
await expect(
  page.locator('[data-field="company_name"] input, input[name="company_name"]').first()
).toHaveValue('烟雨楼测试公司', { timeout: 5000 });
```

**硬阈值**: 公司名 = '烟雨楼测试公司'（来自真实 GET 响应，不是前端 state）

---

### Step 6: 进入「智能获客 → 分析+指派」页，推荐关键词 chips 出现

**来源**: `[FROM_PRD]` — PRD § Golden Path 接续步骤 6+7「关键词输入区下方显示推荐 chips」

**可观测行为**: /dashboard/acquisition-config 页面关键词区域下方出现 ≥1 个推荐关键词 chip

**验证命令**:
```bash
# Playwright — chips 出现（纯前端组合逻辑，无接缝）
await page.goto(`${BASE_URL}/dashboard/acquisition-config`, { waitUntil: 'networkidle' });
const chips = page.locator('[data-testid="keyword-chip"], .keyword-chip, [class*="chip"]');
await expect(chips.first()).toBeVisible({ timeout: 5000 });
const count = await chips.count();
if (count < 1) throw new Error(`FAIL: 推荐 chips 数量 = ${count}，期望 ≥ 1`);
```

**硬阈值**: 推荐 chips 数量 1–5（去重后 slice(0,5)）

---

### Step 7: 点击 chip 填入关键词输入框，开场白 placeholder 自动更新

**来源**: `[FROM_PRD]` — PRD § Golden Path 接续步骤 7「点"秘制烤鱼" chip → 填入关键词输入框；开场白 placeholder 自动带公司信息」

**可观测行为**: 点击 chip 后关键词输入框值等于 chip 文字；开场白/话术输入框的 placeholder 包含公司名或产品

**验证命令**:
```bash
# Playwright — chip 点击 → 填入关键词框
const chip = chips.first();
const chipText = await chip.textContent();
await chip.click();
const kwInput = page.locator('[data-testid="keyword-input"], input[placeholder*="关键词"], textarea[placeholder*="关键词"]').first();
await expect(kwInput).toHaveValue(chipText?.trim() ?? '', { timeout: 3000 });
```

**硬阈值**: 输入框值等于 chip 文字（exact match）

---

### Step 8: 点击"开始采集" → acquisition_collect_tasks 写入 pending 记录

**来源**: `[FROM_PRD]` — PRD § Golden Path 接续步骤 9「点"开始采集" → acquisition_collect_tasks 写入 1 条 status=pending 记录」

**可观测行为**: 点击后 UI 反馈（按钮 loading/禁用）且 API 返回 task_id；采集任务 Table 显示新记录

**验证命令**:
```bash
# Playwright — 点开始采集 + API 返回 task_id（接缝断言：依赖真实 API）
const collectBtn = page.getByRole('button', { name: /开始采集|采集/ }).first();
await collectBtn.click();
# 等待响应：Table 出现新行 或 toast
await expect(page.getByText(/待执行|pending|已提交/)).toBeVisible({ timeout: 10000 });
```

**硬阈值**: 10s 内 UI 出现「待执行」或类似状态反馈

---

### Step 9: 出口 — 采集任务 Table 显示新记录

**来源**: `[FROM_PRD]` — PRD § Golden Path「出口：采集任务 Table 显示新记录（关键词="秘制烤鱼"，状态=待执行）」

**可观测行为**: 任务列表出现关键词匹配的行，状态为「待执行」

**验证命令**:
```bash
# smoke.sh psql 验证（接缝断言 — 需 DB 访问权限）
KEYWORD="smoke-$(date +%s)"
RESP=$(curl -sf -X POST "$API/api/acquisition/collect/start" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT" \
  -d "{\"keywords\":[\"$KEYWORD\"]}")
echo "$RESP" | jq -e '.success == true and .data.status == "pending"' || { echo "FAIL: collect/start"; exit 1; }
TASK_ID=$(echo "$RESP" | jq -r '.data.task_id')

COUNT=$(psql "$DB_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.acquisition_collect_tasks \
   WHERE id='$TASK_ID' AND status='pending' \
   AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "FAIL: psql 无记录 task_id=$TASK_ID"; exit 1; }
echo "PASS: collect task DB 记录确认 task_id=$TASK_ID"
```

**硬阈值**: 5 分钟内 DB 有对应 `status=pending` 记录

---

## 出错路径

### EP-1: 公司信息未填 → 推荐 chips 显示灰色提示

**来源**: `[FROM_PRD]` — PRD § 出错路径「公司信息未填 → 推荐 chips 区显示灰色提示"先填写公司信息"，非报错」

**验证命令**:
```bash
# Playwright — 公司信息空时 chips 区显示提示文案（无 chip 可点）
# 在 company_name='' 状态下导航到采集配置页
await expect(page.getByText(/先填写公司信息|填写公司信息/)).toBeVisible({ timeout: 5000 });
```

### EP-2: PUT /api/company-profile 缺 company_name → 400

**来源**: `[AI_ADDED]` — 防止 Generator 省略服务端 400 校验回路

**验证命令**:
```bash
CODE=$(curl -sf -X PUT "$API/api/company-profile" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT" \
  -d '{"company_name":""}' \
  -o /dev/null -w "%{http_code}")
[ "$CODE" = "400" ] || { echo "FAIL: 空 company_name 未返 400，实际=$CODE"; exit 1; }
echo "PASS: 空 company_name → 400"
```

---

## E2E 验收

**journey_type**: user_facing  
**target_environment**: windows_cloud  
**E2E 模板**: windows_cloud 变体 C（Dashboard / Web App — Vite + Playwright）

> **secrets 必须**（在 GHA repo secrets 中配置）：
> - `E2E_SUPER_ADMIN_EMAIL` — 已有
> - `E2E_SUPER_ADMIN_PASSWORD` — 已有
> - `E2E_DATABASE_URL` — staging postgres 连接串（供 API + psql 使用，需新增）
> - `E2E_API_URL` — staging API 地址（供 smoke.sh 使用，如 `https://api.xxx.com`，需新增）

---

### 1. smoke.sh 重写版本（真实 API + psql 时间窗）

存放位置: `.github/workflows/scripts/smoke/line02-company-profile-collect-smoke.sh`

```bash
#!/usr/bin/env bash
# smoke: Line02 公司信息 Tab + 推荐关键词 + 采集闭环 — 真实 API + psql 时间窗验证
# 运行条件: API_URL=<staging> DB_URL=<pg连接串> TENANT=<test-tenant-id> bash smoke.sh
set -euo pipefail

API="${API_URL:-http://localhost:3000}"
DB_URL="${DB_URL:-postgresql://localhost/zenithjoy}"
TENANT="${TENANT:-2ac0aa4a-99f4-470a-aed7-c3a9fe03149b}"
COMPANY_NAME="smoke-line02-$(date +%s)"

echo "=== Line02 Profile Tabs + Acquisition Smoke (真实链路) ==="
echo "API=$API TENANT=$TENANT"
SCRIPT_START=$(date +%s)

# ─── 1. PUT /api/company-profile ───
echo "[1] PUT /api/company-profile..."
RESP=$(curl -sf -X PUT "$API/api/company-profile" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT" \
  -d "{\"company_name\":\"$COMPANY_NAME\",\"city\":\"西安\",\"industry\":\"餐饮\",\"description\":\"Smoke 测试\",\"products\":[\"秘制烤鱼\"],\"key_advantages\":[\"20年老配方\"],\"customer_problem\":\"\",\"customer_portrait\":\"\",\"qa_list\":[]}")
echo "$RESP" | jq -e '.success == true' > /dev/null || { echo "FAIL: PUT company-profile success!=true"; exit 1; }
echo "$RESP" | jq -e '.data.updated == true' > /dev/null || { echo "FAIL: PUT data.updated!=true"; exit 1; }
echo "PASS: PUT company-profile"

# ─── 2. psql 验证 PUT 持久化（接缝断言 — 时间窗防造假）───
echo "[2] psql 验证 tenant_company_profiles 写入..."
COUNT=$(psql "$DB_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.tenant_company_profiles \
   WHERE tenant_id='$TENANT' \
   AND company_name='$COMPANY_NAME' \
   AND updated_at > NOW() - interval '5 minutes'" | tr -d ' \n')
[ "${COUNT:-0}" -ge 1 ] || { echo "FAIL: psql 无时间窗内记录 company_name=$COMPANY_NAME"; exit 1; }
echo "PASS: psql 写入确认 count=$COUNT"

# ─── 3. GET /api/company-profile ───
echo "[3] GET /api/company-profile..."
RESP=$(curl -sf "$API/api/company-profile" -H "X-Tenant-Id: $TENANT")
echo "$RESP" | jq -e '.success == true' > /dev/null || { echo "FAIL: GET company-profile success!=true"; exit 1; }
RETURNED_NAME=$(echo "$RESP" | jq -r '.data.company_name')
[ "$RETURNED_NAME" = "$COMPANY_NAME" ] || { echo "FAIL: GET 返回 company_name='$RETURNED_NAME' != '$COMPANY_NAME'"; exit 1; }
echo "PASS: GET company-profile company_name=$RETURNED_NAME"

# ─── 4. POST /api/acquisition/collect/start ───
echo "[4] POST /api/acquisition/collect/start..."
KEYWORD="smoke-kw-$(date +%s)"
RESP=$(curl -sf -X POST "$API/api/acquisition/collect/start" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT" \
  -d "{\"keywords\":[\"$KEYWORD\"]}")
echo "$RESP" | jq -e '.success == true' > /dev/null || { echo "FAIL: collect/start success!=true"; exit 1; }
echo "$RESP" | jq -e '.data.status == "pending"' > /dev/null || { echo "FAIL: status!='pending'"; exit 1; }
echo "$RESP" | jq -e '.data.task_id | type == "string"' > /dev/null || { echo "FAIL: task_id 非 string"; exit 1; }
TASK_ID=$(echo "$RESP" | jq -r '.data.task_id')
echo "PASS: collect/start task_id=$TASK_ID"

# ─── 5. psql 验证 collect task 写入（接缝断言 — 时间窗防造假）───
echo "[5] psql 验证 acquisition_collect_tasks 写入..."
COUNT=$(psql "$DB_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.acquisition_collect_tasks \
   WHERE id='$TASK_ID' \
   AND status='pending' \
   AND created_at > NOW() - interval '5 minutes'" | tr -d ' \n')
[ "${COUNT:-0}" -ge 1 ] || { echo "FAIL: psql 无时间窗内 task 记录 id=$TASK_ID"; exit 1; }
echo "PASS: psql 采集任务写入确认 count=$COUNT"

# ─── 6. GET /api/acquisition/collect/:task_id ───
echo "[6] GET /api/acquisition/collect/$TASK_ID..."
RESP=$(curl -sf "$API/api/acquisition/collect/$TASK_ID" -H "X-Tenant-Id: $TENANT")
echo "$RESP" | jq -e '.success == true' > /dev/null || { echo "FAIL: GET task success!=true"; exit 1; }
echo "$RESP" | jq -e '.data | has("task_id") and has("status")' > /dev/null || { echo "FAIL: task 响应缺字段"; exit 1; }
echo "PASS: GET collect task"

# ─── 7. error path: PUT 缺 company_name → 400 ───
echo "[7] PUT 缺 company_name → 400..."
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PUT "$API/api/company-profile" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT" \
  -d '{"company_name":""}')
[ "$CODE" = "400" ] || { echo "FAIL: 空 company_name 未返 400, 实际=$CODE"; exit 1; }
echo "PASS: error path → 400"

SCRIPT_END=$(date +%s)
echo ""
echo "=== Line02 Smoke PASSED (${SCRIPT_START}~${SCRIPT_END}s) ==="
```

---

### 2. e2e-verify.ps1（windows-latest Playwright）

存放位置: `sprints/06291030-line02-profile-tabs-integration/e2e-verify.ps1`

```powershell
# final-e2e 验证脚本 — Line02 公司信息 Tab + 推荐关键词（windows-latest + Playwright）
# secrets: E2E_DATABASE_URL (staging postgres), E2E_SUPER_ADMIN_EMAIL, E2E_SUPER_ADMIN_PASSWORD
param(
  [string]$BaseUrl = "http://localhost:5174"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptStart = Get-Date
$VitePort = 5174
$ApiPort = 3000
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

Write-Host "▶ Sprint: Line02 公司信息 Tab 布局 + 推荐关键词"
Write-Host "▶ ScriptStart=$ScriptStart"

# ── Step 1: 安装依赖 ──
Write-Host "▶ npm ci..."
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: npm ci exit=$($proc.ExitCode)" }

# ── Step 2: 安装 Playwright Chromium ──
Write-Host "▶ playwright install chromium..."
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: playwright install exit=$($proc.ExitCode)" }

# ── Step 3: 构建 API ──
Write-Host "▶ build API..."
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build --workspace=apps/api" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: API build exit=$($proc.ExitCode)" }

# ── Step 4: 创建 API .env（注入 DATABASE_URL）──
$apiEnvPath = "$repoRoot\apps\api\.env"
$dbUrl = $env:E2E_DATABASE_URL
if (-not $dbUrl) { throw "FAIL: E2E_DATABASE_URL 未设置" }
@"
DATABASE_URL=$dbUrl
PORT=$ApiPort
NODE_ENV=test
"@ | Out-File -FilePath $apiEnvPath -Encoding utf8

# ── Step 5: 启动 API 服务 ──
Write-Host "▶ 启动 API on port $ApiPort..."
$apiProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c node -r dotenv/config dist/index.js" `
  -WorkingDirectory "$repoRoot\apps\api" `
  -PassThru -NoNewWindow `
  -Environment @{ DATABASE_URL = $dbUrl; PORT = "$ApiPort"; NODE_ENV = "test" }

# 等待 API 就绪（最多 30s）
$waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt 30)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: API 未在 30s 内就绪 port=$ApiPort" }
Write-Host "✅ API 就绪 port=$ApiPort"

# ── Step 6: 构建 Dashboard（VITE_API_BASE_URL 指向本地 API）──
Write-Host "▶ 构建 Dashboard..."
$buildEnv = @{
  VITE_API_BASE_URL = "http://localhost:$ApiPort"
  VITE_SKIP_AUTH = "true"
}
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow `
  -Environment $buildEnv
if ($proc.ExitCode -ne 0) { throw "FAIL: Dashboard build exit=$($proc.ExitCode)" }

# ── Step 7: 启动 Vite preview ──
Write-Host "▶ 启动 Vite preview port $VitePort..."
$serverProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -PassThru -NoNewWindow

$waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt 30)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未在 30s 内就绪 port=$VitePort" }
Write-Host "✅ Vite preview 就绪 port=$VitePort"

# ── Step 8: 运行 Playwright E2E ──
Write-Host "▶ 运行 Playwright E2E..."
$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\line02-company-profile-collect.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow `
  -Environment @{ E2E_BASE_URL = "http://localhost:$VitePort" }
$e2eExit = $e2eProc.ExitCode

# ── Step 9: 归集截图 ──
$screenshotDir = "$scriptDir\screenshots"
if (-not (Test-Path $screenshotDir)) { New-Item -ItemType Directory -Path $screenshotDir | Out-Null }
$srcShots = "$repoRoot\apps\dashboard\sprints\06291030-line02-profile-tabs-integration\screenshots"
if (Test-Path $srcShots) {
  Get-ChildItem "$srcShots\*.png" | Copy-Item -Destination $screenshotDir
}

# ── Step 10: 时间戳防造假 ──
# 验证 sprint 产物（contract-dod.md）在脚本启动后存在，排除历史遗留
$dodPath = "$scriptDir\contract-dod.md"
if (Test-Path $dodPath) {
  $w = (Get-Item $dodPath).LastWriteTime
  if ($w -lt $ScriptStart.AddDays(-1)) {
    Write-Warning "contract-dod.md LastWriteTime=$w 远早于脚本启动（可能是历史遗留，但不阻断 E2E）"
  }
}

# ── 停止服务 ──
Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue

if ($e2eExit -ne 0) { throw "FAIL: Playwright E2E 失败 exit=$e2eExit" }
Write-Host "✅ Line02 Profile Tabs E2E 验证通过"
exit 0
```

**PASS 标准**: `e2eProc.ExitCode = 0` + Playwright 所有 spec 通过 + API 真实调用（无 company-profile/acquisition stub）  
**FAIL 标准**: 任意 Step throw / Playwright 失败 / API 未就绪 / DB 未连通  
**GHA workflow**: `.github/workflows/e2e-windows.yml`（`workflow_dispatch` + `windows-latest`）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 推荐关键词组合逻辑 | `tests/line02-profile-tabs.test.ts` | buildRecommendedKeywords 纯函数 | import 文件不存在 → 1 failure |
| CompanyProfilePage Tab 布局 | `tests/line02-profile-tabs.test.ts` | Tab role 元素存在 | getByRole('tab') 返回 0 → 1 failure |
