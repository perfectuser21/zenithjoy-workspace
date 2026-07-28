# Sprint PRD — Staff Hub Ability Acceptance 端到端首刀

task_id: 30a0c83a-47f4-4151-9636-a8cd2b6f1d7a
journey_id: 636a918c-8b23-4df5-baec-b1eb3308fffb
feature_id: 09edf50f-6cd3-4fda-8b21-7d2efcd075ec
sprint_dir: sprints/07281218-relay-30a0c83a

## 背景

ability_acceptance 当前在 `product-map/product-map.yaml` 状态为 `proposed`。本 sprint 完成
首刀交付：修 Product Map 保序缺陷、建 Postgres 数据模型、实现 Staff Hub `/ability-acceptance`
页面、补全合同 E2E，并将 ability_acceptance 推进到 `active`。

首个可验收 target：**客户 App / Line 02 / Android**（Line 不是 Surface）。

## Golden Path（核心场景）

Staff 用户在 `/ability-acceptance` → 选 Line02/Android target → 系统从 Postgres 读取
acceptance_template（FR/NFR/Invariant/SOP）→ 创建 acceptance_run（幂等，同 task+sha 不重复）
→ 录入最多 5 台设备的 device_result + check_result → 提交 PASS/FAIL/BLOCKED → 历史回看。

## 累积 FR

FR1. 修 PR #1486 product-map 保序缺陷，`npm run product-map:check` 合同 E2E 10/10 PASS。
FR2. `product-map/product-map.yaml` 将 ability_acceptance status 从 `proposed` 改为 `active`，
     并在 generated/product-map.md 中体现。
FR3. 新增 Postgres 迁移（`apps/api/db/migrations/`）建 4 张表：
     - `zenithjoy.acceptance_template`：id, target(line+surface), fr[], nfr[], invariant[], sop[], created_at
     - `zenithjoy.acceptance_run`：id, template_id, task_id, git_sha, env(staging|production), status, created_by, created_at, submitted_at；UNIQUE(task_id, git_sha)
     - `zenithjoy.device_result`：id, run_id, device_no(1-5), version, os_version, env_tag, acceptor, evidence_url, status(PASS|FAIL|BLOCKED), note, created_at
     - `zenithjoy.check_result`：id, run_id, check_type(FR|NFR|Invariant|SOP), ref_id, status, note, created_at
FR4. API 路由 `GET/POST /api/staff/ability-acceptance/*` 全部受 staffGuard 保护。
FR5. `GET /api/staff/ability-acceptance/templates` 返回 Line02/Android target 的模板（含FR/NFR/Invariant/SOP）。
FR6. `POST /api/staff/ability-acceptance/runs` 幂等创建 run，相同 task_id+git_sha 返回已有 run。
FR7. `GET /api/staff/ability-acceptance/runs/:id` 返回 run 详情含所有 device_result/check_result。
FR8. `PATCH /api/staff/ability-acceptance/runs/:id/devices/:deviceNo` 更新单台设备结果。
FR9. `POST /api/staff/ability-acceptance/runs/:id/submit` 提交 run，计算汇总状态（所有设备 PASS → PASS，任一 BLOCKED → BLOCKED，其余 FAIL）。
FR10. `GET /api/staff/ability-acceptance/runs?templateId=&status=` 分页列表，支持历史回看。
FR11. Staff Hub `/ability-acceptance` 页面：列表+详情+创建/继续/提交，展示 staging/production 真实版本与差异数（从 Brain 或 GitHub API 取），禁止静态假数据。
FR12. Harness 合并后可通过幂等 `POST /api/staff/ability-acceptance/runs` 自动生成 run；同一 task+sha 不重复（UNIQUE 约束）。
FR13. 所有写操作记录 `created_by`（staff email），所有输入经 Zod 校验，非法请求返回 422。
FR14. 单测覆盖核心纯函数（幂等判断、汇总状态计算）；API 集成测试覆盖 FR4/FR6/FR9；Playwright E2E 含截图。

## NFR

NFR1. staffGuard 保护所有 `/api/staff/ability-acceptance/*` 端点；未认证返回 403。
NFR2. 租户隔离：acceptance_run/device_result 通过 created_by email 绑定，跨 staff 只读不写。
NFR3. 输入校验：Zod schema，device_no ∈ [1,5]，status ∈ {PASS,FAIL,BLOCKED}，env ∈ {staging,production}。
NFR4. 版本信息从真实 API（Brain/GitHub）获取，禁止硬编码。
NFR5. 合并后可通过 CI workflow 触发自动创建 run，幂等无副作用。

## Invariant 约束

INV1（租户隔离铁律）：任何 API 路由不得返回其他 staff 的 device_result 写操作权限；
     查询列表可全量只读，写入绑定 created_by = 当前 staff email。
INV2（staffGuard 铁律）：所有 `/api/staff/*` 路由必须经过 `staffGuard` 中间件；
     绕过 staffGuard 的路由注册视为安全漏洞，PR 直接拒绝。
INV3（Product Map SSOT）：`product-map/product-map.yaml` 是唯一手写分类来源；
     任何手工修改 `product-map/generated/` 的 PR 直接拒绝。
INV4（幂等写入）：相同 task_id+git_sha 的 acceptance_run 只能存在一条（DB UNIQUE 约束）；
     重复 POST 返回 200 含已有 run，不得新建。
INV5（设备上限）：单个 run 最多 5 台设备（device_no ∈ {1,2,3,4,5}），超出返回 422。
INV6（禁止静态假数据）：`/ability-acceptance` 页面版本号、差异数必须来自真实 API；
     localStorage-only、假 diff、假版本视为交付失败。

## 边界情况

- Brain API 不可达时版本/差异数降级展示"暂不可用"，不 crash 页面。
- git_sha 为空字符串时 POST /runs 返回 422。
- 提交已 submitted 的 run 返回 409。
- device_no 重复写入覆盖（UPSERT），不重复插入。

## 范围限定

**在范围内**：4 张表迁移、staffGuard 保护的 CRUD API、Staff Hub UI、幂等 run 创建、单测+API集成+Playwright E2E、product-map SSOT 保序修复 + active 状态推进、公网部署（沿用现有 Harness）。

**不在范围内**：多租户写隔离（本期只读全量，写绑定 created_by）、移动端 UI、自动执行验收（人工录入）、Notion 同步。

## 假设

- [ASSUMPTION: Brain API（localhost:5221）提供 journey features 接口，可从中取 staging/production 版本信息]
- [ASSUMPTION: 客户 App Line02 Android 已有可填写的 FR/NFR/Invariant/SOP 内容，由 seed 迁移写入]

## E2E 验收断言

E2E1. `psql $DB -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='zenithjoy' AND table_name IN ('acceptance_template','acceptance_run','device_result','check_result')"` 返回 4。
E2E2. `POST /api/staff/ability-acceptance/runs`（相同 task+sha 调两次）两次均返回 200，run id 相同。
E2E3. Playwright 截图：`/ability-acceptance` 页面含 `[data-testid="ability-acceptance-list"]` 元素。
E2E4. `POST /api/staff/ability-acceptance/runs/:id/submit` 后 DB 中 run.status 字段非 null。
E2E5. `product-map/generated/product-map.md` 中 ability_acceptance 行 status 列为 `active`。

---

journey_type: staff_tool
target_environment: windows_cloud
