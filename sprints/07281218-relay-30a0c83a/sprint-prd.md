# Sprint PRD — Staff Hub Ability Acceptance 端到端首刀

**Sprint ID:** 30a0c83a-47f4-4151-9636-a8cd2b6f1d7a  
**Sprint Dir:** `sprints/07281218-relay-30a0c83a`  
**生成时间:** 2026-07-28  
**类型:** feature + infrastructure  
**目标环境:** windows_cloud（前端 E2E） + local_api（后端 API 集成测试）  
**Journey ID:** 636a918c-8b23-4df5-baec-b1eb3308fffb  
**Feature ID:** 09edf50f-6cd3-4fda-8b21-7d2efcd075ec  

---

## OKR 对齐

- **对应 Journey:** 客户智能获客路径（Line 02）— Android surface，首个 Ability Acceptance 可验收 target
- **当前进度:** `ability_acceptance` Golden Path 状态 `proposed`；无 DB 表、无 API、无 Staff Hub 页面
- **本次推进预期:** `ability_acceptance` 从 `proposed` 升为 `active`；Staff Hub 新增 `/ability-acceptance` 页面；Postgres 落地四张验收表；公网 Staff Hub 可访问完整验收流程

---

## 背景

PR #1486 建立了 Product Map SSOT，但生成投影中 `golden_paths` 数组顺序不稳定（按插入顺序排列而非确定性排序），导致合同 E2E T6（`productMapDigest` 确定性）在某些环境 10 次中有失败，需先修复保序缺陷。

本 Sprint 是 Ability Acceptance 系统的"首刀"，首个 target 是：
- **App:** 客户 App（customer_app）
- **Line:** Line 02 智能获客
- **Surface:** Android

员工在公网 Staff Hub 创建验收 run，逐台设备（最多 5 台）逐条执行 FR/NFR/Invariant/SOP 验收项，记录 PASS/FAIL/BLOCKED，提交后结果永久保存于 Postgres 并可随时回查历史。

---

## Golden Path（核心场景）

**角色：** 员工（已通过飞书登录 Staff Hub）

1. **员工打开** Staff Hub → 左侧导航出现「Ability 验收」入口，点击进入 `/ability-acceptance`
2. **版本概览：** 页面加载，自动拉取 staging / production 两个环境的真实版本号和差异项数
   - 版本来源：读取仓库 VERSION 文件 + 环境 API（`/api/build-info`）真实返回；若查不到，显示 `Unknown (来源: 仓库 VERSION 文件不可达)` 而非伪造
   - 差异项数：staging 与 production 版本不同时计算差异；相同时显示「无差异」
3. **选择 target + 创建 run：** 员工选择 target（App: customer_app / Line: line02 / Surface: android），点击「新建验收 run」，系统在 `acceptance_run` 表写入一条记录（含 task_id=30a0c83a、sha=HEAD、tenant_id、created_by、created_at），幂等：同一 task_id+sha 已有 run 则复用，不重复创建
4. **逐条执行验收项：** 页面展示该 target 的 FR/NFR/Invariant/SOP 清单（来自 `acceptance_template`），员工逐条选择 PASS/FAIL/BLOCKED，可填写文字证据
5. **多设备记录：** 每台设备（最多 5 台）独立记录结果（`device_result`），每台设备内每个验收项有独立 `check_result`（含 PASS/FAIL/BLOCKED、验收人、验收日期、证据）
6. **提交验收：** 员工点击「提交验收」，run 状态变更为 `submitted`，不可再修改
7. **历史回看：** 员工可在 `/ability-acceptance/history` 查看所有历史 run，点击任一 run 查看明细

**自动化触发：** Harness 合并后可通过 POST `/api/staff/ability-acceptance/runs` 幂等创建 run，同一 task_id+sha 不重复插入，返回已有或新建 run 的 `run_id`

---

## 前置修复：PR #1486 Product Map 保序缺陷

**问题：** `product-map/generated/product-map.json` 中 `golden_paths` 数组不保序（`ability_acceptance` 在某些环境排序非确定性），导致 `productMapDigest` 在相同 YAML 输入下可能产出不同值，合同 E2E T6 不稳定。

**修复点：**
1. `scripts/product-map/lib.mjs` 中 `canonicalize()` 函数：`golden_paths` 数组按 `id` 字母序排序后再计算 digest
2. `scripts/product-map/cli.mjs` 中 `generate` 命令：生成 JSON/MD 时保持 `golden_paths` 按 `id` 字母序
3. 重新运行 `npm run product-map:generate` 更新 `product-map/generated/product-map.json` 和 `product-map/generated/product-map.md`
4. 合同 E2E `node --test scripts/product-map/__tests__/product-map.test.js` 全 10 个用例 PASS（需先安装缺失的 `ajv` 依赖，在根 `package.json` devDependencies 中添加 `ajv@^8.17.1` + `ajv-formats@^3.0.1`）

---

## 范围限定

### 在范围内

| 交付物 | 描述 |
|--------|------|
| **[Fix] product-map 保序** | `lib.mjs` + `cli.mjs` 修复保序；重新生成 JSON/MD；安装 ajv 依赖；合同 E2E 10/10 PASS |
| **[Config] product-map.yaml 升级** | `ability_acceptance` 状态从 `proposed` 改为 `active`；重新生成投影 |
| **[DB] 迁移文件** | `apps/api/db/migrations/20260728_ability_acceptance.sql`：四张表 `acceptance_template`、`acceptance_run`、`device_result`、`check_result`；tenant_id 索引；版本审计字段 |
| **[API] ability-acceptance 路由** | `apps/api/src/routes/ability-acceptance.ts`：`GET /templates`、`GET /versions`、`POST /runs`、`GET /runs`、`GET /runs/:runId`、`POST /runs/:runId/devices/:deviceIndex/checks`、`POST /runs/:runId/submit`；受 staffGuard 保护 |
| **[API] 注册路由** | `apps/api/src/app.ts` 挂载 `/api/staff/ability-acceptance` |
| **[API 单测]** | `apps/api/src/routes/__tests__/ability-acceptance.test.ts`：401/403、幂等创建、校验输入、audit 字段 |
| **[前端] Staff Hub 导航** | `apps/staff-hub/src/App.tsx` 新增「Ability 验收」NavLink + Route |
| **[前端] AbilityAcceptancePage** | `apps/staff-hub/src/pages/AbilityAcceptancePage.tsx`：版本概览 + 创建/继续 run + 逐条验收 + 提交 |
| **[前端] HistoryPage** | `apps/staff-hub/src/pages/AbilityAcceptanceHistoryPage.tsx`：历史 run 列表 + 明细 |
| **[E2E]** | `apps/dashboard/e2e/ability-acceptance.spec.ts`（windows_cloud）：导航可见 + 版本概览展示 + 创建 run + 录入 check + 提交 + 历史回看（Playwright 截图） |
| **[合同 E2E]** | `sprints/07281218-relay-30a0c83a/e2e-contract.sh`：API 集成测试脚本（curl + psql）验证幂等、租户隔离、audit 字段、提交锁定 |
| **[product-map 合同 E2E]** | product-map T1-T10 全 PASS；`ability_acceptance` status=active |
| **[CI gate]** | `.github/workflows/ci-l2-consistency.yml` 新增 `ability-acceptance-smoke` job（运行 contract E2E） |
| **[部署]** | `apps/staff-hub/**` 变更触发 `deploy-staff-hub.yml` 自动推送到 HK VPS；公网 URL、部署版本、回滚锚点 |

### 不在范围内

- 客户 Dashboard（`apps/dashboard/`）的 ability-acceptance 页面
- Ability Acceptance 自动化执行（本次只做人工录入型验收台）
- 多语言 / 国际化
- 验收报告 PDF 导出
- 验收模板的在线编辑（模板通过 DB seed 或 API 管理，不在 Staff Hub UI 内编辑）
- Line 01 / Line 04 的验收 target（本次只做 Line 02 / Android）

---

## 技术设计要点

### DB（四张表）

- `acceptance_template`：验收项模板，字段含 tenant_id / app_id / line_id / surface / kind（FR|NFR|Invariant|SOP）/ seq / title / description
- `acceptance_run`：一次验收任务，幂等 UNIQUE(tenant_id, task_id, sha)；status∈{in_progress, submitted, cancelled}；记录版本快照 staging_version / production_version / version_diff_count；必填 created_by
- `device_result`：每台设备一行，UNIQUE(run_id, device_index)，device_index 范围 1-5
- `check_result`：每台设备每个验收项一行，UNIQUE(device_result_id, template_id)；result∈{PASS,FAIL,BLOCKED,pending}；必填 checked_by

完整 DDL 由 generator 根据上述语义自行编写，迁移文件路径：`apps/api/db/migrations/20260728_ability_acceptance.sql`。

### API（7 个端点，统一前缀 `/api/staff/ability-acceptance`，均受 staffGuard 保护）

| Method | Path | 核心行为 |
|--------|------|---------|
| GET | `/templates` | 按 app_id/line_id/surface 查模板 |
| GET | `/versions` | 返回 staging/production 真实版本 + diff_count（禁止伪造） |
| POST | `/runs` | 幂等创建（同 task_id+sha 返回已有 run_id，created:false） |
| GET | `/runs` | 历史 run 列表 |
| GET | `/runs/:runId` | run 详情含 device_result + check_result |
| POST | `/runs/:runId/devices/:deviceIndex/checks` | 录入/更新验收项结果 |
| POST | `/runs/:runId/submit` | 提交锁定（status→submitted，之后 checks 返回 400） |

版本来源优先级：env var → VERSION 文件 → `Unknown (来源: ...)`，禁止伪造。

### 前端

- 两个新页面：`AbilityAcceptancePage.tsx`（版本概览 + 创建/继续 run + 逐条验收 + 提交）、`AbilityAcceptanceHistoryPage.tsx`（历史列表 + 明细）
- `App.tsx` 新增导航入口（lucide `ClipboardCheck` 图标）+ 两条路由（`/ability-acceptance`、`/ability-acceptance/history`）

---

## NFR 约束

- **staffGuard 保护：** 所有 `/api/staff/ability-acceptance/*` 必须通过 `staffGuard`（X-User-Email 或 X-Feishu-User-Id 白名单命中），403 时返回 `{ success: false, error: { code: "FORBIDDEN" } }`
- **租户隔离：** 所有 DB 查询必须带 `tenant_id = request.tenantId` 条件；跨租户数据绝不混读
- **审计字段：** `acceptance_run.created_by`、`check_result.checked_by` 必须写入真实调用方身份（来自 `X-User-Email` 或 `X-Feishu-User-Id` 头），禁止为空
- **幂等创建：** 同一 `tenant_id + task_id + sha`（均非 null）的 run 只能创建一条；重复请求返回已有 run 的 `run_id` + HTTP 200
- **提交后锁定：** `status = submitted` 后，任何 `POST /checks` 或 `POST /submit` 请求返回 400 `RUN_ALREADY_SUBMITTED`
- **设备数量上限：** `device_index` 范围 1-5，超出返回 400 `DEVICE_INDEX_OUT_OF_RANGE`
- **输入校验：** `result` 字段只接受 `PASS/FAIL/BLOCKED/pending`；`kind` 字段只接受 `FR/NFR/Invariant/SOP`
- **版本禁止伪造：** 版本 API 查不到时显示 `Unknown (来源: ...)` 说明，禁止返回硬编码假版本

---

## Invariant 约束（铁律）

- **[租户隔离]** 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写
- **[测试默认多租户]** 单元/API 集成测试默认种 ≥2 个 tenant 并断言互不串
- **[日志脱敏]** 客户隐私/PII 不得明文进日志
- **[端点鉴权]** 所有 `/api/staff/ability-acceptance/*` 端点必须有 staffGuard；无鉴权端点不准 ship
- **[凭据安全]** secrets 不硬编码、不进 git、不进日志
- **[真环境验证才算 done]** 依赖公网 VPS 的 URL 验收必须在部署后真实访问才算 done；未真验的只能标 logic-done-pending
- **[product-map 唯一写源]** `ability_acceptance` 状态升级只在 `product-map/product-map.yaml` 修改，不在代码或 DB 中硬编码

---

## 累积 FR（本 Journey 已验收行为，不得回退）

- **[staffGuard 集成]** `POST /api/staff/skill-eval/upload` 不带认证头 → 403（已验收，来源 sprint 07090821）
- **[Path Health]** `/api/staff/path-health` 返回 3 条 path 的 journey features + smoke run 状态（已验收，来源 sprint 07211256）
- **[product-map 保序]** `productMapDigest` 同一 YAML 两次调用返回相同 hex（本 sprint 修复后列为累积 FR）

---

<!-- 不计入 thin-slice 行数上限，纯参考资料 -->
## Response Schema

**POST /runs** 请求体：`{ app_id, line_id, surface, task_id?, sha? }`  
响应：`{ success: true, data: { run_id: "uuid", status: "in_progress", created: true|false } }`  
- 首次创建：`created: true`；同 task_id+sha 再次请求：`created: false`，run_id 相同

**GET /versions** 响应：`{ success: true, data: { staging: { version, source }, production: { version, source }, diff_count, has_diff } }`  
- source 枚举：`env:STAGING_VERSION` / `file:VERSION` / `unknown`

---

## 边界情况

- `VERSION` 文件不存在或读取异常 → 版本字段返回 `Unknown (来源: VERSION 文件不可达)`，不中断请求
- staging / production 版本相同 → `diff_count: 0`，`has_diff: false`
- 创建 run 时 `task_id` 或 `sha` 缺失 → 允许（非必填），但无法触发幂等约束，每次创建新 run
- `device_index` 超过 5 → 400 `DEVICE_INDEX_OUT_OF_RANGE`
- run `status = submitted` 后录入 check → 400 `RUN_ALREADY_SUBMITTED`
- 模板表为空（未 seed）→ `GET /templates` 返回空数组 `[]`，前端提示「暂无验收项，请联系运营添加模板」
- `acceptance_template` seed 失败时 run 仍可创建，不阻塞 run 流程

---

## 预期受影响文件

### 新建文件

- `apps/api/db/migrations/20260728_ability_acceptance.sql`
- `apps/api/src/routes/ability-acceptance.ts`
- `apps/api/src/routes/__tests__/ability-acceptance.test.ts`
- `apps/staff-hub/src/pages/AbilityAcceptancePage.tsx`
- `apps/staff-hub/src/pages/AbilityAcceptanceHistoryPage.tsx`
- `apps/dashboard/e2e/ability-acceptance.spec.ts`
- `sprints/07281218-relay-30a0c83a/e2e-contract.sh`

### 修改文件

- `scripts/product-map/lib.mjs` — canonicalize 保序修复
- `scripts/product-map/cli.mjs` — generate 保序修复
- `product-map/product-map.yaml` — `ability_acceptance.status: proposed → active`
- `product-map/generated/product-map.json` — 重新生成（保序 + status 更新）
- `product-map/generated/product-map.md` — 重新生成
- `package.json` — 根 devDependencies 添加 `ajv@^8.17.1` + `ajv-formats@^3.0.1`
- `apps/api/src/app.ts` — 注册 `/api/staff/ability-acceptance` 路由
- `apps/staff-hub/src/App.tsx` — 新增 Ability 验收导航 + 路由
- `.github/workflows/ci-l2-consistency.yml` — 新增 ability-acceptance-smoke job

---

## E2E 验收（合同）

### Phase A：product-map 保序合同 E2E（10/10 PASS）

运行：`node --test scripts/product-map/__tests__/product-map.test.js`

**必须通过的关键断言：**
- T3：`ability_acceptance` status = `active`（本 sprint 升级后）
- T6：`productMapDigest` 确定性——同一 YAML 两次调用返回相同 hex（保序修复验证）
- T1-T10 全部 PASS（需在根 `package.json` 安装 `ajv@^8.17.1` + `ajv-formats@^3.0.1`）

### Phase B：API 集成合同 E2E

脚本：`sprints/07281218-relay-30a0c83a/e2e-contract.sh`（需 `$API_BASE` + `$DB`）

**必须验证的 9 条断言：**

| # | 场景 | 期望结果 |
|---|------|---------|
| 1 | 无认证头访问 `/runs` | HTTP 403 |
| 2 | 带 `X-User-Email` 访问 `/versions` | `success:true`，版本字段非空（可为 Unknown） |
| 3 | 首次 POST `/runs`（task_id=30a0c83a, sha=abc1234） | `created:true`，返回 run_id |
| 4 | 同参数二次 POST `/runs` | `created:false`，run_id 与第一次相同 |
| 5 | POST `/runs/:runId/devices/1/checks`（result=PASS） | `success:true` |
| 6 | POST `/runs/:runId/submit` | `success:true`，run status → submitted |
| 7 | submit 后再 POST checks | HTTP 400 `RUN_ALREADY_SUBMITTED` |
| 8 | DB 查 `acceptance_run.created_by` | 等于 `$STAFF_EMAIL` |
| 9 | 用 tenant_b 头查 runs 列表 | 不含 tenant_a 的 run_id（租户隔离） |

### Phase C：Playwright E2E（windows_cloud）

文件：`apps/dashboard/e2e/ability-acceptance.spec.ts`，全部场景使用 `page.route` mock API，不依赖真实 DB。

**必须验证的 5 个场景：**

| # | 场景 | 可见断言 |
|---|------|---------|
| 1 | staff 登录后 | 左侧导航出现「Ability 验收」入口 |
| 2 | 访问 `/ability-acceptance` | 版本概览卡片（staging / production 版本）可见 |
| 3 | 点击「新建验收 run」 | 验收项清单出现 |
| 4 | 选一条为 PASS → 点「提交验收」 | 页面出现「验收已提交」状态文字 |
| 5 | 访问历史页 | 已提交 run 列出，点击可展开明细 |

---

<!-- 不计入 thin-slice 行数上限，纯参考资料 -->
## CI Gate

`.github/workflows/ci-l2-consistency.yml` 新增 `ability-acceptance-smoke` job（ubuntu-latest, timeout 5m）：
- `npm install`
- `node --test scripts/product-map/__tests__/product-map.test.js`（10/10 PASS）
- 断言 `ability_acceptance.status === 'active'`（通过 `loadAndValidateProductMap()` 验证）

---

## 部署路径

Staff Hub 前端变更（`apps/staff-hub/**`）触发现有 `.github/workflows/deploy-staff-hub.yml`（push to main）：
1. `npm run build --workspace=apps/staff-hub` 产出 `dist/`
2. rsync 到 HK VPS `/opt/zenithjoy/staff-hub/dist/`
3. Docker 容器重启（nginx 静态服务）

API 变更（`apps/api/**`）触发现有 API 部署流水线（需人工卡点 promote 到 production，与 Staff Hub 部署分离）。

**部署后验收：**
- 可访问 URL：`https://staff.zenjoymedia.media/ability-acceptance`（具体域名以 VPS nginx.conf 配置为准）
- 部署版本：从 `GET /api/build-info` 真实返回的 `version` 字段确认
- 回滚锚点：合并时的 commit SHA，回滚命令 `git revert <sha> && git push origin main`

---

## 假设

- [ASSUMPTION: `apps/api/src/app.ts` 中的 tenant_id 来源由现有 middleware 注入（见现有 `staffRouter` 调用方式），本 sprint 复用同样的模式]
- [ASSUMPTION: Staff Hub 公网地址为 `https://staff.zenjoymedia.media`，以 deploy-staff-hub.yml + HK VPS nginx.conf 配置为准]
- [ASSUMPTION: `acceptance_template` 的 seed 数据（Line02/Android 的 FR/NFR/Invariant/SOP 清单）在合同 E2E 中通过迁移文件或 API seeder 插入；具体条数由 dev 阶段确认]
- [ASSUMPTION: product-map 合同测试 T3 从「ability_acceptance status=proposed」改为验证「status=active」，需同步更新 `scripts/product-map/__tests__/product-map.test.js` 中的断言]

---

## journey_type: autonomous
## journey_type_reason: 涉及后端 API + DB 迁移 + Staff Hub 前端 + product-map 修复，全链路可在 CI runner 自动验证（无需人工真机），命中"全链路自动化"分支
## target_environment: windows_cloud
## target_environment_reason: Staff Hub 是 ZenithJoy 系统，E2E 验收走 windows_cloud Playwright；API 合同测试已在 CI L4 内联跑（local_api 是 CI 内部分类，theater 路由统一用 windows_cloud）
