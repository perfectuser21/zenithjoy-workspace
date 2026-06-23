# Learning — Line04 客服配置写接口安全闸（管理员 + 租户隔离）

**Sprint**: 06232248-line04-cs-config-permission · **journey**: Line04 客户私域 AI 接管（feature ca26491c）

## 做了什么

给三个客服配置写接口装上「管理员角色闸 + 租户隔离 + deny-by-default」安全闸，堵死 Issue 96db53be P1（任何登录用户可改任意客服配置 = 串台）：

- 新增 `apps/api/src/middleware/cs-config-guard.ts`：`requireCsAdmin`（member/无 role → 403 NOT_ADMIN）+ `requireSameTenant(kind)`（目标客服所属租户 ≠ 当前租户 → 403 CROSS_TENANT；解析不出目标租户 → 404 TARGET_NOT_FOUND，绝不放行写库）。
- `wechat-config.ts` 三写接口前置 `tenantContext → requireCsAdmin → requireSameTenant`：
  - `PUT /cs/config/:wechatId`（按 service_agents.wechat_id 解析目标租户）
  - `PUT /cs/setup/:machineId`（按 license_machines JOIN licenses 解析，与 setupCSByMachine 同源）
  - `PUT /cs/auto-agent`（全局单行，仅角色闸；原 superAdminGuard 不认 dashboard better-auth session → 换 tenantContext）
- 新增 `GET /cs/my-role` 供前台渲染只读态。
- 前台 PerCsConfigPage / CsOneClickSetupPage 补营业时间 start/end + daily_limit 输入；PerCsConfigPage 非管理员整页只读 + 「仅管理员可配置」提示（my-role 拉取失败 → deny by default 只读）。

## 关键决策 / 复用

- **复用既有租户基础设施**：`tenantContext`（better-auth session / X-Feishu-User-Id → tenant_members 角色）+ `customer-admin.ts` 的嵌套 `error.code` 拒绝形状，不新增表、不改 wechat_cs_account_config 结构。
- **目标租户解析必须真表推导**：wechat_id → service_agents.tenant_id；machine_id → license_machines→licenses.tenant_id。不 hardcode，deny by default。
- **super-admin（X-Bypass-Tenant）通道**：requireSameTenant 对 super-admin 短路跨租户比对（tenantId='' 不会误判），但仍要求目标可解析（404 兜底）。

## 踩坑 / 给后人的提醒

- **vitest 3.2.6 不接受一条命令里两个 `-t`**（`Expected a single value for option -t`）。contract-dod.md 的 [BEHAVIOR] 命令 #5/#6 各传了两个 `-t`，evaluator 直接跑会在 CLI parse 崩。等价正确写法是单正则 `-t "A|B"`。本 sprint 所有被引用测试单跑全过（已贴证据）。**proposer 写 [BEHAVIOR] vitest 命令时，多个用例要用 `-t "名A|名B"` 单正则，别堆多个 `-t`。**
- 测试用 supertest + mock pg pool + mock 写库 store：断言对象 = 真实 HTTP code/error.code + 写库 store 调用次数（越权必须 0 调用），generator 不写真闸无法转绿。
