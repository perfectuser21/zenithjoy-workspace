# Agent Fleet 设计文档

**日期**: 2026-04-28  
**状态**: 待实现

---

## 一、目标

一个云端中台控制多家客户各自 PC 上的本地 Agent，实现"云端下发任务 → 本地执行 Skill → 回报结果"的完整链路。

---

## 二、现状

已有（不动）：
- `apps/api` — Express + WebSocket 服务，端口 5200
- `services/agent-ws.ts` — WebSocket 管理（在内存中）
- `services/agent-registry.ts` — Agent 注册表（在内存中，重启丢失）
- `routes/agent.ts` — `/api/agent/status`、`/test-publish-*`
- `services/agent/` — 本地 Agent，已有 License 认证、托盘、8 平台 handler

缺失：
- `tenants` 表（多租户）
- `agents` 表持久化（重启不丢）
- `tasks` 表（任务队列）
- License 验证（服务端）
- 每个 tenant 的飞书配置

---

## 三、数据库 Schema

### 3.1 tenants

```sql
CREATE TABLE tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  license_key     text NOT NULL UNIQUE,   -- ZJ-XXXX 格式
  plan            text NOT NULL DEFAULT 'free',   -- free/pro

  -- 飞书配置（每个客户自己的）
  feishu_app_id     text,
  feishu_app_secret text,
  feishu_bitable    text,   -- Bitable APP_TOKEN
  feishu_table_crm  text,   -- 客户库 table ID
  feishu_table_log  text,   -- 互动记录 table ID

  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 3.2 agents

```sql
CREATE TABLE agents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  agent_id     text NOT NULL UNIQUE,   -- Agent 自生成，如 "agent-xuxia-pc-xxx"
  hostname     text,
  platform     text,                   -- win32 / darwin / linux
  capabilities text[] NOT NULL DEFAULT '{}',
  version      text,
  status       text NOT NULL DEFAULT 'offline',   -- online / offline
  last_seen    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON agents(tenant_id, status);
```

### 3.3 tasks

```sql
CREATE TABLE tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  agent_id     uuid REFERENCES agents(id),
  skill        text NOT NULL,          -- 'wechat_send' / 'publish_douyin'
  params       jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'pending',  -- pending/running/done/failed
  result       jsonb,
  error        text,
  scheduled_at timestamptz,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON tasks(tenant_id, status);
CREATE INDEX ON tasks(agent_id, status);
```

---

## 四、WebSocket 协议变更

Agent 连接时带 `?token=ZJ-XXXX`，服务端：
1. 查 `tenants` 表验证 license_key
2. Upsert `agents` 表（online）
3. 后续心跳更新 `agents.last_seen`
4. 断开时更新 `agents.status = offline`

消息类型（已有，不变）：
- `hello` → Agent 上线注册
- `heartbeat` → 保活
- `publish_request` → 下发任务
- `task_progress` → 执行进度
- `task_result` → 执行结果

---

## 五、新增 API 端点

```
POST /api/agent/tasks              创建任务（云端下发）
GET  /api/agent/tasks              查任务列表（按 tenant）
GET  /api/agent/tasks/:id          查单个任务状态
GET  /api/agent/status             查在线 Agent 列表（已有，补 tenant 过滤）

POST /api/tenants                  创建 tenant + 生成 license
GET  /api/tenants/:id/feishu       查 feishu 配置
PUT  /api/tenants/:id/feishu       更新 feishu 配置
```

---

## 六、测试策略

| 范围 | 类型 | 说明 |
|------|------|------|
| License 验证逻辑 | unit | 纯函数，不依赖 WS |
| DB upsert agent | integration | 真实 DB |
| Task 状态流转 | integration | pending→running→done |
| WS 连接→注册→心跳 | E2E | 起真实 server + 模拟 Agent |
| 本地 RPA（发微信） | 手动 dry-run | 无法 CI |

---

## 七、实现顺序

1. Migration：`tenants` / `agents` / `tasks` 三张表
2. License 验证中间件（WS 握手时）
3. Agent 注册持久化（hello → upsert agents）
4. 心跳更新 last_seen + 断开标 offline
5. Task CRUD API
6. 任务下发逻辑（POST task → pickFor → sendToAgent）
7. Feishu 配置 API

