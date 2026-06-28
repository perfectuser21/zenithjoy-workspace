# Sprint Contract Draft (Round 1) — Line 02 公司信息页 + 采集任务 Table + 主号全链

> **验证 SSOT**：所有可执行验证命令以 `contract-dod.md` 的 `[BEHAVIOR]` manual:bash 为唯一真相源（evaluator 直接跑那一份）。本文件每个 Golden Path Step 只写「可观测行为 + 硬阈值」并引用对应 DoD `[BEHAVIOR]` Step 标签。

---

## Response Schema（推导来源: 同 repo apps/api/src/routes/ 字面约定 + PRD 字面，api_registry 不可达）

统一包裹：成功 `{success: true, data: {...}, timestamp: "<iso>"}` / 错误 `{success: false, error: {code, message}, timestamp: "<iso>"}`

### Endpoint 1: GET /api/company-profile
**Header**: `X-Tenant-Id: <uuid>` (tenantContextOptional 中间件读取)
**Success (HTTP 200)**:
```json
{
  "success": true,
  "data": {
    "company_name": "<string>",
    "city": "<string>",
    "industry": "<string>",
    "description": "<string>",
    "products": ["<string>"],
    "key_advantages": ["<string>"],
    "customer_problem": "<string>",
    "customer_portrait": "<string>",
    "qa_list": [{"q": "<string>", "a": "<string>"}]
  },
  "timestamp": "<iso>"
}
```
- `data.company_name` (string, 必填): PRD Step1 公司名
- `data.city` (string, 必填): PRD Step1 所在城市
- `data.industry` (string, 必填): PRD Step1 行业（下拉）
- `data.description` (string, 必填): PRD Step1 一句话介绍
- `data.products` (string[], 必填): PRD Step1 Section2 主营产品（多条）
- `data.key_advantages` (string[], 必填): PRD Step1 Section2 核心卖点（1-3条）
- `data.customer_problem` (string, 必填): PRD Step1 Section2 解决客户问题
- `data.customer_portrait` (string, 必填): PRD Step1 Section3 客户画像描述
- `data.qa_list` (Array<{q,a}>, 必填): PRD Step1 Section3 客户常见 Q&A
**首次访问（租户无记录）**: 返回 HTTP 200 + data 所有字段为空字符串/空数组（非 404）—— PRD 边界情况
**禁用字段名**: `profile`、`result`、`tenant_id`(data 顶层裸)、`companyName`（camelCase 不用）

### Endpoint 2: PUT /api/company-profile
**Header**: `X-Tenant-Id: <uuid>` + `Content-Type: application/json`
**Body**: 同 GET data 字段（`company_name` 必填，其余可选）
**Success (HTTP 200)**:
```json
{"success": true, "data": {"updated": true}, "timestamp": "<iso>"}
```
- `data.updated` (boolean, ==true): 来源 PRD Step1「保存 → Toast 已保存」
- `data` 顶层 keys 必须**完全等于** `["updated"]`
**Error (HTTP 400)**:
```json
{"success": false, "error": {"code": "MISSING_COMPANY_NAME", "message": "<string>"}, "timestamp": "<iso>"}
```
**禁用字段名**: `ok`、`saved`、`upserted`、`id`

### Endpoint 3: POST /api/acquisition/collect/start（已存在，本 sprint 行为不变）
**Header**: `X-Tenant-Id: <uuid>` + JSON body `{keywords: string[]}`
**Success (HTTP 200)**:
```json
{"success": true, "data": {"task_id": "<uuid>", "status": "pending"}, "timestamp": "<iso>"}
```
- `data.task_id` (string uuid): PRD Step3 触发后返回任务 ID
- `data.status` (==`"pending"`): 初始态
**Error (HTTP 400)**: `MISSING_KEYWORDS` (keywords 空)

### Endpoint 4: GET /api/line02/account-status（新建）
**Header**: `X-Tenant-Id: <uuid>`
**Success (HTTP 200)**:
```json
{
  "success": true,
  "data": {
    "accounts": [
      {"label": "<string>", "role": "main", "health": "ok"},
      {"label": "<string>", "role": "burner", "health": "ok"}
    ]
  },
  "timestamp": "<iso>"
}
```
- `data.accounts` (array, 必填): 主号 + 已绑小号的状态列表
- `data.accounts[].label` (string): 账号用户名，如 "live101942"
- `data.accounts[].role` (enum `"main"`|`"burner"`): PRD 明确 role 字段
- `data.accounts[].health` (enum `"ok"`|`"expired"`|`"unknown"`): PRD 出错路径「账号状态块变红」
- `data.accounts` 顶层 keys 必须**完全等于** `["accounts"]`
**禁用字段名**: `status`(顶层 data 裸)、`main_account`、`burner_accounts`(单独字段)

---

## 已知约束（来自回归测试）

- [acquisition.test.ts] 现有 `/api/acquisition/collect/start` 接受 `{keywords: string[]}` + `X-Tenant-Id` header（tenantContextOptional），写 DB 后返回 `{success,data:{task_id,status:"pending"},timestamp}`
- [acquisition.test.ts] 现有 `/api/acquisition/collect/report` 接受 `{task_id, video_id, commenters:[{sec_uid?,nickname}]}` + `terminal?` 字段（终态回报）
- [acquisition.test.ts] 租户隔离：读写均 `WHERE tenant_id=$tenantId`，跨租禁止
- [acquisition-collect.spec.ts] 现有 Playwright E2E 用 `page.route` stub 全部 API；鉴权注入 cookie `user=...` + `token=e2e-token`
- [20260618_190000_acquisition_collect.sql] `acquisition_collect_tasks` 表已存在，status 7 态 CHECK 约束；`acquisition_leads` 已存在 `(tenant_id,sec_uid)` 去重索引

---

## 接缝清单（v9.3 必填 — 哪几个点碰真实世界）

| # | 接缝点 | 真目标验证方式 | 本次状态 |
|---|---|---|---|
| 1 | Agent xian-rog 轮询 `pending-collect-tasks` + 主号 Chrome keyword-search | xian-rog 上起真实 Agent v2.0.40+，观察 Console 打印找到视频 URL + DB acquisition_videos 新增记录 | `logic-done-pending`（真机验） |
| 2 | `keyword-search-douyin.cjs` 读 `ZJ_MAIN_DATA_DIR` 环境变量（role='main' profile 路径） | xian-rog .env 有 `ZJ_MAIN_DATA_DIR=C:\Temp\zj-douyin-burner-v1\live101942`，cjs 能启动 Chrome 并搜索 | `logic-done-pending`（真机验） |
| 3 | `zenithjoy.tenant_company_profiles` staging DB 读写 | 在 staging API URL 上跑 PUT + GET curl，确认 psql 有时间窗记录 | 本次 BEHAVIOR mode-A 验（staging DB） |

> **接缝 1 & 2 标 `logic-done-pending`**：这两个接缝依赖 xian-rog 真机 + 真 Douyin session，不可在 windows_cloud CI 验。E2E smoke 以直接 `POST /api/acquisition/collect/report` 模拟 Agent 上报，覆盖 API logic 层；Agent 真机跑通需单独在 rog 验证后解除 pending 标记。

---

## Golden Path

**入口** → [Step 1] 公司信息页保存 → [Step 2] 采集页配置 + 账号状态 → [Step 3] 点「开始采集」→ 任务行出现 + Agent keyword-search → [Step 4] commenter 主页抓取 → acquisition_leads → [Step 5] 阶段一完成 → **出口**

---

### Step 1: 用户填写公司信息并保存（租户隔离）
**来源**: `[FROM_PRD]` — Golden Path Step1「用户进「公司信息」页 → 填写 → 点保存 → Toast「已保存」→ 刷新后数据仍在（租户隔离正确）」

**可观测行为**:
- `/company-profile` 路由可访问，首次加载显示空表单（非 404）
- 三个 Section 表单可填写（公司基础信息 / 产品卖点 / 客户画像）
- 点「保存」后 Toast 显示「已保存」
- 刷新页面，已填字段仍在（说明 PUT + GET 链路 OK）
- 不同 tenant_id 的数据完全隔离（另一租户 GET 返空表单）

**硬阈值**:
- PUT `/api/company-profile` 返回 HTTP 200，`data.updated == true`
- GET `/api/company-profile`（相同 tenant）返回 `data.company_name == "Smoke 公司"`
- GET（不同 tenant）返回 HTTP 200 + `data.company_name == ""`（租户隔离）
- `zenithjoy.tenant_company_profiles WHERE tenant_id = '<test_tenant>' AND created_at > NOW() - interval '5 minutes'` count ≥ 1

**验证**: contract-dod.md `[BEHAVIOR] Step1-a/b/c/d`

---

### Step 2: 用户进采集页，查看账号状态并配置关键词
**来源**: `[FROM_PRD]` — Golden Path Step2「顶部账号状态块：live101942 ✅已登录 / 小号 ✅已登录 → 填关键词 → 引流号 → 点「开始采集」」

**可观测行为**:
- GET `/api/line02/account-status` 返回 accounts 数组，含 live101942 health 字段
- 前端账号状态块渲染：主号绿色"已登录" / 无主号时灰色"需重扫"
- 无关键词时「开始采集」按钮 disabled（PRD 边界情况）

**硬阈值**:
- GET 返回 HTTP 200，`data.accounts` 数组非空，至少一个 `role == "main"` 条目
- `data.accounts` 顶层 keys == `["accounts"]`

**验证**: contract-dod.md `[BEHAVIOR] Step2-a/b`

---

### Step 3: 点「开始采集」→ 任务行出现，Agent 执行 keyword-search
**来源**: `[FROM_PRD]` — Golden Path Step3「采集任务 Table 新增一行 → Agent 轮询到任务 → 主号 Chrome 搜索关键词 → 找到视频 URL → 写 acquisition_videos」

**可观测行为**:
- POST `/api/acquisition/collect/start`（关键词="smoke-keyword"）返回 `task_id` + `status="pending"`
- `acquisition_collect_tasks` DB 新增一行（5 分钟时间窗）
- Table 状态列显示「待执行」（pending）/ Agent 接手后变「阶段一进行中」（running）
- [接缝 1 — logic-done-pending] Agent 真机执行 keyword-search，写 acquisition_videos

**硬阈值**:
- POST 返回 HTTP 200，`data.task_id` 为 UUID，`data.status == "pending"`
- DB: `SELECT count(*) FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id='<t>' AND status='pending' AND created_at > NOW() - interval '5 minutes'` ≥ 1
- [接缝标记] `acquisition_videos` 真机验，CI 以 collect/report mock 绕过

**验证**: contract-dod.md `[BEHAVIOR] Step3-a/b`

---

### Step 4: Agent 抓 commenter 主页 → 写 acquisition_leads（E2E 以 mock report 验 API 层）
**来源**: `[FROM_PRD]` — Golden Path Step4「主号进评论区 → 点头像 → commenter 主页 → 抓 nickname/sec_uid/... → 写 acquisition_leads → Table Lead 数递增」

**可观测行为**:
- POST `/api/acquisition/collect/report`（模拟 Agent 上报 commenters）→ `data.inserted ≥ 1`
- `acquisition_leads` 有记录：`sec_uid` 非空 + `nickname` 非空（5 分钟时间窗）
- GET `/api/acquisition/collect/:task_id` 返回 `lead_count_raw ≥ 1`
- [接缝 1 — logic-done-pending] 真机 commenter 主页抓取（crawl-comments-douyin.cjs）需 rog 验

**硬阈值**:
- POST collect/report 返回 HTTP 200，`data.inserted ≥ 1`
- DB: acquisition_leads 有 `sec_uid IS NOT NULL AND nickname != ''` 记录（5 分钟窗）

**验证**: contract-dod.md `[BEHAVIOR] Step4-a/b`

---

### Step 5: 全部视频处理完 → Table 状态「阶段一完成」
**来源**: `[FROM_PRD]` — Golden Path Step5「Table 状态 = 阶段一完成 | 结束时间 | 视频数 N | Lead 数 M → 启动阶段二按钮高亮（UI 占位）」

**可观测行为**:
- POST collect/report（terminal="done"）→ task status = "done"
- GET `/api/acquisition/collect/:task_id` 返回 `status == "done"`, `video_count ≥ 1`, `lead_count_raw ≥ 1`
- 前端 Table 状态列显示「阶段一完成」，「启动阶段二」按钮 visible 但 disabled（UI 占位）

**硬阈值**:
- GET task 返回 `data.status == "done"`, `data.video_count ≥ 1`, `data.lead_count_raw ≥ 1`
- `data` 包含 `task_id`, `status`, `video_count`, `lead_count_raw` 四个必填字段

**验证**: contract-dod.md `[BEHAVIOR] Step5-a/b`

---

**出错路径（PRD 出错路径）**:
- 主号 session 失效 → GET account-status 返回 `health == "expired"` → 前端账号状态块变红「需重扫」
- 主号未绑定时 POST collect/start → 可写入 pending（正常），但 Agent 轮询后立即标 failed（PRD 边界情况）

**验证**: contract-dod.md `[BEHAVIOR] Error-a`

---

## E2E 验收（target_environment = windows_cloud，windows_cloud variant C：Dashboard Playwright）

**journey_type**: user_facing
**target_environment**: windows_cloud
**E2E 脚本**: `sprints/06282255-line02-company-profile-collect/e2e-verify.ps1`
**Playwright 规范**: `apps/dashboard/e2e/line02-company-profile-collect.spec.ts`
**GHA Workflow**: `.github/workflows/e2e-line02-company-profile-collect.yml`

```powershell
# final-e2e — Line02 公司信息页 + 采集任务 Table（windows-latest Dashboard Playwright）
# 见 sprints/06282255-line02-company-profile-collect/e2e-verify.ps1（完整脚本）
#
# PASS 标准: Playwright spec exit 0 + 所有 expect() 通过
# FAIL 标准: exit ≠ 0 OR Playwright 失败 OR Vite 30s 内未就绪
#
# 所有 API stub via page.route — 不依赖真后端，不依赖 staging DB
# Screenshots: sprints/06282255-line02-company-profile-collect/screenshots/
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 公司信息 API GET/PUT | `tests/company-profile-and-line02.test.ts` | Step1-a/b/c/d | → 路由不存在 → supertest 404 |
| 采集任务 collect/start | `tests/company-profile-and-line02.test.ts` | Step3-a/b | → 已有路由通过（绿）|
| account-status | `tests/company-profile-and-line02.test.ts` | Step2-a/b | → 路由不存在 → supertest 404 |
| Playwright E2E 规范 | `apps/dashboard/e2e/line02-company-profile-collect.spec.ts` | Mode B 全程 | → 页面不存在 → locator timeout |
