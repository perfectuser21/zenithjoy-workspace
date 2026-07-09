# 小改动 PrepPRD：刀B 跨 Line 接缝 nightly E2E（integration-cross-line.yml，云端真后端）

## 改什么

新建 1 条 workflow + 1 个 smoke 脚本，云端（ubuntu-latest）起真 postgres + 真 apps/api，验证 Line02（智能获客）→ Line04（私域 CRM）跨 Line 后端链路在同一租户下贯通、租户隔离不破。

### ① `.github/workflows/scripts/smoke/cross-line-seam-smoke.sh`（新建，commit-1 先行）

真实链路调用（curl + psql），步骤：

1. **种租户**：psql 直插 `zenithjoy.tenants` 两条（tenant-A / tenant-B），及 smoke 所需最小前置数据（agent/账号等按 API 鉴权要求补齐）。
2. **Line02 写侧**：走 acquisition 链路把一条 lead 落进 `zenithjoy.acquisition_leads`（tenant-A）——优先走真实 API（`apps/api/src/routes/acquisition.ts` 的上报路径）；API 鉴权拿不到 agent 上下文时允许 psql 种入，但必须在脚本注释里诚实标注该步的真实度。
3. **接缝步 `[SIMULATED-JOIN]`**：模拟「lead 私信引导加企微 → 真人加微信 → agent 扫好友入册」这条现实中的人工链路——psql 插 `crm_customers`（source='scan'，tenant-A）+ 一条 `cs_memory_messages`。脚本输出和注释必须醒目标注 **此步为模拟，非真实 RPA 接缝**（假绿灯治理纪律，同 PR#1193）。
4. **Line04 读侧**：curl `GET /api/crm/customers`（tenant-A 上下文）→ 断言该客户出现在三源合并名册里。
5. **跨 Line 租户隔离断言**：tenant-B 上下文查 CRM → 断言看不到 tenant-A 的客户；tenant-B 查 acquisition leads → 断言看不到 tenant-A 的 lead。（回归 PR#1152 tenant_id 断链 bug 类。）

### ② `.github/workflows/integration-cross-line.yml`（新建，commit-2）

- **name 诚实自报**：`[CLOUD] integration-cross-line — 跨Line接缝云端真后端E2E（接缝步为SIMULATED-JOIN，非真机RPA）`
- 触发：`schedule`（UTC 20:30 = 北京 04:30，错开刀A 北京 03:00 真机 nightly）+ `workflow_dispatch`。
- job1 `cross-line-e2e`（ubuntu-latest）：照抄 `e2e-line02-lead-human-handoff-windows.yml` 第 50-128 行范式——`services.postgres`（postgres:15）→ 建 schema+pgcrypto → 遍历跑 `apps/api/db/migrations/*.sql` → build + 启动 `apps/api`（node dist/index.js :5200）+ health check → 跑 ①。
- job2 `nightly-report`（`if: always()`，needs job1）：红了 `gh issue create`，标题前缀 **`[cross-line-red]`**（与刀A 的 `[nightly-red]` 区分，避免同日去重互相吞），同日去重 + body 含 run 链接 + flaky 约定（先 rerun 一次，连续 2 晚红 = 真 bug 走 /dev）。红时 exit 1。
- 不设 required（nightly 轨，非每 PR 闸）。

## 为什么改

CI/CD 6站2轨模型刀序第 3 刀（0709 handoff 用户已认规划）。现状：Line02 Lead E2E 与 Line04 CRM E2E 各自有闸（PR#1189），但**两条 Line 的后端从未在同一 DB/同一租户下合跑过**——migrations 组合、租户链贯通、三源合并名册与获客数据共存，全靠各自绿灯拼凑信念。本刀补上「云轨 full check」的跨 Line 一层。

调研坐实：两 Line 之间无代码级自动接缝（身份 key 抖音 sec_uid vs 微信昵称，无 lead→customer 转换），真实接缝是人工链路。故本 E2E 的接缝步只能模拟，且必须诚实标注——这不削弱价值：它守的是「两 Line 后端合跑 + 租户链 + migrations 组合」这三样目前零覆盖的东西。

## 关联上下文

- 相关 Journey：Line02 客户智能获客 + Line04 私域 AI（dev_pipeline 性质，同刀A/刀C）
- Brain task：d242b121-b1db-49b4-960e-8c473570f8f2
- 承接：PR#1206（刀A nightly 真机）、PR#1208（刀C Release Gate）、PR#1189（两 Line 各自 gate）
- 范式来源：`e2e-line02-lead-human-handoff-windows.yml`（云真后端）+ `nightly-real-machine-staging.yml`（红开 Issue）

## 影响范围

纯新增（1 workflow + 1 smoke 脚本），不改任何现有 workflow/代码/断言。nightly 轨非 required，红了只开 Issue 不挡 PR。PR 标题带 `[CONFIG]`。

## 验收标准

- [ ] commit-1 = 失败的 smoke 脚本先行（E2E-first），commit-2 = workflow 接线跑绿
- [ ] smoke 脚本含真实 curl+psql 链路 ≥5 行实质内容，`bash -n` 通过
- [ ] `[SIMULATED-JOIN]` 步在脚本输出与 workflow name 中均诚实标注
- [ ] 租户隔离断言双向（A 看不到 B，B 看不到 A）
- [ ] workflow_dispatch 手动触发一次真跑全绿（proven to work）
- [ ] proven-to-fire：故意弄坏一次（如断言一个不存在的客户）亲眼看 job 红 + `[cross-line-red]` Issue 真开出来，再恢复
- [ ] CI 全绿，PR 标题带 `[CONFIG]`
