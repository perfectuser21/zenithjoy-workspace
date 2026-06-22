# Sprint Contract Draft (Round 2) — 客户管理后台

> journey_id e6270293-7ca3-4261-b01d-4de4c66e0352 · step_id L10-S1
> journey_type **user_facing** · target_environment **windows_cloud**

> **可执行 SSOT 约定（R2 — 修 reviewer 非阻塞 dim4 漂移）**：所有后端断言的**唯一可执行来源是 `contract-dod.md` 的 [BEHAVIOR] manual:bash**。本 draft 只留 Golden Path 叙述 + 稳定 ID 引用（指向 dod 对应条目），不再粘贴整段 bash，避免 draft/dod 双份命令漂移。

---

## 预期受影响文件（R2 补 .github/workflows/ci-l4-e2e-smoke.yml — 阻塞1b）

- `apps/api/db/migrations/<新>_customer_admin_backend.sql`
- `apps/api/src/routes/customer-admin.ts`（+ `apps/api/src/lib/sub-account-quota.ts` / `customer-admin-rules.ts`）
- `apps/dashboard/src/pages/AdminCustomersPage.tsx` + `apps/dashboard/src/api/customer-admin.api.ts`
- `.github/workflows/scripts/smoke/customer-admin-backend-smoke.sh`
- `apps/dashboard/e2e/customer-admin-backend.spec.ts`
- **`.github/workflows/ci-l4-e2e-smoke.yml`** ← R2 新增：在 `smoke-api-contract` job 加 step 跑上面的 smoke（否则 8+ 条后端断言永不进 CI gate，见 ## CI 接线）

---

## Response Schema（推导来源: code-derived，api_registry 不可达，fallback 现有 `apps/api/src/routes/admin-customers.ts` 约定）

> PRD 未给 `## Response Schema` 段。Brain registry 不可达（localhost:5221 down），故按本仓库既有 admin 路由约定推导：
> 列表 `{ success:true, data:[...], total:number }`；单体 `{ success:true, data:{...} }`；错误 `{ success:false, data:null, error:{ code:string, message:string }, timestamp }`（见 admin-customers.ts:66-72）。
> **禁用字段名**（admin-customers-smoke.sh 既有反向断言沿用）: `users` / `clients` / `members` / `result` / `id`（实体主键一律用 `<entity>_id`：`tenant_id` / `account_id` / `binding_id`，对齐 admin-customers.ts 的 `tenant_id` / `session_id`）。

### Endpoint: `PUT /api/tenant/:id`（改公司名）
**Success (HTTP 200)**: `{"success": true, "data": {"tenant_id": "<uuid>", "name": "<string>"}}`
**Error**: `404` `{"code":"TENANT_NOT_FOUND"}`；`400` 空名 `{"code":"INVALID_NAME"}`
→ 可执行断言：dod [BEHAVIOR] **Step1 改公司名落库**

### Endpoint: `GET /api/tenant/:id/accounts`（子账号列表，含配额）
**Success (HTTP 200)**:
```json
{"success": true, "data": [{"account_id":"<uuid>","email":"<string>","display_name":"<string>","role":"admin|operator|service_agent","created_at":"<iso>"}], "total": 0, "quota": {"used": 0, "limit": 0}}
```
- 顶层 keys **恰为** `["data","quota","success","total"]`（子集卡，无多余）；`data[]` 项主键用 `account_id`，**禁** `id`/`users`/`clients`/`members`/`result`。
- `quota.used` / `quota.limit` (number, 必填): PRD 边界「配额已满，当前 N/M」→ N=used M=limit
→ 可执行断言：dod [BEHAVIOR] **GET /accounts schema 纯度**（阻塞3，子集卡 + 反向 ! id/! users）

### Endpoint: `POST /api/tenant/:id/accounts`（建子账号）
**Success (HTTP 201)**: `{"success": true, "data": {"account_id":"<uuid>","email":"<string>","display_name":"<string>","role":"<string>"}}`
- `role` (string, 必填): 枚举 `admin` | `operator` | `service_agent`（PRD 第 2 步字面）
**Error**: `409` 配额满 `{"code":"SUBACCOUNT_QUOTA_EXCEEDED","message":"配额已满，当前 N/M"}`（message 含 `配额` 与 `N/M` 形态）；`409` `{"code":"EMAIL_EXISTS"}`；`400` 非法角色 `{"code":"INVALID_ROLE"}`
→ 可执行断言：dod [BEHAVIOR] **Step2 建子账号带 role** / **Step2-err 非法 role** / **Step5 子账号配额超限**

### Endpoint: `DELETE /api/tenant/:id/accounts/:aid`（软删账号）
**Success (HTTP 200)**: `{"success":true,"data":{"account_id":"<uuid>","deleted":true}}`
→ 可执行断言：dod [BEHAVIOR] **Step6 租户隔离 + 软删**

### Endpoint: `GET /api/tenant/:id/service-agents`（客服-PC 绑定列表）
**Success (HTTP 200)**:
```json
{"success": true, "data": [{"binding_id":"<uuid>","account_id":"<uuid>","account_email":"<string>","machine_id":"<string>","hostname":"<string|null>","online":false,"bound_at":"<iso>"}], "total": 0}
```
- 顶层 keys **恰为** `["data","success","total"]`（子集卡）；`data[]` 项主键用 `binding_id`，**禁** `id`。
- `online` (bool, 必填): PRD 第 3 步「客服 X @ PC Y ● 在线」→ 由 license_machines.last_seen 60s 新鲜度推导
→ 可执行断言：dod [BEHAVIOR] **GET /service-agents schema 纯度**（阻塞3）

### Endpoint: `POST /api/tenant/:id/service-agents/:aid/bind-device`（绑客服到 PC）
**Success (HTTP 201)**: `{"success": true, "data": {"binding_id":"<uuid>","account_id":"<uuid>","machine_id":"<string>"}}`
**Error**: `409` 客服或 PC 已被绑 `{"code":"ALREADY_BOUND"}`；`409` 占满机器配额 `{"code":"MACHINE_QUOTA_EXCEEDED"}`；`400` 账号非 service_agent `{"code":"INVALID_BIND_ROLE"}`
→ 可执行断言：dod [BEHAVIOR] **Step3 绑定 + 双唯一拒绝**（ALREADY_BOUND）/ **Step3-mq 机器配额超额**（MACHINE_QUOTA_EXCEEDED — 阻塞2）

### Endpoint: `DELETE /api/tenant/:id/service-agents/:bid`（软删绑定）
**Success (HTTP 200)**: `{"success":true,"data":{"binding_id":"<uuid>","deleted":true}}`

### Endpoint: `GET /api/agent/module-health`（**复用既有**，walking-skeleton.ts:135）
**Success (HTTP 200)**: `{"ok": true, "data": [{"agent_id":"<string>","hostname":"<string>","module_status":{"<line-key>":{"ok":true,"reason":"<string?>"}},"updated_at":"<iso>"}]}`
> 本 sprint **不改** module-health 端点（PRD ASSUMPTION），仅诊断页消费它。其 schema 为 `{ok, data}`（与新端点 `{success, data}` 不同，因复用既有契约，**不许改**它去对齐）。
→ 可执行断言：dod [BEHAVIOR] **Step4 诊断端点 schema 复用**

### 子账号配额映射（`[AI_ADDED]` 决策 — PRD 未给数值，只给「3~5 个」+「跟随 license plan」）
```
SUB_ACCOUNT_LIMITS = { free: 0, basic: 3, matrix: 5, studio: 10, enterprise: 30 }
```
映射键 = `zenithjoy.licenses.tier`（既有 CHECK 枚举）。**验收对配额数值不可知**：测试创建到 `limit` 后断言第 `limit+1` 个返 4xx + DB 无新行，`limit` 从 API `quota.limit` 读，不硬编码（防 generator 改映射后测试假绿）。

---

## 已知约束（来自回归测试）

- [apps/dashboard/e2e/module-health.spec.ts] → 机器行渲染(hostname+agent_id)+四条 Line 表头；单元格三态(在线/失败reason/无数据)；API 失败显示错误提示 —— 诊断页 UI 必须保留三态渲染
- [.github/workflows/scripts/smoke/admin-customers-smoke.sh] → 顶层 keys 精确 `["data","success","total"]`；禁用字段 `users/clients/members/result` 不出现；非超管 `X-Feishu-User-Id: not-an-admin` → 403 —— 新端点沿用同款 schema 纯度 + 403 守卫
- [apps/api/src/middleware/super-admin.ts] → 守卫双路径：`X-Feishu-User-Id` 命中 `ADMIN_FEISHU_OPENIDS` 白名单 / `X-Internal-Token`|`Bearer` 匹配 `ZENITHJOY_INTERNAL_TOKEN`；env 设了 token 后无头真返 401（CI 即此态）—— 正向 smoke/BEHAVIOR 必带 internal token 头

---

## Golden Path

[管理员进客户管理页] → [设公司名 → 建 3 子账号(含1 service_agent) → 绑 1 客服到 1 PC → 看该机诊断] → [一家公司被完整配好且每台机器体检可见]

> 每步「可观测行为 + 硬阈值」如下；**可执行验证命令 = contract-dod.md 同名 [BEHAVIOR]**（SSOT，psql 字面量用 `'\''…'\''` 真单引号，见 dod 顶部铁律）。

### Step 1: 设公司名（不再 Personal-邮箱）
**来源**: `[FROM_PRD]` — Golden Path 第 1 步「填公司名 → 写 tenants.name → 列表显示新名」
**可观测行为**: PUT 公司名后 `tenants.name` 更新，列表/详情显示新名。
**硬阈值**: HTTP 200 且 `data.name` == 入参；DB `tenants.name` 实际更新；空名 → 400 `INVALID_NAME`。
**验证**: dod [BEHAVIOR] **Step1 改公司名落库**

### Step 2: 建子账号（含 role，受 license plan 配额约束）
**来源**: `[FROM_PRD]` — Golden Path 第 2 步「填邮箱/显示名/角色 → 建 tenant_sub_accounts 行 → 列表出现」
**可观测行为**: POST 后 `tenant_sub_accounts` 新增带 role + tenant_id 行；一公司可建 3~5 个。
**硬阈值**: HTTP 201；5 分钟内新增 1 行带正确 role/tenant_id；非法 role → 400 `INVALID_ROLE`。
**验证**: dod [BEHAVIOR] **Step2 建子账号带 role** + **Step2-err 非法 role**

### Step 3: 绑客服到 PC（1:1 双唯一 + 占机器配额）
**来源**: `[FROM_PRD]` — Golden Path 第 3 步「选 service_agent + 选已注册机器 → 绑定 → 写 service_agents → 列表显示『客服 X @ PC Y ● 在线』」
**可观测行为**: POST 后 `service_agents` 新增 account↔machine 行；列表显示绑定（含 online 态）。1 客服已绑再绑 / 1 PC 已绑再被绑 → 双唯一拒绝；license 机器配额满再绑新机 → 硬拒不写库。
**硬阈值**:
- HTTP 201 首次绑定落库；
- 重复绑同客服或同 PC → 409 `ALREADY_BOUND` 且无新行；
- license `max_machines` 占满后绑新机 → 4xx `MACHINE_QUOTA_EXCEEDED` 且 `service_agents` 无新行（PRD 边界「占用 license.max_machines 超额硬拒，不写库」）。
**验证**: dod [BEHAVIOR] **Step3 绑定 + 双唯一拒绝** + **Step3-mq 机器配额超额**（阻塞2 — 验证声明的 MACHINE_QUOTA_EXCEEDED 错误码真触发）

### Step 4: 看该机诊断（复用 module-health）
**来源**: `[FROM_PRD]` — Golden Path 第 4 步「选客户机 → GET /api/agent/module-health → 表格显示各模块 ✅/❌+原因+上报时间」
**可观测行为**: 诊断页拉 `GET /api/agent/module-health` 按机器渲染模块矩阵；无上报机器显示「该机暂无上报，请确认 Agent 已连中台」。
**硬阈值**: 端点返回 `{ok, data:array}`；空 data 显示「暂无上报」文案（UI 断言见 ## E2E 验收）。
**验证**: dod [BEHAVIOR] **Step4 诊断端点 schema 复用** + E2E 截图 05

### Step 5: 子账号配额超限硬拒（边界 — 不写库）
**来源**: `[AI_ADDED]` — 防造假/健壮性：PRD 边界「子账号数超 plan 上限 → 报错『配额已满，当前 N/M』，不写库」。防 generator「永不拒绝」蒙混。
**可观测行为**: 建账号到 `quota.limit` 后下一个返 4xx + message 含「配额」与「N/M」，DB 行数停在 limit。
**硬阈值**: 超额 4xx + 文案含「配额」+「N/M」斜杠形态；DB 账号行数恰等于 `limit`。
**验证**: dod [BEHAVIOR] **Step5 子账号配额超限**

### Step 6: 租户隔离 + 软删（边界）
**来源**: `[AI_ADDED]` — PRD 范围/NFR「租户隔离：子账号绝不跨公司可见」+「账号/绑定软删，列表不再显示，记录保留」。防漏 tenant 过滤或物理删。
**可观测行为**: A 公司账号不出现在 B 公司列表；软删账号后 `deleted_at` 置位、列表不再含、DB 行仍在。
**硬阈值**: 跨租户列表 0 泄漏；软删后列表不含、`deleted_at` 置位、物理行保留。
**验证**: dod [BEHAVIOR] **Step6 租户隔离 + 软删**

---

## CI 接线（阻塞1 — CI_GAP 修复）

> Round 1 实证：`ci-l4-e2e-smoke.yml` 的 `smoke-api-contract` job 用**显式命名 step** 调各 smoke（`bash .../dashboard-license-smoke.sh`、multi-tenant step 等），**不是** glob `smoke/*.sh`。新建的 `customer-admin-backend-smoke.sh` 若不显式加 step，8+ 条后端断言（配额/双唯一/机器配额/隔离/软删/403/schema 纯度）**在 CI 永不跑**；evaluator 的 `e2e-windows.yml` 只跑 Playwright UI（前端 page.route stub 后端）。故后端正确性必须靠这条 smoke 进 CI gate。

**本轮合同硬要求**（contract-dod.md 已落为 [ARTIFACT]）：

1. **加 step**：在 `ci-l4-e2e-smoke.yml` 的 `smoke-api-contract` job 内新增一个显式 step 执行 `customer-admin-backend-smoke.sh`。该 job **前置已就绪**：已起 `postgres:15`（cecelia/cecelia/cecelia）、已 `glob 跑 apps/api/db/migrations/*.sql`（新 `*_customer_admin_backend.sql` 会被建表）、已起 `apps/api` 于 `localhost:5200`、已设 `ZENITHJOY_INTERNAL_TOKEN` + `ADMIN_FEISHU_OPENIDS`。新 step 传 env `API_BASE=http://localhost:5200`、`PGHOST/PGUSER/PGDATABASE=localhost/cecelia/cecelia`、`PGPASSWORD=cecelia`、`ZENITHJOY_INTERNAL_TOKEN`（沿用 job env）。
2. **super-admin 鉴权**：smoke 正向调用必带 `-H "X-Internal-Token: $ZENITHJOY_INTERNAL_TOKEN"`（CI 已关 dev-fallback，无头真 401）；负向 403 用例发 `X-Feishu-User-Id: not-an-admin`。
3. **PR 触发已确认**：`ci-l4-e2e-smoke.yml` 头部 `on: pull_request: branches: [main]` —— 已实读确认，加 step 后此 smoke 在 PR 即 gate（不只 nightly）。
4. **smoke 非空壳**：smoke 必须含真 curl + 真 psql 链路断言（bind-device / service-agents / accounts / 配额 / X-Internal-Token），由 [ARTIFACT] grep 守卫。

---

## 接缝清单（seam list — 碰真实世界的点，未真验标 logic-done-pending）

| # | 接缝点 | 类型 | 真目标验证方式 | 本轮状态 |
|---|---|---|---|---|
| 1 | `service_agents` 双唯一约束（account_id / machine_id partial unique）+ 机器配额（license.max_machines）在**真 Postgres** enforce | 接缝(真库) | CI `smoke-api-contract` job 真 psql 触发重复绑定/配额超额，断言 409 + 无新行 | **logic-done-pending**（待 [ARTIFACT] CI 接线落地：smoke 接进 ci-l4-e2e-smoke.yml 后此 job 真跑该断言才转 done — 阻塞1d） |
| 2 | 子账号配额 `M` 从 `licenses.tier` 推导的真实数值 | 接缝(真数据) | CI smoke 从 API `quota.limit` 读真实值驱动，不硬编码 | **logic-done-pending**（同上：依赖 CI 接线后真 license 数据驱动跑通 — 阻塞1d） |
| 3 | Dashboard 4 区页面 → **真实 API 布线**（windows_cloud E2E 在干净 VM 用 page.route stub 验 UI 渲染，真实前后端布线在部署后才跑通） | 接缝(生产布线) | UI 层 Playwright 验可见状态变化（本轮）；前端→真 API→真库 端到端布线需部署环境真验 | **logic-done-pending**（部署后真验） |

> 说明（R2 更正）：后端正确性（配额/双唯一/机器配额/软删/隔离/schema 纯度）的真目标 = CI `smoke-api-contract` job 的真 API + 真库。**该接线本 PR 才落地**（[ARTIFACT] CI 接线 + smoke 非空壳），落地前接缝 #1/#2 不得标 done（修 Round 1 overclaim）；evaluator 跑 [BEHAVIOR] manual:bash 也走真 API+真库，与 CI smoke 同源。windows_cloud Playwright 仅验 UI 可见行为，其 stub 仅限被测 UI 之外的后端边界，不 mock UI 渲染本身。

---

## E2E 验收（final-e2e — target_environment = windows_cloud，GHA windows-latest 跑 Playwright）

> evaluator 调 `gh workflow run e2e-windows.yml -f sprint_dir=sprints/06220836-customer-admin-backend -f task_id=<id> -f pr_branch=<branch>`。
> 已 `cat .github/workflows/e2e-windows.yml` 核对：该 workflow checkout → setup-node@20 → 运行 `$sprintDir/e2e-verify.ps1`，exit≠0 即 FAIL。e2e-verify.ps1 由本 sprint 提供，跑全 4 步用户路径。
>
> **职责切分（R2 澄清）**：`e2e-windows.yml`（Playwright UI，干净 VM，后端 stub）验**前端可见行为**；`ci-l4-e2e-smoke.yml`（真 API+真库）验**后端正确性**。两条 workflow 分别 gate 两层，缺一不可（Round 1 CI_GAP 即后端这层缺 gate）。
>
> **用户路径 1:1 映射**（管理员真实操作 ↔ Playwright spec 断言）：
> 1. 打开「客户管理」页 ↔ goto `/admin/customers` 见公司列表（`01-customers-page.png`）
> 2. 设公司名 ↔ 填 input + 提交，断言列表显示新名（`02-company-named.png`）
> 3. 建 3 子账号(1 service_agent) ↔ 新增账号表单 ×3，断言列表 3 行 + role 标签（`03-accounts.png`）
> 4. 绑 1 客服到 1 PC ↔ 绑定区选 service_agent+机器提交，断言「客服 @ PC ● 在线/离线」行（`04-bound.png`）
> 5. 看诊断 ↔ 诊断区选机器，断言模块矩阵表格可见（或空态文案）（`05-diagnosis.png`）

`e2e-verify.ps1`（写入 `sprints/06220836-customer-admin-backend/e2e-verify.ps1`，evaluator 在 windows-latest 执行）：
- npm ci → `npx playwright install chromium --with-deps`
- `npm run build`（apps/dashboard）→ `npx vite preview --port 5173 --host`
- 等端口就绪（Test-NetConnection localhost:5173）
- `npx playwright test e2e/customer-admin-backend.spec.ts`（env `E2E_BASE_URL`、`E2E_SUPER_ADMIN_EMAIL`）
- spec 用 `page.route` stub 新端点响应（干净 VM 无后端），**真实渲染** 4 区 UI 并对每步 `toBeVisible`/`toHaveText` 断言 + `page.screenshot`
- 任何 step exit≠0 或 spec 失败 → throw → workflow FAIL

PASS 标准：`e2e-verify.ps1` exit 0 + Playwright 全 spec 通过 + 5 张截图产出。
FAIL 标准：vite 30s 未就绪 / spec 任一断言失败 / 截图缺失。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint | `tests/customer-admin-backend.test.ts` | 配额映射 / role 合法性 / 绑定守卫（单元级护栏，import 失败即红）| 模块未实现 → import 失败 / 断言 FAIL |
| 后端真链路（CI gate）| `.github/workflows/scripts/smoke/customer-admin-backend-smoke.sh`（接进 ci-l4-e2e-smoke.yml）| dod 11 条 [BEHAVIOR]：改名 / 子账号+role / 子账号配额 / 双唯一 / 机器配额 / 软删 / 隔离 / schema 纯度 / 403 / module-health | 端点 404/无表/schema drift → FAIL |
| UI 可见行为（windows_cloud）| `apps/dashboard/e2e/customer-admin-backend.spec.ts` | 4 区用户路径 + 5 截图 | 页面/元素缺失 → toBeVisible 超时 FAIL |
