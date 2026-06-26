# Sprint Contract Draft (Round 1) — Line 04 CRM 客户列表页 Glide 重做（第一刀·仅列表）

> journey_type: **user_facing** ｜ target_environment: **windows_cloud**（ZenithJoy Dashboard UI，GHA windows-latest + Playwright，page.route 拦后端无 DB）
> 本刀**零后端改动**：`GET /api/crm/customers` 是既有端点（apps/api/src/routes/crm.ts:239），本刀只换前端呈现 + 加纯前端搜索/筛选/计数。

---

## Response Schema（推导来源: api_registry 为空 → 读 crm.ts 路由 + customer-roster.ts 服务的既有契约；本刀不改它）

### 消费端点（既有，不新增、不改）: `GET /api/crm/customers`
**Success (HTTP 200)**（apps/api/src/routes/crm.ts:332 实际返回 + customer-roster.ts RosterRow）:
```json
{
  "customers": [
    {
      "name": "张三",
      "contact": "张三",
      "wechat_id": "wx_001",
      "status": "A1",
      "last_contact_at": "2026-06-24T08:00:00.000Z",
      "managed": true,
      "source": "scan",
      "last_message": "你们这个多少钱",
      "add_friend_time": "2026-06-01T08:00:00.000Z",
      "identity": "customer"
    }
  ],
  "total": 2,
  "cs_wechat_id": "wx_cs_A"
}
```
- `customers[]` (array, 必填): 客户行数组；每行字段如下
  - `name` (string)·`contact` (string)·`wechat_id` (string|null)·`status` ("A1"|"A2"|"A3"|"A4"|"A5")·`last_contact_at` (string ISO|null)·`managed` (boolean)·`source` ("message"|"manual"|"scan"|"whitelist"|null)·`last_message` (string|null)·`add_friend_time` (string ISO|null)·`identity` ("customer"|"blacklist"|"internal"，internal 已被后端排除)
- `total` (number, 必填): customers.length
- `cs_wechat_id` (string|null, 必填): 本租户主客服机号（本刀不消费过滤逻辑，透传给写接口）

**禁用字段名**（前端过滤/计数禁止臆造的同义替换，须字面用上方 key）: `rating`·`is_managed`·`enabled`·`intent_level`·`tag`

**Error**: `401` → 现有 `authExpired` 降级（不白屏）；非 2xx → 现有 `error` 文案降级。本刀不新增任何 HTTP 响应（纯前端筛选）。

---

## ⚡ 接缝清单（碰真实世界的点 — 必须在真目标验，CI 绿 ≠ done）

| # | 接缝（碰真实世界处） | 真目标验证方式 | 未真验时标记 |
|---|---|---|---|
| S1 | **Glide canvas 渲染**：`@glideapps/glide-data-grid` 画到 `<canvas>`，必须 `import '@glideapps/glide-data-grid/dist/index.css'` 否则 canvas 全空白（已踩坑·PRD 边界情况） | windows_cloud Playwright：`crm-customer-grid` 容器内 `<canvas>` 存在且可见 + 截图非空白 + grid 宽高 > 0 | `logic-done-pending` |
| S2 | **canvas 单元格点击 → 跳详情路由**：Glide `onCellClicked(row,col)` 不走 DOM 行，靠 canvas 坐标命中 | windows_cloud Playwright：在 grid 首行姓名格坐标点击 → `expect(page).toHaveURL(/\/wechat\/crm\/.+/)`。**坐标必须从显式 `rowHeight`/`headerHeight`（Glide props 写定值）推导，禁止凭空写死像素**（v9.3 禁止环境假设值） | `logic-done-pending` |
| S3 | **计数 DOM 随真用户交互同步**：浏览器事件循环 + Glide 重渲染后 `crm-count` 文本变化 | windows_cloud Playwright：输入搜索词 / 点意向 chip / 点身份 chip 后断言 `crm-count` 文本数值变化 | `logic-done-pending` |

> 逻辑断言（环境无关，CI 绿 = done）：纯过滤函数 `filterCustomers()` 的搜索/意向/身份/组合/空筛选算法（见 Step 2-5 BEHAVIOR），用 vitest + jsdom 组件测验。

---

## Golden Path

[运营打开 /wechat/crm 暗色运营台] → [搜索 / 点 A1-A5 意向 chip / 点身份 chip 前端实时过滤] → [「N 位客户」计数实时同步] → [点客户名跳现有详情路由]

### Step 1: 运营打开 CRM 列表页 → 暗色运营台 + Glide 客户表渲染真数据 + 计数 = 真数据条数
**来源**: `[FROM_PRD]` — Golden Path 步骤 1 + 范围内「CustomerListPage 用 Glide Data Grid 重做暗色运营台呈现 + 接 GET /api/crm/customers 真数据替换裸 HTML 表格」

**可观测行为**: 页面加载后顶部为搜索框 + A1-A5 意向筛选条 + 身份筛选；客户表为 Glide canvas（暗色，意向色阶 A1 灰→A5 绿）；`crm-count` 显示「N 位客户」N = customers.length（>0）。

**验证命令**（接缝 S1，windows_cloud Playwright，见 ## E2E 验收）:
```javascript
await expect(page.getByTestId('crm-customer-grid')).toBeVisible();
await expect(page.getByTestId('crm-customer-grid').locator('canvas').first()).toBeVisible();
await expect(page.getByTestId('crm-count')).toContainText('2'); // = stub 的 customers.length
```
**硬阈值**: grid canvas 可见且 box.width>0 && box.height>0；`crm-count` 文本数值 = 真数据条数（>0）。
验证命令: `const box = await page.getByTestId('crm-customer-grid').locator('canvas').first().boundingBox(); if (!box || box.width<=0 || box.height<=0) throw new Error('FAIL: canvas 空白—CSS 未 import');`

---

### Step 2: 运营在搜索框输客户名/微信号 → 表格前端实时过滤 → 计数下降到匹配数
**来源**: `[FROM_PRD]` — Golden Path 步骤 2「输客户名/微信号 → 表格实时前端过滤 → 计数下降到匹配数」

**可观测行为**: 在 `crm-search-input` 输入子串（匹配 name 或 wechat_id，大小写不敏感）→ grid 只剩匹配行 → `crm-count` 数值降到匹配数。

**验证命令**（逻辑层 vitest — 纯函数；接缝层 S3 Playwright 计数）:
```bash
# 逻辑断言（环境无关）
cd apps/dashboard && npx vitest run src/pages/crm/__tests__/customerFilter.test.ts -t "搜索"
```
```javascript
// 接缝断言（windows_cloud）
await page.getByTestId('crm-search-input').fill('张三');
await expect(page.getByTestId('crm-count')).toContainText('1');
```
**硬阈值**: 搜索 "张三"（数据 2 行仅 1 行含）→ count 文本 = 1；搜索大写微信号子串仍命中（大小写不敏感）。

---

### Step 3: 运营点 A4 意向 chip → 只剩该意向客户 → 计数变该意向数；叠加身份 chip → 计数相应变化
**来源**: `[FROM_PRD]` — Golden Path 步骤 3「点 A4 意向 chip → 表格只剩该意向客户 → 计数变为该意向客户数；再点身份筛选叠加 → 计数相应变化」

**可观测行为**: 点 `crm-intent-chip[data-intent="A4"]` → grid 仅 status==A4 行；点身份 chip 与意向/搜索 **AND** 叠加；再点同 chip 取消该筛选（空筛选 = 全部）。

**验证命令**（逻辑层 vitest + 接缝层 Playwright）:
```bash
cd apps/dashboard && npx vitest run src/pages/crm/__tests__/customerFilter.test.ts -t "意向"
cd apps/dashboard && npx vitest run src/pages/crm/__tests__/customerFilter.test.ts -t "身份"
```
```javascript
await page.getByTestId('crm-intent-chip').filter({ has: page.locator('[data-intent="A1"]') }).click();
await expect(page.getByTestId('crm-count')).toContainText('1'); // stub 2 行中 1 行 A1
```
**硬阈值**: 点单意向 chip → count = 该意向行数；意向∩身份∩搜索 = AND 交集；取消所有 chip → count 回到全量。

---

### Step 4: 运营点客户名 → 跳现有详情页路由（详情重做在第二刀，本刀只跳）
**来源**: `[FROM_PRD]` — Golden Path 步骤 4「点客户名 → 跳现有详情页路由」+ 假设「详情路由保持不变」（既有 `navigate('/wechat/crm/:contact')`）

**可观测行为**: 点 Glide grid 首行姓名格 → `navigate` 到 `/wechat/crm/<encodeURIComponent(contact)>`（沿用现有 CustomerListPage.openProfile 路由契约）。

**验证命令**（接缝 S2，windows_cloud Playwright）:
```javascript
const box = await page.getByTestId('crm-customer-grid').locator('canvas').first().boundingBox();
// 坐标从 Glide 显式 headerHeight/rowHeight props 推导（generator 必须把这两值写定，不靠默认猜）
await page.mouse.click(box.x + 80, box.y + HEADER_H + ROW_H * 0.5);
await expect(page).toHaveURL(/\/wechat\/crm\/.+/);
```
**硬阈值**: 点首行姓名格 → URL 命中 `/wechat/crm/<contact>`。

---

### Step N（出口/边界）: 空数据 / 401 不白屏
**来源**: `[AI_ADDED]` — PRD「边界情况」段（401 降级保留 / 空数据计数 0 容器仍在），codify 成可机检断言防 generator 改 Glide 时把降级路径改丢。理由：换渲染层最易回归掉错误降级，列为硬条款。

**可观测行为**: `customers:[]` → `crm-count` = 0 且 `crm-empty` 容器在、不抛错；`GET /customers` 401 → `crm-auth-expired` 可见、不白屏。

**验证命令**:
```bash
cd apps/dashboard && npx vitest run src/pages/__tests__/CustomerListPage.test.tsx -t "空数据"
cd apps/dashboard && npx vitest run src/pages/__tests__/CustomerListPage.test.tsx -t "401"
```
**硬阈值**: 空数据 count=0 + crm-empty 存在 + 无 throw；401 → crm-auth-expired 可见。

---

## 已知约束（来自回归测试）

- [apps/dashboard/e2e/crm-customer-list.spec.ts] 列表 2 行 6 列（姓名/微信号/加微信时间/意向/最近联系/身份）、身份下拉改黑名单调 PUT /identity、状态下拉 A3 刷新仍 A3、onboarding 状态条 5 步、三层下钻点名跳层2、旧 /customers 301→/wechat/crm、per-operator 无选客服机下拉 + /customers 不带超管头 + 立即扫好友带 cs_wechat_id
  → **本刀冲击点**：裸 `<table>`→Glide canvas 后，依赖 `crm-customer-row` / `columnheader` 角色的旧断言会失效（canvas 无 DOM 行）。Generator **必须迁移** crm-customer-list.spec.ts 的表格行断言为 Glide grid 容器 + `crm-count` 计数 oracle，且**保留**身份/状态写接口、onboarding 条、点名跳转、旧路由重定向、per-operator 这些既有行为不回归。
- [apps/dashboard/src/pages/__tests__/CustomerListPage.test.tsx] per-operator：GET /customers 普通 session fetch（credentials:'include'、无 X-User-Email、无 cs_wechat_id）、无选客服机下拉、立即扫好友带后端回 cs_wechat_id → 全部保留。
- [apps/api/.../line04-crm-customer-list-smoke.sh] 后端模式 A（隔离/登录态/接管/状态/加客户/跨租户 403）→ 本刀零后端改动，不得触碰。

---

## E2E 验收（最终 final-e2e 跑 — target_environment = windows_cloud 变体 C：Vite + Playwright）

**journey_type**: user_facing
**target_environment**: windows_cloud

> evaluator 模式 B：在 GHA windows-latest 跑 `sprints/06262245-line04-crm-glide-list/e2e-verify.ps1`（build dashboard → vite preview:5174 → Playwright `e2e/crm-glide-list.spec.ts`，page.route 拦后端无 DB）。canvas **不测文字**，测真实 DOM 可见状态变化（`crm-count` + grid 容器 + URL）。

### Playwright 脚本（generator 写入 `apps/dashboard/e2e/crm-glide-list.spec.ts`）
```javascript
import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const SHOTS = path.join('screenshots');
const HEADER_H = 36; // generator 必须与 Glide DataEditor headerHeight props 写定值一致
const ROW_H = 34;    // generator 必须与 Glide DataEditor rowHeight props 写定值一致

const ROWS = [
  { name: '张三', contact: '张三', wechat_id: 'WX_001', status: 'A1', last_contact_at: '2026-06-24T08:00:00.000Z', managed: true, source: 'scan', last_message: '多少钱', add_friend_time: '2026-06-01T08:00:00.000Z', identity: 'customer' },
  { name: '李四', contact: '李四', wechat_id: 'wx_002', status: 'A4', last_contact_at: '2026-06-23T08:00:00.000Z', managed: false, source: 'scan', last_message: '考虑下', add_friend_time: '2026-06-02T08:00:00.000Z', identity: 'blacklist' },
];
const ONBOARDING = { step_o1_online: 'ok', step_o2_scanned: 'ok', scanned_count: 2, step_o3_roster: 'ok', blacklist_count: 0, step_o4_realpublish: 'pending', step_o5_replied: 'pending' };

async function stub(page: Page, customers = ROWS) {
  await page.route('**/api/auth/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/wechat/cs/my-role', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role: 'admin', can_config: true }) }));
  await page.route('**/api/crm/customers**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ customers, total: customers.length, cs_wechat_id: 'wx_cs_A' }) }));
  await page.route('**/api/crm/onboarding/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ onboarding: ONBOARDING }) }));
}

test('S1+S3 Glide 暗色运营台渲染真数据 + 搜索/意向/身份筛选计数实时同步', async ({ page }) => {
  await stub(page);
  await page.goto(`${BASE_URL}/wechat/crm`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(SHOTS, '01-initial.png'), fullPage: true });

  // S1：Glide canvas 渲染（CSS 已 import 否则空白）
  await expect(page.getByTestId('crm-customer-grid')).toBeVisible();
  const canvas = page.getByTestId('crm-customer-grid').locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) throw new Error('FAIL: canvas 空白—疑似未 import glide index.css');
  await expect(page.getByTestId('crm-count')).toContainText('2');

  // S3：搜索 → 计数下降到匹配数（大小写不敏感命中 WX_001）
  await page.getByTestId('crm-search-input').fill('wx_001');
  await expect(page.getByTestId('crm-count')).toContainText('1');
  await page.screenshot({ path: path.join(SHOTS, '02-action.png'), fullPage: true });
  await page.getByTestId('crm-search-input').fill('');
  await expect(page.getByTestId('crm-count')).toContainText('2');

  // S3：点 A4 意向 chip → 仅 1 行；叠加身份 blacklist → 仍 1（李四 A4+blacklist）；取消意向 → 回 2 行里 blacklist 1 行
  await page.locator('[data-testid="crm-intent-chip"][data-intent="A4"]').click();
  await expect(page.getByTestId('crm-count')).toContainText('1');
  await page.locator('[data-testid="crm-identity-chip"][data-identity="blacklist"]').click();
  await expect(page.getByTestId('crm-count')).toContainText('1');
  await page.locator('[data-testid="crm-intent-chip"][data-intent="A4"]').click(); // 取消意向
  await expect(page.getByTestId('crm-count')).toContainText('1'); // 仅身份=blacklist 1 行
  await page.screenshot({ path: path.join(SHOTS, '03-result.png'), fullPage: true });
});

test('S2 点 Glide 首行姓名格 → 跳现有详情路由', async ({ page }) => {
  await stub(page);
  await page.goto(`${BASE_URL}/wechat/crm`);
  await page.waitForLoadState('networkidle');
  const box = await page.getByTestId('crm-customer-grid').locator('canvas').first().boundingBox();
  if (!box) throw new Error('FAIL: grid canvas 无 boundingBox');
  await page.mouse.click(box.x + 80, box.y + HEADER_H + ROW_H * 0.5); // 坐标从写定的 header/row 高度推导
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/wechat\/crm\/.+/);
  await page.screenshot({ path: path.join(SHOTS, '04-navigate.png'), fullPage: true });
});

test('边界：空数据 → 计数 0 + 空态容器在，不报错', async ({ page }) => {
  await stub(page, []);
  await page.goto(`${BASE_URL}/wechat/crm`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('crm-count')).toContainText('0');
  await expect(page.getByTestId('crm-empty')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, '05-empty.png'), fullPage: true });
});
```

### e2e-verify.ps1（generator 写入 `sprints/06262245-line04-crm-glide-list/e2e-verify.ps1`）
```powershell
# Line04 CRM 客户列表 Glide 重做 — 前端 E2E（windows-latest，windows_cloud 变体 C）
# build dashboard → vite preview:5174 → Playwright e2e/crm-glide-list.spec.ts（page.route 拦后端，无 DB）。
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$VitePort = 5174
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."

& cmd.exe /c "npm.cmd ci --prefer-offline" ; if ($LASTEXITCODE -ne 0) { throw "FAIL: npm ci" }
& cmd.exe /c "npx.cmd playwright install chromium" | Out-Null

Push-Location "$repoRoot\apps\dashboard"
& cmd.exe /c "npm.cmd run build" ; if ($LASTEXITCODE -ne 0) { throw "FAIL: dashboard build" }
Pop-Location

$vite = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow
$vok = $false
for ($i = 0; $i -lt 30; $i++) { Start-Sleep 1; if ((Test-NetConnection localhost -Port $VitePort -WarningAction SilentlyContinue).TcpTestSucceeded) { $vok = $true; break } }
if (-not $vok) { throw "FAIL: Vite 30s 未就绪" }

$env:BASE_URL = "http://localhost:$VitePort"
$e2e = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright test e2e/crm-glide-list.spec.ts --reporter=list" -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue
if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright CRM Glide 列表 UI exit=$($e2e.ExitCode)" }

$shots = "$repoRoot\apps\dashboard\screenshots"
if (Test-Path $shots) { New-Item -ItemType Directory -Force -Path "$scriptDir\screenshots" | Out-Null; Copy-Item "$shots\*.png" "$scriptDir\screenshots\" -ErrorAction SilentlyContinue }
Write-Host "✅ windows_cloud CRM Glide 客户列表 UI 验证通过"
exit 0
```

### CI 接入（用户路径 1:1 映射 — 已 cat 既有 e2e-line04-crm-redo.yml 确认模式）
> 既有 `e2e-line04-crm-redo.yml` 已在 `apps/dashboard/**` PR 触发 windows Playwright，但跑的是旧 sprint 的 `e2e-ui-verify.ps1` + `crm-customer-list.spec.ts`，**不覆盖本刀新 Glide 筛选 spec**。故 generator 须新增本刀专属 workflow（沿用同款 windows-latest + pwsh 模式）：
> Generator 写入 `.github/workflows/e2e-line04-crm-glide-list.yml`：`on: pull_request paths [apps/dashboard/**, sprints/06262245-line04-crm-glide-list/**, 该 workflow]` + `workflow_dispatch`；job runs-on windows-latest，step 跑 `./sprints/06262245-line04-crm-glide-list/e2e-verify.ps1`，failure 上传 screenshots。
> Generator 另写 smoke `.github/workflows/scripts/smoke/line04-crm-glide-list-smoke.sh`（node 本地可跑：依次跑 customerFilter vitest + CustomerListPage 组件 vitest，全绿 exit 0），接入 CI（PRD「新增 crm 列表 smoke 接入 CI windows e2e job」）。
> **CI_GAP 自查**：用户路径 [打开列表→搜索→意向筛选→身份筛选→点名跳转] 每步在 spec 有对应断言（S1 渲染 / S2 跳转 / S3 计数三筛）；无缺口。canvas 文件存在/大小检查**不**算行为验证，已用 `crm-count` 文本 + URL + boundingBox>0 作真实 oracle。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 纯过滤算法（逻辑） | `sprints/06262245-line04-crm-glide-list/tests/customerFilter.test.ts`（红证据）→ generator 落 `apps/dashboard/src/pages/crm/__tests__/customerFilter.test.ts` | 搜索(name/wechat 大小写不敏感)·意向(A1-A5 集合)·身份(customer/blacklist)·组合 AND·空筛选返回全部 | 模块 `customerFilter` 不存在 → import 失败 → FAIL |
| 组件计数同步 + 降级（逻辑/jsdom） | `apps/dashboard/src/pages/__tests__/CustomerListPage.test.tsx` | crm-count 随搜索/意向/身份交互·空数据 count=0+crm-empty·401 不白屏 | crm-search-input/crm-count/chip 不存在 → FAIL |
| Glide 渲染+跳转+计数（接缝） | `apps/dashboard/e2e/crm-glide-list.spec.ts` | S1 canvas 渲染·S2 点格跳转·S3 计数三筛 | grid/chip/count 未实现 → Playwright FAIL（windows_cloud） |
