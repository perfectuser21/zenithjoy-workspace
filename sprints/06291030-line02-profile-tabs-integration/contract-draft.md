# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: PRD 字面 + 现有路由代码推导）

本 sprint 不新增 HTTP 端点，所有 Response Schema 来自已有路由（`apps/api/src/routes/`）。

### Endpoint: PUT /api/company-profile
**Success (HTTP 200)**:
```json
{ "success": true, "data": { "updated": true }, "timestamp": "<iso8601>" }
```
- `success` (boolean, 必填): 来源 — 现有路由 `ok()` 统一格式
- `data.updated` (boolean, 必填, 值必须为 true): 来源 — company-profile.ts `return ok(res, { updated: true })`
- `timestamp` (string ISO8601): 来源 — `ok()` 统一注入

**禁用字段名**: `result`, `profile`, `saved`

**Error (HTTP 400)**:
```json
{ "success": false, "error": { "code": "MISSING_COMPANY_NAME", "message": "..." }, "timestamp": "<iso8601>" }
```

### Endpoint: GET /api/company-profile
**Success (HTTP 200)**:
```json
{
  "success": true,
  "data": {
    "company_name": "",
    "city": "",
    "industry": "",
    "description": "",
    "products": [],
    "key_advantages": [],
    "customer_problem": "",
    "customer_portrait": "",
    "qa_list": []
  },
  "timestamp": "<iso8601>"
}
```
- 9 个 data 字段（字母序 keys）: `city`, `company_name`, `customer_portrait`, `customer_problem`, `description`, `industry`, `key_advantages`, `products`, `qa_list`
- **禁用字段名（data 内层）**: `result`, `profile`, `saved`

### Endpoint: POST /api/acquisition/collect/start
**Success (HTTP 200)**:
```json
{ "success": true, "data": { "task_id": "<uuid>", "status": "pending" }, "timestamp": "<iso8601>" }
```
- `data.task_id` (string UUID): 来源 — acquisition.ts `return ok(res, { task_id: taskId, status: 'pending' })`
- `data.status` (string, 值必须为 "pending")

**禁用字段名**: `id`, `taskId`, `task_status`

**Error (HTTP 400)**:
```json
{ "success": false, "error": { "code": "MISSING_KEYWORDS", "message": "..." }, "timestamp": "<iso8601>" }
```

---

## 已知约束（来自回归测试）

- [line02-company-profile-collect.spec.ts] → `公司信息页 — 加载、填写、保存、刷新后数据仍在`（当前全 stub，本 sprint 去 stub）
- [line02-company-profile-collect.spec.ts] → `采集页 — 账号状态块 + 关键词配置 + 采集任务 Table`
- [line02-company-profile-collect-smoke.sh] → PUT/GET company-profile + collect/start + GET collect/:id（本 sprint 补全 9-field 验证 + psql 时间窗）
- [company-profile.test.ts] → `GET /api/company-profile` / `PUT /api/company-profile` 已有集成测试
- [acquisition.test.ts] → `POST /api/acquisition/collect/start` 已有集成测试

---

## 接缝清单

| # | 接缝点 | 真目标验证方式 | 当前状态 |
|---|---|---|---|
| 1 | `PUT /api/company-profile` 写入 `zenithjoy.tenant_company_profiles` | smoke.sh 打 staging API + psql `SELECT company_name FROM ... WHERE updated_at > NOW()-interval '5 minutes'` | 需真目标验证（smoke job ubuntu-latest 跑） |
| 2 | `POST /api/acquisition/collect/start` 写入 `zenithjoy.acquisition_collect_tasks` | smoke.sh 打 staging API + psql `SELECT status FROM ... WHERE created_at > NOW()-interval '5 minutes'` | 需真目标验证（smoke job ubuntu-latest 跑） |

> e2e-verify.ps1（windows-latest）通过 GET API 读回值间接确认持久化，无需直连 DB，无 psql 调用。

---

## Risks（风险登记）

| # | 风险 | 可能性 | 影响 | Mitigation |
|---|---|---|---|---|
| R1 | `E2E_DATABASE_URL` secret 未在 GHA 配置 → e2e-verify.ps1 Step 4 `$dbUrl` 为空抛异常，E2E 全 FAIL | 中 | E2E 全 FAIL | Generator 必须：① 在 e2e-windows.yml `Run E2E verification` step 的 `env:` 段加 `E2E_DATABASE_URL: ${{ secrets.E2E_DATABASE_URL }}`；② 在 GHA repo Settings → Secrets 确认 `E2E_DATABASE_URL` 已设置 staging DB 连接串 |
| R2 | smoke.sh 使用 `psql` 但 windows-latest runner 无 psql → smoke job 崩溃 | 高 | psql 验证全 FAIL | Generator 必须在 e2e-windows.yml 新增 `smoke` job（ubuntu-latest + `sudo apt-get install -y postgresql-client`）专门运行 smoke.sh；e2e-verify.ps1（windows-latest）不直接调 psql |
| R3 | Playwright 多 fallback 选择器（如 `input[placeholder*="公司"]`）可能静默命中错误元素导致假绿 | 中 | 特定步骤假通过 | Generator 写 CompanyProfilePage.tsx 时必须给关键输入框加 `data-testid`（如 `data-testid="company-name-input"`），Playwright spec 优先用精确 `[data-testid]` 选择器 |

---

## Golden Path

**入口**: 用户进入"公司信息"页

**[Step 1] → [Step 2] → [Step 3] → [Step 4] → [Step 5] → [Step 6] → [Step 7] → [Step 8] → [Step 9 出口]**

---

### Step 1: 公司信息页显示 3 个 Tab

**来源**: `[FROM_PRD]` — PRD § Golden Path 步骤 1「用户看到 3 个 Tab：基础信息 / 产品与价值 / 目标客群」

**可观测行为**: 页面顶部有 3 个可点击 Tab，文字分别为「基础信息」「产品与价值」「目标客群」

**验证命令**:
```javascript
// Playwright
await expect(page.getByRole('tab', { name: '基础信息' })).toBeVisible({ timeout: 5000 });
await expect(page.getByRole('tab', { name: '产品与价值' })).toBeVisible({ timeout: 5000 });
await expect(page.getByRole('tab', { name: '目标客群' })).toBeVisible({ timeout: 5000 });
```

**硬阈值**: 3 个 Tab 全部可见，5s 内加载完成

---

### Step 2: Tab 1（基础信息）填写公司名 + 行业 + 城市

**来源**: `[FROM_PRD]` — PRD § Golden Path 步骤 2「在 Tab 1 填"西安烤鱼馆"、行业"餐饮"、城市"西安"」

**可观测行为**: Tab 1 激活，内有 data-testid=company-name-input 输入框

**验证命令**:
```javascript
// Playwright（Generator 写 TSX 时必须给输入框加 data-testid）
await page.getByRole('tab', { name: '基础信息' }).click();
await expect(page.locator('[data-testid="company-name-input"]')).toBeVisible({ timeout: 3000 });
```

**硬阈值**: data-testid=company-name-input 输入框在 3s 内可见

---

### Step 3: 切换 Tab 2 触发 onBlur 自动保存，"已保存 ✓" toast 出现

**来源**: `[FROM_PRD]` — PRD § Golden Path 步骤 3「点击 Tab 2（触发 Tab 1 字段 onBlur 自动保存）→ 右上角出现"已保存 ✓"（1.5s 后消失）」

**可观测行为**: 点击 Tab 2 后出现「已保存 ✓」或「已保存」toast

**验证命令**:
```javascript
// Playwright — onBlur 触发保存 + toast 出现
await page.locator('[data-testid="company-name-input"]').fill('烟雨楼测试公司');
await page.getByRole('tab', { name: '产品与价值' }).click();
await expect(page.getByText(/已保存/)).toBeVisible({ timeout: 5000 });
```

**硬阈值**: toast 在点击 Tab 2 后 5s 内出现

---

### Step 4: Tab 2（产品与价值）填写并切换到 Tab 3，再次自动保存

**来源**: `[FROM_PRD]` — PRD § Golden Path 步骤 4「在 Tab 2 填产品"秘制烤鱼"、卖点"20年老配方"，点击 Tab 3 → "已保存 ✓"」

**可观测行为**: Tab 2 填写 + 切换 Tab 3 后 toast 再次出现

**验证命令**:
```javascript
// Playwright — Tab 2 填写 + Tab 3 切换 + toast 第二次出现
await page.locator('[data-testid="products-input"]').fill('秘制烤鱼');
await page.getByRole('tab', { name: '目标客群' }).click();
await expect(page.getByText(/已保存/)).toBeVisible({ timeout: 5000 });
```

**硬阈值**: toast 在 5s 内出现

---

### Step 5: 刷新页面 → Tab 1 数据仍持久

**来源**: `[FROM_PRD]` — PRD § Golden Path 步骤 5「刷新页面 → 切回 Tab 1，"西安烤鱼馆"仍在（真实持久化）」

**可观测行为**: 刷新后 Tab 1 公司名仍为刚写入的值（来自真实 GET 响应）

**验证命令**:
```javascript
// Playwright — 刷新后数据持久（接缝断言：依赖真实 API + DB）
await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('tab', { name: '基础信息' }).click();
await expect(
  page.locator('[data-testid="company-name-input"]')
).toHaveValue('烟雨楼测试公司', { timeout: 5000 });
```

**硬阈值**: 公司名 = '烟雨楼测试公司'（真实 GET 响应，不是前端 state）

---

### Step 6: 进入「智能获客 → 分析+指派」页，推荐关键词 chips 出现

**来源**: `[FROM_PRD]` — PRD § Golden Path 接续步骤 6+7「关键词输入区下方显示推荐 chips」

**可观测行为**: /dashboard/acquisition-config 推荐关键词区域出现 1–5 个 chip

**验证命令**:
```javascript
// Playwright — chips 出现（纯前端组合逻辑）
await page.goto(`${BASE_URL}/dashboard/acquisition-config`, { waitUntil: 'networkidle' });
const chips = page.locator('[data-testid="keyword-chip"]');
await expect(chips.first()).toBeVisible({ timeout: 5000 });
const chipCount = await chips.count();
if (chipCount < 1 || chipCount > 5) {
  throw new Error(`FAIL: 推荐 chips 数量 = ${chipCount}，期望 1-5`);
}
```

**硬阈值**: 推荐 chips 数量 1–5（去重后 slice(0,5)）

---

### Step 7: 点击 chip 填入关键词输入框，开场白 placeholder 自动更新

**来源**: `[FROM_PRD]` — PRD § Golden Path 接续步骤 7「点"秘制烤鱼" chip → 填入关键词输入框；开场白 placeholder 自动带"西安烤鱼馆…秘制烤鱼"」

**可观测行为**: chip 点击后关键词输入框值等于 chip 文字；开场白输入框 placeholder 含公司名或产品名

**验证命令**:
```javascript
// Playwright — 自包含（不依赖 Step 6 代码块内的 chips 变量）
await page.goto(`${BASE_URL}/dashboard/acquisition-config`, { waitUntil: 'networkidle' });
const firstChip = page.locator('[data-testid="keyword-chip"]').first();
await expect(firstChip).toBeVisible({ timeout: 5000 });
const chipText = await firstChip.textContent();
await firstChip.click();

// 验证关键词输入框已填入 chip 文字
const kwInput = page.locator('[data-testid="keyword-input"]');
await expect(kwInput).toHaveValue(chipText?.trim() ?? '', { timeout: 3000 });

// 验证开场白 placeholder 含公司信息（FROM_PRD Step 7 明确要求）
const openingInput = page.locator('[data-testid="opening-input"]');
const placeholder = await openingInput.getAttribute('placeholder');
if (!placeholder || (!/烟雨楼|秘制烤鱼|西安/.test(placeholder))) {
  throw new Error(`FAIL: 开场白 placeholder 未含公司信息，实际="${placeholder ?? 'null'}"`);
}
```

**硬阈值**: kwInput.value 精确等于 chip 文字；placeholder 匹配 /烟雨楼|秘制烤鱼|西安/

---

### Step 8: 点击"开始采集" → acquisition_collect_tasks 写入 pending 记录

**来源**: `[FROM_PRD]` — PRD § Golden Path 接续步骤 9「点"开始采集" → acquisition_collect_tasks 写入 1 条 status=pending 记录」

**可观测行为**: 点击后 UI 出现采集状态反馈

**验证命令**:
```javascript
// Playwright — 纯 JS 语法，不混用 bash 注释
const collectBtn = page.getByRole('button', { name: /开始采集|采集/ }).first();
await collectBtn.click();
await expect(page.getByText(/待执行|pending|已提交/)).toBeVisible({ timeout: 10000 });
```

**硬阈值**: 10s 内 UI 出现「待执行」或类似状态反馈

---

### Step 9: 出口 — 采集任务 Table 显示新记录（smoke psql 验证）

**来源**: `[FROM_PRD]` — PRD § Golden Path「出口：采集任务 Table 显示新记录（关键词="秘制烤鱼"，状态=待执行）」

**可观测行为**: 任务列表出现状态为「待执行」的新记录

**验证命令**:
```bash
# smoke.sh 中 Step 4-5（接缝断言 — ubuntu-latest job 运行）
KEYWORD="smoke-$(date +%s)"
RESP=$(curl -sf -X POST "$API/api/acquisition/collect/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT" \
  -d "{\"keywords\":[\"$KEYWORD\"]}")
echo "$RESP" | jq -e '.success == true and .data.status == "pending"' || { echo "FAIL"; exit 1; }
TASK_ID=$(echo "$RESP" | jq -r '.data.task_id')
COUNT=$(psql "$DB_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.acquisition_collect_tasks \
   WHERE id='$TASK_ID' AND status='pending' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "${COUNT:-0}" -ge 1 ] || { echo "FAIL: psql 无记录"; exit 1; }
```

**硬阈值**: 5 分钟内 DB 有对应 `status=pending` 记录

---

## 出错路径

### EP-1: 公司信息未填 → 推荐 chips 显示灰色提示

**来源**: `[FROM_PRD]` — PRD § 出错路径「公司信息未填 → 推荐 chips 区显示灰色提示"先填写公司信息"，非报错」

**验证命令**:
```javascript
// Playwright — 公司信息空时显示提示文案
await expect(page.getByText(/先填写公司信息|填写公司信息/)).toBeVisible({ timeout: 5000 });
```

---

### EP-3: 自动保存失败（网络）→ 红色 toast 提示

**来源**: `[FROM_PRD]` — PRD § 出错路径「自动保存失败（网络）→ toast 红色"保存失败，请重试"」

**验证命令**:
```javascript
// Playwright — 拦截 PUT 返回 500，断言红色 toast 出现（error path 测试，非 Golden Path mock）
await page.route('**/api/company-profile', async route => {
  if (route.request().method() === 'PUT') {
    await route.fulfill({ status: 500, body: '{"success":false,"error":"network error"}' });
  } else {
    await route.continue();
  }
});
await page.locator('[data-testid="company-name-input"]').fill('失败测试值');
await page.getByRole('tab', { name: '产品与价值' }).click();
await expect(page.getByText(/保存失败|请重试/)).toBeVisible({ timeout: 5000 });
await page.unrouteAll();
```

**硬阈值**: 「保存失败」或「请重试」文案 5s 内可见

---

## E2E 验收

**journey_type**: user_facing  
**target_environment**: windows_cloud  
**E2E 模板**: windows_cloud 变体 C（Dashboard / Web App — Vite + Playwright）

> **required secrets**（GHA repo Settings → Secrets 配置）：
> - `E2E_SUPER_ADMIN_EMAIL`, `E2E_SUPER_ADMIN_PASSWORD` — 已有
> - `E2E_DATABASE_URL` — **新增**（staging postgres 连接串；R1 mitigation）
> - `E2E_API_URL` — **新增**（staging API URL；smoke job 使用）

> **Generator 必须修改 `.github/workflows/e2e-windows.yml`**：
> 1. `Run E2E verification` step 的 `env:` 块新增：
>    ```yaml
>    E2E_DATABASE_URL: ${{ secrets.E2E_DATABASE_URL }}
>    E2E_API_URL: ${{ secrets.E2E_API_URL }}
>    ```
> 2. 新增 `smoke` job（ubuntu-latest）运行 smoke.sh（R2 mitigation）：
>    ```yaml
>    smoke:
>      runs-on: ubuntu-latest
>      timeout-minutes: 10
>      steps:
>        - uses: actions/checkout@v4
>          with:
>            ref: ${{ inputs.pr_branch != '' && inputs.pr_branch || github.event.repository.default_branch }}
>        - name: Install psql
>          run: sudo apt-get install -y postgresql-client
>        - name: Run smoke
>          env:
>            API_URL: ${{ secrets.E2E_API_URL }}
>            DB_URL: ${{ secrets.E2E_DATABASE_URL }}
>            TENANT: "2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
>          run: bash .github/workflows/scripts/smoke/line02-company-profile-collect-smoke.sh
>    ```

---

### 1. smoke.sh（真实 API + psql 全 9 字段 + 时间窗，ubuntu-latest 运行）

存放位置: `.github/workflows/scripts/smoke/line02-company-profile-collect-smoke.sh`

```bash
#!/usr/bin/env bash
# smoke: Line02 公司信息 Tab + 采集闭环 — 真实 API + psql 全字段验证
# 运行条件: API_URL DB_URL TENANT 环境变量已设; 需 psql（ubuntu-latest）
set -euo pipefail

API="${API_URL:-http://localhost:3000}"
DB_URL="${DB_URL:-postgresql://localhost/zenithjoy}"
TENANT="${TENANT:-2ac0aa4a-99f4-470a-aed7-c3a9fe03149b}"
COMPANY_NAME="smoke-line02-$(date +%s)"

echo "=== Line02 Smoke (真实链路) API=$API TENANT=$TENANT ==="

# ─── 1. PUT /api/company-profile ───
echo "[1] PUT company-profile..."
RESP=$(curl -sf -X PUT "$API/api/company-profile" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT" \
  -d "{\"company_name\":\"$COMPANY_NAME\",\"city\":\"西安\",\"industry\":\"餐饮\",\"description\":\"Smoke\",\"products\":[\"秘制烤鱼\"],\"key_advantages\":[\"20年老配方\"],\"customer_problem\":\"\",\"customer_portrait\":\"\",\"qa_list\":[]}")
echo "$RESP" | jq -e '.success == true' > /dev/null || { echo "FAIL: PUT success!=true"; exit 1; }
echo "$RESP" | jq -e '.data.updated == true' > /dev/null || { echo "FAIL: PUT data.updated!=true"; exit 1; }
echo "$RESP" | jq -e 'has("result") | not' > /dev/null || { echo "FAIL: 禁用字段 result 出现在 PUT 响应"; exit 1; }
echo "PASS [1]"

# ─── 2. psql 验证 PUT 持久化（时间窗防造假）───
echo "[2] psql 验证写入..."
COUNT=$(psql "$DB_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.tenant_company_profiles \
   WHERE tenant_id='$TENANT' AND company_name='$COMPANY_NAME' \
   AND updated_at > NOW() - interval '5 minutes'" | tr -d ' \n')
[ "${COUNT:-0}" -ge 1 ] || { echo "FAIL: psql 无时间窗内记录"; exit 1; }
echo "PASS [2] count=$COUNT"

# ─── 3. GET /api/company-profile — 全 9 字段 + keys + 禁用字段验证 ───
echo "[3] GET company-profile 9字段..."
RESP=$(curl -sf "$API/api/company-profile" -H "X-Tenant-Id: $TENANT")
echo "$RESP" | jq -e '.success == true' > /dev/null || { echo "FAIL: GET success!=true"; exit 1; }

for FIELD in company_name city industry description products key_advantages customer_problem customer_portrait qa_list; do
  echo "$RESP" | jq -e ".data | has(\"$FIELD\")" > /dev/null || { echo "FAIL: GET data 缺字段 $FIELD"; exit 1; }
done

echo "$RESP" | jq -e '.data | keys == ["city","company_name","customer_portrait","customer_problem","description","industry","key_advantages","products","qa_list"]' > /dev/null \
  || { echo "FAIL: GET data keys 不匹配（多余或缺少字段）"; exit 1; }

echo "$RESP" | jq -e '.data | has("result") | not' > /dev/null || { echo "FAIL: 禁用字段 result 在 data"; exit 1; }
echo "$RESP" | jq -e '.data | has("profile") | not' > /dev/null || { echo "FAIL: 禁用字段 profile 在 data"; exit 1; }
echo "$RESP" | jq -e '.data | has("saved") | not' > /dev/null || { echo "FAIL: 禁用字段 saved 在 data"; exit 1; }

RETURNED=$(echo "$RESP" | jq -r '.data.company_name')
[ "$RETURNED" = "$COMPANY_NAME" ] || { echo "FAIL: GET company_name='$RETURNED' != '$COMPANY_NAME'"; exit 1; }
echo "PASS [3]"

# ─── 4. POST /api/acquisition/collect/start ───
echo "[4] POST collect/start..."
KEYWORD="smoke-kw-$(date +%s)"
RESP=$(curl -sf -X POST "$API/api/acquisition/collect/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT" \
  -d "{\"keywords\":[\"$KEYWORD\"]}")
echo "$RESP" | jq -e '.success == true' > /dev/null || { echo "FAIL: collect/start success!=true"; exit 1; }
echo "$RESP" | jq -e '.data.status == "pending"' > /dev/null || { echo "FAIL: status!='pending'"; exit 1; }
echo "$RESP" | jq -e '.data.task_id | type == "string"' > /dev/null || { echo "FAIL: task_id 非 string"; exit 1; }
echo "$RESP" | jq -e '.data | has("id") | not' > /dev/null || { echo "FAIL: 禁用字段 id 在 data"; exit 1; }
echo "$RESP" | jq -e '.data | has("taskId") | not' > /dev/null || { echo "FAIL: 禁用字段 taskId 在 data"; exit 1; }
TASK_ID=$(echo "$RESP" | jq -r '.data.task_id')
echo "PASS [4] task_id=$TASK_ID"

# ─── 5. psql 验证 collect task 写入（时间窗防造假）───
echo "[5] psql 验证 collect task..."
COUNT=$(psql "$DB_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.acquisition_collect_tasks \
   WHERE id='$TASK_ID' AND status='pending' \
   AND created_at > NOW() - interval '5 minutes'" | tr -d ' \n')
[ "${COUNT:-0}" -ge 1 ] || { echo "FAIL: psql 无时间窗内 task 记录"; exit 1; }
echo "PASS [5] count=$COUNT"

# ─── 6. GET /api/acquisition/collect/:task_id ───
echo "[6] GET collect task..."
RESP=$(curl -sf "$API/api/acquisition/collect/$TASK_ID" -H "X-Tenant-Id: $TENANT")
echo "$RESP" | jq -e '.success == true' > /dev/null || { echo "FAIL: GET task success!=true"; exit 1; }
echo "$RESP" | jq -e '.data | has("task_id") and has("status")' > /dev/null || { echo "FAIL: task 响应缺字段"; exit 1; }
echo "PASS [6]"

# ─── 7. error path: PUT 空 company_name → 400 ───
echo "[7] error path PUT 空 company_name..."
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PUT "$API/api/company-profile" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT" \
  -d '{"company_name":""}')
[ "$CODE" = "400" ] || { echo "FAIL: 空 company_name 未返 400，实际=$CODE"; exit 1; }
echo "PASS [7]"

echo ""
echo "=== Line02 Smoke PASSED ==="
```

---

### 2. e2e-verify.ps1（windows-latest Playwright，无直接 psql 调用）

见 `sprints/06291030-line02-profile-tabs-integration/e2e-verify.ps1`。

**前提**: E2E_DATABASE_URL 由 e2e-windows.yml `Run E2E verification` step 的 `env:` 注入（R1 mitigation）。PS1 不直接调 psql，DB 验证通过 GET API 读回值完成。

**PASS 标准**: `e2eProc.ExitCode = 0` + Playwright 所有 spec 通过 + API 真实调用（无 company-profile/acquisition stub）  
**FAIL 标准**: 任意 step throw / Playwright 失败 / API 未就绪 / E2E_DATABASE_URL 未设置  
**GHA workflow**: `.github/workflows/e2e-windows.yml`（`workflow_dispatch` + `windows-latest`）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 推荐关键词组合逻辑 | `tests/line02-profile-tabs.test.ts` | buildRecommendedKeywords 纯函数 | import 文件不存在 → 1 failure |
| CompanyProfilePage Tab 布局 | `tests/line02-profile-tabs.test.ts` | Tab role 元素存在 | getByRole('tab') 返回 0 → 1 failure |
| Playwright spec 去 stub | `tests/line02-profile-tabs.test.ts` | 无 page.route company-profile stub | 当前 spec 含 stub → 1 failure |
