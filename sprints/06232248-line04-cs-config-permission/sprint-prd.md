# Sprint PRD — 客服配置写接口安全闸（管理员 + 租户隔离）+ 管理员前台补全

## OKR 对齐

- **对应 KR**：Line 04 客户私域 AI 接管 — 客服层多租户隔离硬化（feature ca26491c，working）
- **当前进度**：客服配置可读写但写接口无权限闸（串台风险敞口）
- **本次推进预期**：堵死配置写接口越权写库漏洞（issue 96db53be P1）+ 补管理员前台营业时间/daily_limit 入口（issue d2987606 P2）

## 背景

`wechat-config.ts` 的写接口 `PUT /cs/config/:wechatId`、`/cs/setup/:machineId`、`/cs/auto-agent` 当前无 guard / 无 tenantContext：任何持有 better-auth session 的登录用户都能改任意客服配置 = 串台风险（issue 96db53be P1）。同时后端 8 个配置项前台只暴露 4 个，营业时间(start/end)、daily_limit 无前台入口（issue d2987606 P2）。本 sprint 复用 `tenant_members` 角色 + `customer-admin.ts` 校验模式，不改表，给写接口装上「管理员 + 租户隔离」安全闸并补全前台入口。

## Golden Path（核心场景）

管理员从 [dashboard 客服机配置页入口] → 经过 [设置某客服机配置并保存] → 到达 [仅本租户本客服那一行生效 + 越权请求一律 403 不写库]

具体：
1. 管理员登录 dashboard → 进客服机配置页 → 给某客服机设人设/白名单/真发开关/营业时间/每日上限 → 点保存
2. 系统校验【当前用户是该客服机所属租户的 admin/owner】→ 通过 → 仅该租户该客服那一行写入生效
3. 可观测结果：保存成功，刷新页面读回新值（含新增的营业时间、每日上限）
4. 非管理员（member / 无 role）调写接口 → 系统返回 403 且 DB 未变，前台显示"仅管理员可配置"
5. 别家公司管理员改本公司客服配置 → 系统返回 403/404 且 DB 未变（租户隔离）
6. 无 session 调写接口 → 401
7. deny by default：解析不出当前用户租户/角色，或目标客服机解析不到所属租户 → 拒绝写入（不放行）

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 鉴权解析不出当前用户的租户/角色 → deny by default，拒绝写入
- 目标客服机（machineId/wechatId）解析不到所属租户 → 拒绝，不默认放行到任一租户
- member 角色（既非 owner 也非 admin）→ 视为非管理员，拒绝
- 跨租户：用户是 A 公司管理员，目标客服属 B 公司 → 拒绝

## 范围限定

**在范围内**：
- `/cs/config` `/cs/setup` `/cs/auto-agent` 三个写接口挂租户上下文 + 角色闸（非管理员/跨租户 → 403 不写库）
- 管理员前台补营业时间(start/end)、daily_limit 输入入口（PerCsConfigPage / CsOneClickSetupPage）
- 自检诊断页 `/cs/diagnostics` 前台入口（issue 5e93d525 P3，能塞则塞）

**不在范围内**：
- 客服只读登录"客服视角"（并进 S3）
- 字段级权限（客服啥都不设，二元权限即可）
- 角色管理 UI / 新建角色体系（沿用现有 tenant_members owner/admin）
- 中台全局 NFR（频控/超时/去重/真发 gate）任何改动
- 不新增表、不改 `wechat_cs_account_config` 表结构

## 假设

- [ASSUMPTION: `customer-admin.ts` 现有 role 校验模式可直接复用到客服配置写接口的 guard]
- [ASSUMPTION: `service_agents`/`license_machines` 能从 machineId/wechatId 解析到所属租户]
- [ASSUMPTION: better-auth session 中间件已能解出 user_id 供 tenant_members 查角色]

## 预期受影响文件

- `wechat-config.ts`（或对应 cs 配置路由）：写接口前加 tenantContext + 角色 guard
- `customer-admin.ts`：复用其角色校验模式（不改其行为）
- `apps/dashboard/` PerCsConfigPage / CsOneClickSetupPage：补营业时间、daily_limit 输入；非管理员只读/禁用
- regression test：越权写被拒、租户隔离、deny by default

## NFR 约束

<!-- 来源: decisions 表 category=nfr（离线不可达，置空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 不动中台全局 NFR（保持现状）
- 版本要求: 无
- 可观测: 越权拒绝走标准 403/404/401，前台显示"仅管理员可配置"
- 安全默认: deny by default — 解析不出租户/角色一律拒绝写入

## E2E 验收

> Planner 初稿此区块留占位 + 自然语言验收点。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment（windows_cloud）产出，写进 contract-draft.md。

```bash
# 占位：proposer 将按 target_environment=windows_cloud 填入真实脚本（curl 后端越权断言 + Playwright UI 断言）
# 期望验收点（自然语言）：
# 1. 越权拒绝（核心安全断言）：非管理员 member session 调写接口 → 403 且 DB 未变（钉死 issue 96db53be）
# 2. 租户隔离：A 公司管理员改 B 公司客服配置 → 403/404 且 DB 未变
# 3. 管理员正常路径：本租户管理员改本客服配置 → 200 + DB 写入正确
# 4. 无 session → 401
# 5. deny by default：构造解析不出租户/角色的请求 → 拒绝（不放行）
# 6. Playwright（windows_cloud）：管理员登录看到营业时间+daily_limit 输入框、设置保存读回；非管理员打开配置页只读/禁用
# 7. CI 全绿（含 lint-feature-has-smoke / lint-tdd-commit-order）
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/（PerCsConfigPage / CsOneClickSetupPage）管理员配置页交互，按优先级链命中 user_facing
## target_environment: windows_cloud
## target_environment_reason: PrepPRD 验收明确 Playwright 走 windows_cloud（GitHub Actions windows-latest 干净 VM），ZenithJoy UI 测试统一走云端 runner
## journey_id: bfeed805
## step_id: L04 — 客服层多租户隔离（feature ca26491c）
