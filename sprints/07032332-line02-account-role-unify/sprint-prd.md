# Sprint PRD — 角色数据模型统一 & 账号管理页加绑定机器列

## OKR 对齐

- **对应 KR**：Line02 客户智能获客路径 — 机器管理（客户机器 + 机器上抖音号绑定）
- **当前进度**：thin working
- **本次推进预期**：thin → medium

## 背景

三张平行表各自维护"号角色"概念：`agent_platform_sessions.role` 是路由代码实际读写的唯一表；`line02_account_sessions.role` 另有独立 health 探测但与前者不同步；`agents.machine_role` 混入"号角色"语义。管理员无法在一个页面看清"哪个小号绑在哪台机器"，旧版 DouyinBurnerBindPage 与 AcquisitionAccountsPage 功能重叠。

## Golden Path（核心场景）

### 场景 A：管理员查看小号绑定机器

1. 管理员打开账号管理页 `/area/acquisition/accounts`
2. 系统请求 `GET /api/agent/burner/sessions`，响应每条 burner session 含 `agent_hostname` + `agent_nickname`（JOIN agents 表）
3. 表格"绑定机器"列显示 hostname 或昵称；无绑定机器时显示"—"
4. 管理员能一眼看清"3 个小号分别在哪台机器"

### 场景 B：旧页面已下线

1. 管理员访问 `/dashboard/douyin-burner-bind`
2. 系统返回 404（路由已删除，不做跳转）
3. `DouyinBurnerBindPage.tsx` 文件已从代码库物理删除（不是仅摘除菜单）

### 场景 C：数据迁移 cutover（开发侧验收，dry-run 先跑）

1. 迁移脚本 dry-run：对比 `agent_platform_sessions` 与 `line02_account_sessions` 同一 tenant + account_label 记录
2. 角色不一致 → 写迁移日志（tenant_id + account_label + 两表角色值），不阻断
3. 正式 cutover：`line02_account_sessions.health` 按 ok→active / expired→expired / unknown→pending 映射写入 `agent_platform_sessions.status`；`line02_account_sessions` 停写（写入路径切断）

## 边界情况

- 小号 agent 已离线（无心跳）：机器列显示 hostname，标记"离线"
- 两表角色冲突：记录日志，不阻断，以 `agent_platform_sessions` 为准
- `agent_id` 已被 CASCADE 删除：该 session 行不出现在列表（外键约束自然过滤）
- 无绑定机器的小号：`agent_hostname` 返回 null，前端显示"—"

## 范围限定

**在范围内**：
- `GET /api/agent/burner/sessions` 响应新增 `agent_hostname` / `agent_nickname` 字段（JOIN agents）
- `AcquisitionAccountsPage` 表格加"绑定机器"列
- 删除 `DouyinBurnerBindPage.tsx`、navigation.config.ts 路由 + lazy import + 对应测试文件
- DB migration：`line02_account_sessions` 停写，现有 health 数据迁入 `agent_platform_sessions.status`
- 迁移脚本支持 `--dry-run` 模式，输出冲突日志

**不在范围内**：
- `agents.machine_role` 字段删除或改名（保留字段，仅语义解耦——机器角色 ≠ 号角色）
- 调度算法（Sprint 2）
- Lead 人工分配（Sprint 3）
- 前端新增机器绑定操作入口（本次仅展示）

## 假设

- [ASSUMPTION: `agent_platform_sessions.agent_id` FK → `agents` 可 JOIN 获取 `hostname` + `nickname`]
- [ASSUMPTION: `line02_account_sessions.health` 三值映射：ok→active, expired→expired, unknown→pending]
- [ASSUMPTION: `DouyinBurnerBindPage` 绑定功能已由 `AcquisitionAccountsPage` 完整替代]
- [ASSUMPTION: 旧路由改为 404，不做重定向；E2E 按 HTTP 404 断言]

## 预期受影响文件

- `apps/api/src/routes/agent-burner.ts`：GET /sessions 响应加 `agent_hostname` / `agent_nickname`（JOIN agents）
- `apps/api/db/migrations/<timestamp>_account_role_unify.sql`：health 迁移 + line02_account_sessions 停写标记
- `apps/dashboard/src/pages/DouyinBurnerBindPage.tsx`：**删除**
- `apps/dashboard/src/config/navigation.config.ts`：删除路由 + lazy import
- `apps/dashboard/src/pages/AcquisitionAccountsPage.tsx`：`BurnerSession` 接口加 `agent_hostname` / `agent_nickname`，表格加列
- `apps/dashboard/tests/p2-sprint-b1-ws5/douyin-burner-bind-page.test.tsx`：**删除**

## NFR 约束

<!-- 来源: PrepPRD 显式值优先；decisions 表返回空，以 PrepPRD 为准 -->
- 迁移策略: cutover（PrepPRD 明确）— 本 PR 内一次性下线，不做过渡期双写
- 冲突处理: 两表角色不一致 → 记录日志（不阻断），以 agent_platform_sessions 为准
- 凭据: 复用现有 DB 连接和 tenant 体系，无需新增
- 可观测: 迁移脚本输出每条冲突记录（tenant_id + account_label + 两表角色值）
- 超时/延迟: 待定（PrepPRD 未指定）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- Brain API 返回空；以下从 PrepPRD 提取硬约束 -->
- [租户隔离] 所有查询必须带 tenant_id 过滤，禁止跨租户返回数据
- [权威源] agent_platform_sessions 是号角色唯一权威源，读写不得走 line02_account_sessions
- [数据完整] 迁移不丢绑定关系，dry-run 必须先跑并输出报告，发现冲突不阻断

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- Brain API 返回空；以下为已知历史 sprint 行为摘要 -->
- Step 1/2: 注册/装 Agent — 用户注册后自动 license，Agent 扫码连中台
- Step 3: 绑飞书企业 + 自动建 Bitable 3 张表（获客画像/对标视频/Lead）
- Step 5: 绑抖音小号 — agent_platform_sessions.role='burner' 写入，qr-bind API 完整链路（不得回退）

## E2E 验收

> 最终可执行脚本由 proposer 在 GAN 阶段按 `target_environment=windows_cloud` 产出（Playwright ps1 模板）。

```bash
# 占位：proposer 将填入 windows_cloud Playwright 脚本
# 期望验收点（自然语言）：
# 1. GET /api/agent/burner/sessions 每条响应含 agent_hostname（可为 null，字段必须存在）
# 2. /area/acquisition/accounts 页面表格渲染"绑定机器"列
# 3. GET /dashboard/douyin-burner-bind 返回 HTTP 404
# 4. 迁移脚本 --dry-run 输出报告、退出码 0、不报错
# 5. CI 全绿（TypeScript + ESLint + unit tests）
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ AcquisitionAccountsPage 前端页面改造
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard UI，按 E2E 路由规则走 GitHub Actions windows-latest runner（干净 sandbox）
## journey_id: line02
## step_id: L02-S5（机器管理·绑抖音小号）
