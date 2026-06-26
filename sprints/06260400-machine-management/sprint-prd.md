# Sprint PRD — 机器管理模块（机器列表 + 主副命名 + 机器下管抖音号 + 在机器上加号）

## OKR 对齐

- **对应 KR**：Line02 智能获客 — 客户机器与抖音号自助管理
- **当前进度**：零件已就位（agents 表 / agent_platform_sessions / qr-bind / burner sessions），未组装成统一模块
- **本次推进预期**：把零散零件组装成「机器管理」可用页面（thin）

## 背景

客户的本地 Agent 已能自动注册到中台（agents 表：hostname/在线/版本/能力），抖音号绑定走 qr-bind 拉 Chrome 扫码存 session（agent_platform_sessions，role 区分主号/小号）。但运营没有统一入口去「看自己有几台机器、每台登了哪些号、在某台机器上加号」。本 sprint 复用上述后端，组装成统一的机器管理后台。

## Golden Path（核心场景）

运营从 [智能获客 → 机器管理入口] → 经过 [看机器列表 → 命名/标主副 → 点进机器看抖音号 → 在该机器加号] → 到达 [新号出现在该机器下]

具体：
1. 运营进「机器管理」页 → 看到本租户所有机器列表，每台显示：名称、hostname、在线状态、版本、角色（主/副）、其上抖音号数量
2. 运营给某台机器改名 + 标记主机器/副机器 → 保存 → 刷新后持久化
3. 运营点进一台机器 → 看到该机器上绑定的抖音号列表（昵称 / role 主号·小号 / session 有效性）
4. 运营在该机器上点「添加抖音号」→ 中台派 qr-bind 任务到该机器 → Agent 本地拉 Chrome 弹扫码（本 sprint 用 fake-agent 模拟回写）→ 新号出现在该机器下
5. 机器离线 → 列表中该机器标红；号 session 失效 → 标记失效，可在对应机器上「重新扫码」

## 边界情况

- 机器离线时仍可查看其历史绑定的号，但「添加抖音号」按钮置灰或提示离线
- 同一机器无任何抖音号时显示空状态，仍可加号
- 改名为空 / 角色非法值 → 后端拒绝并返回错误
- fake-agent 回写失败（错误码）→ 页面提示可重试

## 范围限定

**在范围内**：机器列表 / 机器详情（含其抖音号）/ 改名 + 主副角色持久化 / 在机器上派 qr-bind 加号（fake-agent 验证派单+回写链路）/ session 有效性展示 / 离线标红
**不在范围内**：真机端到端扫码（另附证据）、多租户计费、多号矩阵自动化、自动选号策略

## 假设

- [ASSUMPTION: 机器与抖音号均按 tenant_id 隔离，列表只返回当前租户的机器]
- [ASSUMPTION: agents 表需新增 nickname（可空，默认 hostname）+ machine_role（main/sub，默认 sub）字段]
- [ASSUMPTION: 入口挂在 dashboard 导航「智能获客」板块下]
- [ASSUMPTION: e2e 用 VITE_SKIP_AUTH 跳过登录]

## 预期受影响文件

- `apps/api/db/migrations/`: 新增 migration — agents 加 nickname + machine_role
- `apps/api/src/routes/agent.ts`（或新 agent-machines 路由）: 新增 GET /api/agent/machines（按 tenant 列机器 + 每台号数）、GET /api/agent/machines/:id（机器 + 其 sessions）、PUT /api/agent/machines/:id（改名 + 角色）
- `apps/api/src/routes/agent-burner.ts`: 复用 qr-bind 派单（在机器上加号）
- `apps/dashboard/src/`: 新建机器管理页 + 机器详情视图 + API client
- `apps/dashboard/src/config/navigation.config.ts`: 接入导航入口
- `apps/dashboard/e2e/`: 新增机器管理 Playwright e2e

## NFR 约束

<!-- 来源: decisions 表 category=nfr（空）+ PrepPRD（未显式 NFR）；缺值留待 Proposer 确认 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（加号派单沿用 qr-bind 现有约束）
- 版本要求: 无
- 可观测: 加号派单 + fake-agent 回写失败需返回错误码，页面可见可重试

## E2E 验收

> Planner 初稿留占位；最终可执行 Playwright 脚本由 proposer 在 GAN 阶段按 target_environment=windows_cloud 产出，写入 contract-draft.md。

```bash
# 占位：proposer 将填入 windows_cloud（GitHub Actions windows-latest）Playwright 脚本
# 期望验收点（自然语言）：
# 1. 机器管理页渲染机器列表（来自真 API / seed），每台显示名称/在线/角色/号数
# 2. 点进一台机器显示其抖音号列表（昵称/role/session 有效性）
# 3. 改名 + 标主副 → 保存 → 刷新后持久化
# 4. 在机器上点「添加抖音号」→ 派单 → fake-agent 模拟回写 → 新号出现在该机器下
# 5. vitest：machines 列表/详情/改名 API + migration 单测通过；CI 全绿
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ 新建机器管理页 + 导航入口，运营在浏览器操作
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy UI 死规则 — 任何 Dashboard/前端走 GitHub Actions windows-latest 干净 VM（PrepPRD 显式 target=windows_cloud）
## journey_id: afa6abca
## step_id: L02-S5（在机器上绑定/管理抖音小号）
