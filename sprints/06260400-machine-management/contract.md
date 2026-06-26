# 机器管理 — 前后端 API 契约（双方严格遵守，不得偏离）

> 字段名/类型/嵌套结构是前后端唯一接缝，任何一方改动必须同步另一方。

## 数据模型新增（agents 表）
migration 加两列（不动现有列、不改 PK）：
- `nickname TEXT`（可空，机器显示名，运营自定义）
- `machine_role TEXT NOT NULL DEFAULT 'main' CHECK (machine_role IN ('main','sub'))`

> 注意：机器角色 `machine_role` 取值 `main`/`sub`，与 `agent_platform_sessions.role`（`main`/`burner`，号的角色）是**两个不同概念**，不要混用。

## 端点 1：GET /api/agent/machines
- 鉴权 + tenant 隔离：复刻 `agent-burner.ts` `/sessions` 端点同样的 tenant 解析方式（按 license/tenant_id 过滤，绝不跨租户）。
- 响应：
```json
{
  "success": true,
  "data": [
    {
      "id": "<agent uuid>",
      "agent_id": "<text agent_id>",
      "hostname": "DESKTOP-XXX",
      "nickname": "主力机",
      "machine_role": "main",
      "status": "online",
      "version": "1.0.70",
      "last_seen": "2026-06-26T06:00:00.000Z",
      "session_count": 2
    }
  ]
}
```
- `session_count` = 该 agent 下 `agent_platform_sessions` 行数（LEFT JOIN COUNT，无号则 0）。
- 列表按 `status` online 优先、再按 hostname 排序。

## 端点 2：GET /api/agent/machines/:id
- `:id` = agent uuid，tenant 隔离（不属于本租户 → 404）。
- 响应：
```json
{
  "success": true,
  "data": {
    "machine": { /* 同上单个对象，含 session_count */ },
    "sessions": [
      {
        "account_label": "perfect-01",
        "role": "main",
        "status": "active",
        "platform": "douyin",
        "account_nickname": "默易",
        "bound_at": "2026-06-20T00:00:00.000Z"
      }
    ]
  }
}
```
- 机器存在但无号 → `sessions: []`。

## 端点 3：PUT /api/agent/machines/:id
- body：`{ "nickname"?: string, "machine_role"?: "main"|"sub" }`（两字段都可选，至少一个）。
- tenant 隔离；非法 machine_role → 400；机器不存在/跨租户 → 404。
- 响应：`{ "success": true, "data": { /* 更新后的机器对象 */ } }`

## 错误响应统一格式
`{ "success": false, "error": { "code": "...", "message": "..." } }`，HTTP 4xx/5xx。

## 前端页面契约
- 新页面 `MachineManagementPage`，路由 `/dashboard/machines`，挂在智能获客板块导航下。
- 列表渲染上面 8 个字段；online 绿点 / offline 红点；`machine_role` 主/副标签；显示 `session_count`「N 个号」。
- 点机器行 → 进详情，调端点 2，渲染该机器的抖音号列表（account_label / role / status / account_nickname）。
- 详情页「重命名」「设为主/副机器」→ 调端点 3 PUT，乐观更新或重拉。
- 详情页「添加抖音号」按钮 → 调已有 qr-bind 触发流程（复用 DouyinBurnerBindPage 的派单逻辑，按当前机器 agent_id 派 qr-bind 任务）。
- e2e 用 `page.route` stub 上面三个端点（参照 module-health.spec.ts），不依赖真后端。
