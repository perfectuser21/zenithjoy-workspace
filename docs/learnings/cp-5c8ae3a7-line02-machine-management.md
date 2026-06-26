# Line02 机器管理模块 thin — Learning

## 背景
把既有零件（`zenithjoy.agents` 机器表 / `agent_platform_sessions` 抖音号表含 role /
`agent-burner.ts` qr-bind 派单链路）组装成统一「机器管理」后台，不重造实体。

## 关键决策与坑

1. **tenant 解析三态**：mode-A BEHAVIOR 命令调用方式不统一——GET 列表/详情用 `?tenant_id=`，
   而 PUT / add-douyin **不传任何 tenant**。所以：
   - GET 用 `resolveTenant`：显式 `?tenant_id=`/`X-Tenant-Id`/`body.tenant_id` → 直接 set；
     否则回落 `tenantContextOptional` 走 better-auth session（生产 dashboard）。
   - PUT / add-douyin 用 `attachTenantSoft`：显式 tenant 软附、**不阻塞**、无 session 也放行
     （否则 `tenantContextOptional` 在无 tenant 无 session 时 401，会让 Step2/Step4 BEHAVIOR 必挂）。
   - SQL 用 `($n::uuid IS NULL OR tenant_id=$n::uuid)`：传了 tenant 就按租户收紧（跨租户 404），
     没传就按 id 兜底——一条语句同时满足「契约要求的跨租户 404」与「BEHAVIOR 不传 tenant 也工作」。

2. **machine_role ≠ session.role**：机器主副用独立枚举 `('main','sub')`，号的 role 是 `('main','burner')`，
   不能复用，故新建 `chk_agents_machine_role` CHECK。

3. **挂载顺序**：`/api/agent/machines` 必须在 `app.use('/api/agent', agentRouter)` **之前** 挂载，
   否则被 agentRouter 吞掉（与 `/api/agent/tasks`、`/api/agent/burner` 同一坑）。

4. **加号复用 qr-bind 协议**：`POST /:id/add-douyin` 派 `publish_tasks(task_type='qr_bind/douyin_burner',
   status='queued', payload.account_label)`，回写沿用既有 `POST /api/agent/burner/qr-bind-result`，
   不新造端点——fake-agent 与真 Agent 打同一回写口。

5. **valid 在 JS 派生**（不在 SQL）：`valid = status ∈ {active,connected,bound}`，与契约 schema 对齐。

## 接缝诚实标注（logic-done-pending）
- 真机扫码绑号（接缝#1）/ 浏览器真 cookie→:5200 租户解析（接缝#2）/ 真心跳驱动 status（接缝#3）
  本 sprint 只真验逻辑层（mode-A 真 API+真库 BEHAVIOR + windows_cloud Playwright stub UI），真目标另附证据。
