# Learning — 机器管理模块（Line02 智能获客）

Sprint: 06260400-machine-management · 2026-06-26

## 做了什么
把已就位的零件（agents 表 / agent_platform_sessions / qr-bind burner）组装成统一「机器管理」模块：
- migration：`zenithjoy.agents` 加 `nickname`(可空，展示时 COALESCE→hostname) + `machine_role`(CHECK main|sub, 默认 sub)
- `apps/api` 新路由 `agent-machines.ts`（挂 `/api/agent`）三端点，均走 `tenantContextOptional` 按租户 scope：
  - `GET /machines`（列机器 + 每台 douyin 号数）
  - `GET /machines/:id`（机器 + accounts，valid 由 session.status 派生）
  - `PUT /machines/:id`（改名 + 标主副，跨租户 0 行 → 403 CROSS_TENANT）
- `apps/dashboard` 机器管理页 + 导航入口；在机器上加号复用 `agent-burner` qr-bind（不新建）

## 关键事实 / 踩坑
- `agent_platform_sessions.agent_id` = `agents.id`(uuid)，不是 `agents.agent_id`(text)。所以「机器→号」join 一律
  `sessions.agent_id = agents.id`；smoke 里 `MACHINE_ID == AGENT_ID == agents.id`。
- 机器角色字段名定为 `machine_role`（不是 `role`），避免与 `session.role`(main/burner) 混淆——契约把 `role` 列为禁用漂移字段。
- `session.nickname` 不是真列，存 `extra_json->>'nickname'`，回退取 publish_tasks 回执 `account_nickname`。
- 路由按租户 scope：未登录（无 `req.tenantId` 也非 super-admin）→ 401 不查库；跨租户 PUT → UPDATE WHERE tenant_id 命中 0 行 → 403。
- DoD ARTIFACT 静态 grep 读「页面文件本身」要含 `/api/agent/machines` + `credentials:'include'`，故 fetch 直接写在
  `MachineManagementPage.tsx`（未拆独立 api client），避免 grep 落空。
- 新 sprint 测试须登记进 `apps/api/vitest.config.ts` include + `test-registry.yaml`，否则 orphan-test-check 拦。

## 接缝
- cookie 接缝（运营浏览器 better-auth cookie → 真后端 GET/PUT）真验在 `machine-management-smoke.sh --leg=cookie-seam`，
  无 `E2E_SUPER_ADMIN` 凭据时降级 `logic-done-pending`，不用 stub 绿冒充 done。
- windows_cloud Playwright（page.route stub + VITE_SKIP_AUTH）只验 UI，不验 cookie 到达后端。
