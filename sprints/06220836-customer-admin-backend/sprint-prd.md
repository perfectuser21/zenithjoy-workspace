# Sprint PRD — 客户管理后台（公司名 / 子账号 / 客服-PC 绑定 / 诊断报告页）

## OKR 对齐

- **对应 KR**：Line 10 客户管理 — 管理员后台贯穿（首刀）
- **当前进度**：0%（全新 journey，无前置 Run）
- **本次推进预期**：管理员具备「设公司名 + 建子账号 + 绑客服PC + 看诊断」最小闭环

## 背景

管理员目前没有地方给客户公司起名（仍是 `Personal-邮箱` 硬编码），无法给一家公司配多个子账号，也无法把客服绑到指定 PC，更看不到客户机的体检报告（要客户自己截 terminal）。本 sprint 是 Line 10 的第一刀，建立管理员可操作的最小后台闭环。复用既有 tenants / license_machines / better-auth / module-health API，不动注册、计费、RBAC。

## Golden Path（核心场景）

管理员从 [客户管理页] → 经过 [设公司名 → 建子账号 → 绑客服PC → 看诊断] → 到达 [一家公司被完整配好且每台机器体检可见]

具体：
1. 管理员进「客户管理」页 → 新建/编辑公司 → 填**公司名** → 系统写 `tenants.name`（不再 Personal-邮箱）→ 列表显示新公司名
2. 进公司详情页 → 点「新增账号」→ 填邮箱 / 显示名 / 角色（admin | operator | service_agent）→ 系统建 `tenant_sub_accounts` 行 → 列表出现该账号（一公司可建 3~5 个，受 license plan 上限约束）
3. 进「客服-PC 绑定」页 → 选一个 service_agent 账号 + 选一台已注册机器（license_machines.machine_id）→ 绑定 → 系统写 `service_agents(account↔machine)` → 列表显示「客服 X @ PC Y ● 在线」
4. 进「诊断报告」页 → 选一台客户机 → 调 `GET /api/agent/module-health` → 表格显示该机各模块 ✅/❌ + 原因 + 上报时间

## 边界情况

- 子账号数超 license plan 上限 → 报错「配额已满，当前 N/M」，不写库
- 客服-PC 绑定占用 license.max_machines，超额 → 硬拒，不写库
- 1 客服已绑 PC 再重复绑 / 1 PC 已被绑再被绑 → DB 双唯一约束拒绝，提示已绑定
- 诊断数据为空（客户机从未上报）→ 显示「该机暂无上报，请确认 Agent 已连中台」
- 账号 / 绑定删除 → 软删（`deleted_at`），列表不再显示，记录保留

## 范围限定

**在范围内**：公司名 CRUD（复用 tenants.name）/ 子账号 CRUD（含 role）/ 客服-PC 绑定（1:1 + 配额）/ 诊断报告展示（复用 module-health）/ 软删 / 轻量审计 / 租户隔离

**不在范围内**：注册自助流程、计费/license 发放 UI、细粒度 RBAC、子账号登录鉴权改造、对标账号自动拉取

## 假设

- [ASSUMPTION: 子账号本 sprint 只做管理 CRUD，不接入实际登录鉴权]
- [ASSUMPTION: license plan → 子账号上限映射沿用现有 plan 字段（basic/matrix/studio/enterprise）]
- [ASSUMPTION: 诊断页数据完全来自现成 `/api/agent/module-health`，本 sprint 不新增上报字段]
- [ASSUMPTION: migration 落 `apps/api/db/migrations/`（SQL 文件，幂等重入）]

## 预期受影响文件

- `apps/api/db/migrations/<新>_customer_admin_backend.sql`：建 `tenant_sub_accounts` / `service_agents` 表 + 双唯一约束 + 租户隔离 + 软删字段
- `apps/api/src/routes/`：新增 `/api/tenant/:id/accounts`、`/api/tenant/:id/service-agents`、`/api/tenant/:id/service-agents/:aid/bind-device`，及 `PUT /api/tenant/:id`（改公司名）
- `apps/dashboard/src/pages/`：扩 `AdminCustomersPage.tsx` 或新建客户管理页（公司 / 子账号 / 绑定 / 诊断 4 区）
- `apps/dashboard/src/api/`：新增对应 api 封装（诊断复用 `moduleHealth.api.ts`）
- `.github/workflows/scripts/smoke/customer-admin-backend-smoke.sh`：全链 curl smoke
- `apps/dashboard/e2e/customer-admin-backend.spec.ts`：管理员操作 Playwright e2e

## NFR 约束

<!-- 来源: PrepPRD 显式 NFR（用户 2026-06-22 确认）；decisions?category=nfr 为空，无副源补充 -->
- **子账号上限**：跟随 license plan 配额，超限拒绝并提示「配额 N/M」
- **客服↔PC 绑定基数**：1 客服 : 1 PC，`service_agents.account_id` UNIQUE + `machine_id` UNIQUE 双唯一，DB 层 enforce
- **机器配额**：客服-PC 绑定占用 license.max_machines，超额硬拒（复用现有逻辑）
- **软删**：账号 / 绑定走 `deleted_at`，不物理删
- **审计**：建/改/删账号·绑定记轻量 audit（who / when / what）
- **诊断刷新**：手动刷新为主，可选 30s 自动
- **租户隔离**：所有读写按 tenant_id 过滤，子账号 / 客服绝不跨公司可见

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 `target_environment=windows_cloud` 产出 Playwright `.spec.ts` + smoke `.sh`，写进 contract-draft.md。

```bash
# 占位：proposer 将按 windows_cloud 填入 GitHub Actions windows-latest Playwright 脚本 + curl smoke
# 期望验收点（自然语言）：
#   1) curl 建公司(设名)→建 3 个子账号(1 个 service_agent)→绑 1 客服到 1 PC→GET module-health 返回该机模块表，全链 200/写库成功
#   2) 超 license plan 上限建账号 → 4xx「配额 N/M」，DB 无新行
#   3) 重复绑同一客服 / 同一 PC → 4xx，DB 双唯一约束拒绝
#   4) windows_cloud Playwright：管理员在 Dashboard 真完成「建公司→建 3 账号→绑 1 客服 1 PC→看到该机诊断表」，每步 UI 可见状态变化
```

## journey_type: user_facing
## journey_type_reason: 核心交付物是 apps/dashboard/ 管理员可操作页面，命中 user_facing 优先级链首条
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard UI E2E 死规则 — 走 GitHub Actions windows-latest 干净 VM 跑 Playwright（PrepPRD 显式指定）
## journey_id: e6270293-7ca3-4261-b01d-4de4c66e0352
## step_id: L10-S1
