# Sprint PRD — Line02 机器管理模块（管理客户机器 + 在机器上绑定/管理抖音号）

## OKR 对齐

- **对应 KR**：Line02 智能获客 — 客户机器与抖音号资产可视化管理
- **当前进度**：零散零件已存在（agents 表 / agent_platform_sessions / qr-bind / 健康看板）
- **本次推进预期**：把零件组装成统一「机器管理」模块（thin）

## 背景

Line02 已有：agents 表（机器自动注册：hostname/在线/版本/能力）、agent_platform_sessions（抖音号绑机器，role 主号/小号）、qr-bind（拉 Chrome 扫码存 session）、/api/agent/burner/sessions、模块健康看板。本次不重造，把这些组装成运营可用的统一「机器管理」后台。

## Golden Path（核心场景）

运营从 [进入机器管理页] → 经过 [看机器列表 → 命名/标主副 → 点进机器看抖音号 → 在机器上加号扫码] → 到达 [号出现在该机器下，资产一眼可见]

具体：
1. 运营进「机器管理」页 → 看到本租户所有机器列表，每台显示：名称（nickname）/ hostname / 在线状态 / 版本 / 角色（主机器/副机器）/ 该机器上登的抖音号数量
2. 运营给某台机器命名、标记主机器/副机器 → 保存 → 刷新后持久化
3. 运营点进一台机器 → 看到该机器上绑的抖音号列表（主号/小号 + session 有效性）
4. 运营在该机器上点「添加抖音号」→ 中台派 qr-bind 任务到该机器 → （本次 fake-agent 模拟回写）→ 新号出现在该机器下
5. 机器离线 → 列表标红；session 失效 → 该号标失效，可在对应机器上「重新扫码」

## 边界情况

- 机器离线：列表项标红，仍可查看历史绑定的号
- 该租户无机器：空状态提示
- 同一抖音号重复添加：以 session 唯一性为准，不重复列出
- qr-bind 派单失败：回报错误码，运营可重试

## 范围限定

**在范围内**：
- agents 表补 `nickname` + `machine_role`(main/sub) 字段（migration）
- 新增 API：`GET /api/agent/machines`（按 tenant 列机器 + 每台号数）、`GET /api/agent/machines/:id`（机器详情 + 其 sessions）、`PUT`（改名 / 改角色）
- 新增 API 配 vitest 单测
- 前端：新建机器管理页 + 接入 navigation（智能获客板块下）+ App 路由
- 「添加抖音号」复用 qr-bind 派单链路（本次 fake-agent 验证派单 + 回写）

**不在范围内**：
- 真机端到端扫码（本次 e2e 用 fake-agent 验证派单+回写逻辑；真机扫码另附证据）
- 多租户计费

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本地为空）+ PrepPRD（未显式给数值）；PrepPRD 显式值优先 -->
- 租户隔离：machines 列表/详情必须按当前 tenant 过滤，不得跨租户泄露
- session 有效性校验：失效号需可见标记 + 告警（PrepPRD 要求"持续校验"，具体周期待定）
- 超时/频控/版本要求：待定（PrepPRD 未指定，Proposer 阶段如需可向用户确认）

## 假设

- [ASSUMPTION: 机器（machine）= agents 表一行，复用其 hostname/在线/版本/能力字段，不新建实体表]
- [ASSUMPTION: 抖音号 = agent_platform_sessions 一行，复用其 role(main/sub) 与有效性字段]
- [ASSUMPTION: Playwright e2e 走 VITE_SKIP_AUTH，数据来自真 API/seed]
- [ASSUMPTION: 「添加抖音号」派单沿用现有 qr-bind 协议，前端只触发派单不直接拉浏览器]

## 预期受影响文件

- `apps/api/db/migrations/`: agents 加 nickname + machine_role 字段
- `apps/api/src/routes/agent.ts`（或新增 `agent-machines.ts`）: machines 列表/详情/改名改角色 API
- `apps/api/src/services/agent-db.ts` / `agent-registry.ts`: 机器+号数聚合查询
- `apps/api/tests/`: 新增 machines API + migration vitest 单测
- `apps/dashboard/src/`: 新建机器管理页 + 机器详情视图
- `apps/dashboard/src/config/navigation.config.ts`: 智能获客板块下加入口
- `apps/dashboard/src/App.tsx` / `DynamicRouter.tsx`: 注册路由
- `apps/dashboard/e2e/`: 机器管理 Playwright spec

## E2E 验收

> 本区块 Planner 留占位 + 自然语言验收点。最终可执行 Playwright 脚本由 proposer 在 GAN 阶段按 target_environment=windows_cloud 产出 `.ps1` + Playwright spec，写入 contract-draft.md。

```bash
# 占位：proposer 按 windows_cloud（GitHub Actions windows-latest）填入 Playwright + vitest 真实脚本
# 期望验收点（自然语言）：
#  1. 机器管理页渲染机器列表（来自真 API/seed），含名称/在线/角色/号数列
#  2. 命名机器 + 标主副 → 保存 → 刷新后持久化（PUT 生效）
#  3. 点进一台机器显示其抖音号列表（主号/小号 + 有效性）
#  4. 点「添加抖音号」派单后（fake-agent 模拟回写）新号出现在该机器下
#  5. vitest：machines 列表/详情/改名 API + migration 单测全过
#  6. CI 全绿
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ 新建机器管理页 + 前端交互，按 if-elif 链命中 user_facing
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy UI 死规则 + PrepPRD 显式 target，E2E 走 GitHub Actions windows-latest 干净 VM
## journey_id: afa6abca
## step_id: Line02-机器管理（PrepPRD Golden Path 锚定；无正式 step code，按机器管理模块锚定）
