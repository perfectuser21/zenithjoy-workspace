---
journey_type: internal_tool
target_environment: windows_cloud
---
# Sprint PRD — Staff Hub 员工中心第一刀（Skill 验收迁移 + Path 健康分析）

## Invariant 约束

- I-1: 员工入口必须独立于 `apps/dashboard`，客户前端不得再暴露 Skill 验收入口。
- I-2: Skill 评测执行体仍跑在 mmv/Cecelia Brain，ZenithJoy 只做员工鉴权、反代和展示，不搬执行逻辑。
- I-3: Path 健康数据不可达时必须明确展示“服务暂不可达”，禁止误报成“无数据”或“已完成”。
- I-4: Staff Hub 前端不得直连 Anthropic/OpenAI SDK；任何评测与健康数据都走后端。
- I-5: 飞书登录只作为员工入口；未命中 `STAFF_EMAILS` 白名单的账号不能访问 Staff Hub 核心页面。

## 累积 FR

- FR-1: 新建独立应用 `apps/staff-hub`，有独立登录页、首页与路由骨架。
- FR-2: Staff Hub 复用飞书登录能力，登录成功后进入员工首页。
- FR-3: Skill 验收页从 `apps/dashboard` 迁到 `apps/staff-hub`，上传、轮询、报告展示能力保持可用。
- FR-4: `apps/dashboard` 删除 `/staff/skill-eval` 入口、页面路由与全宽规则，不再作为员工工具承载。
- FR-5: 后端保留 `/api/staff/skill-eval/*` 契约，供新前端继续使用。
- FR-6: 新增 `/api/staff/path-health`，聚合 ZenithJoy Path1/2/4 的真实 Brain feature 状态与最近 smoke 结果。
- FR-7: Path 健康页展示 Path 列表、maturity、节点状态、最近 smoke 成功/失败与时间。
- FR-8: Brain 或 GitHub 不可达时，Path 健康页明确展示“数据暂不可达”。
- FR-9: CI 增加 Staff Hub 不直连 Anthropic/OpenAI SDK 的机械闸。
- FR-10: 新增 smoke / verify 脚本，保证员工中心至少能做静态验收与构建校验。

## 范围

### 本次包含

- 新建 `apps/staff-hub`
- 飞书员工登录骨架
- Skill 验收页迁移
- Path1/2/4 健康页（Brain feature + GitHub Actions smoke）
- Dashboard 摘除旧员工入口
- Staff Hub 前端与 staff API 的最小测试/校验

### 本次不包含

- 客户管理
- Skill 评审通过/驳回流
- 多级 RBAC
- 审计复核机制
- 真实 journey_steps 私有端点接入（当前 Brain 未公开）

## 用户链路

### Golden Path 1 — Skill 验收迁移

1. 员工打开 Staff Hub，使用飞书登录。
2. 进入“Skill 验收”，选择平台、归属线并上传 skill zip。
3. Staff Hub 调 `/api/staff/skill-eval/upload` 转发到 mmv。
4. 前端轮询 `/status/:jobId`，完成后内嵌展示下游 HTML 报告。
5. mmv 不可达或超时，页面明确报错，不静默卡住。

### Golden Path 2 — Path 健康分析

1. 员工打开“Path 健康”首页。
2. 页面拉取 `/api/staff/path-health`，展示 Path1/2/4 的 maturity 和最近 smoke 状态。
3. 展开某个 Path，看到该 Path 的 Brain feature/ability 节点状态清单。
4. Brain 或 GitHub API 失败时，该 Path 卡片显示“数据暂不可达”。

## NFR

- NFR-1: `apps/staff-hub` 可以独立 `npm run build`。
- NFR-2: Staff Hub 不引入任何 LLM SDK 直连依赖。
- NFR-3: 新增后端聚合接口必须在 GitHub token 缺失时优雅降级，不返回 500 栈追踪。
- NFR-4: 代码保持 ASCII，测试与脚本随仓入库。

## 交付物

- `apps/staff-hub/*`
- `apps/api/src/routes/staff.ts` 增补 path health 聚合
- `apps/api/src/routes/__tests__/staff.test.ts` 增补 path health 合同测试
- `scripts/check-staff-hub-llm-imports.mjs`
- `sprints/07211256-staff-hub-skill-eval-pathhealth/*`

## journey_type: internal_tool
## target_environment: windows_cloud
