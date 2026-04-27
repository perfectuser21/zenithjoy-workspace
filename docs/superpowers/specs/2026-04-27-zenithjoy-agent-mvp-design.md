# ZenithJoy 中台↔Agent 最小闭环 v0.1 — 设计文档

**Brain Task**: 424521fd-4a5f-417a-9671-bb1762243a35
**Branch**: cp-0427155817-zenithjoy-agent-mvp
**Date**: 2026-04-27

---

## 目标

构建最小可用闭环：dashboard 点按钮 → 中台 WebSocket 推指令 → Agent 收到 → spawn `publish-wechat-article.cjs` → 创建公众号草稿 → 上报结果到 dashboard。

第一版**不打包 .exe**，Agent 用 `node` 直接跑，验证整个链路通了再做 v0.2 打包。

---

## 范围

### IN
1. **agent.js**（Node.js 后台进程）
   - WebSocket 连接到中台（wss://）
   - 接收 `publish_request` 指令
   - spawn `services/creator/scripts/publishers/wechat-publisher/publish-wechat-article.cjs`
   - 上报 stdout/stderr/exit code 到中台
2. **apps/api 加 WebSocket server**
   - 维护 Agent 连接池（单例 AgentRegistry）
   - 共享 5200 端口（http.createServer + attachAgentWS）
   - `POST /api/agent/test-publish`、`GET /api/agent/status`
3. **apps/dashboard 加 UI**
   - `/agent-debug` 独立页面（super-admin 可见，不进侧栏）
   - Agent 在线状态徽章 + 实时消息流
   - "测试发布到公众号"按钮
   - 入口在 AdminSettingsPage 加链接

### OUT（v0.2+）
- pkg 打包成 .exe
- License + 设备指纹
- 多 Agent 编排 / 多客户隔离
- 其他 7 个 publisher（先验证微信公众号）
- 数据持久化（任务历史 in-memory v0.1）
- 真发文章（v0.1 只到草稿，不调 freepublish/submit）

---

## 5 个关键决策

### 决策 1：WebSocket 库 → `ws`（最轻）
- `apps/api` 和 `apps/dashboard` 都没有 WS 依赖，无历史包袱
- `ws` ~30KB 纯 RFC6455，单 Agent + 单 Dashboard 不需要 socket.io 的 room/fallback
- SSE 不能 Server→Agent 双向，砍掉
- 前端用浏览器原生 `WebSocket`，不装客户端库

### 决策 2：Agent ↔ 中台协议 → JSON over WS
统一信封：`{v, type, msgId, taskId?, ts, payload}`，zod 校验。

**Agent → Server**:
- `hello`：`{agentId, version, capabilities: ['wechat']}`
- `heartbeat`：`{uptime, busy}` 每 15 秒
- `task_progress`：`{stage, pct}`
- `task_result`：`{ok, publishId?, mediaId?, error?}`

**Server → Agent**:
- `publish_request`：`{platform, content}`
- `task_cancel`：`{reason}`

### 决策 3：Agent 鉴权 → 共享 Token（v0.1 临时）
- 复用现有 `apps/api/src/middleware/internal-auth.ts` 模式
- 新增 `AGENT_TOKEN` 环境变量
- WS 升级握手时 query string 或 header 校验
- 1Password CS Vault 存 Token → 双写 `~/.credentials/agent.env`（chmod 600）
- v1 升级 JWT 时只换中间件不换协议

### 决策 4：Dashboard UI 落点 → `/agent-debug` 独立页
- 不进 `autopilotNavGroups`（不污染主菜单）
- 注册到 `additionalRoutes`，requireSuperAdmin
- 入口在 `AdminSettingsPage.tsx` 加"Agent 调试"链接
- 内容：在线状态徽章 + 心跳延迟 + 最近 10 条消息流 + "测试发布"按钮

### 决策 5：测试发布内容 → 写死文案，只到草稿
- v0.1 不真发，只到草稿，避免污染公众号
- 标题：`[Agent v0.1 自检] {ISO 时间}`
- 正文：HTML 自检文案
- 调 `publish-wechat-article.cjs` **跳过 freepublish/submit**（加 `--draft-only` 参数或 wrapper 截到第 5 步）

---

## 架构图

```
┌────────────────────────┐    HTTPS     ┌───────────────────────────────┐
│  Browser (Dashboard)   │ ───────────> │  Cloudflare → nginx (443)     │
│  /agent-debug          │ <─ WSS ────> │   ↳ /agent-ws (proxy_pass)    │
│  (super-admin only)    │              │   ↳ /api/* (proxy)            │
└────────────────────────┘              └────────────┬──────────────────┘
                                                     │
                                                     ▼
                              ┌──────────────────────────────────────────┐
                              │ Docker: autopilot-dashboard (nginx)      │
                              │ Docker: zenithjoy-api (Express, 5200)    │
                              │   ├─ /api/*   (existing routes)          │
                              │   ├─ /agent-ws (NEW: WebSocketServer)    │
                              │   ├─ in-memory AgentRegistry             │
                              │   └─ POST /api/agent/test-publish (NEW)  │
                              └──────────────────────┬───────────────────┘
                                                     │ WSS (token auth)
                                                     ▼
                              ┌──────────────────────────────────────────┐
                              │ Agent Process (Node.js, 本地或 hk-vps)   │
                              │   ├─ ws client + heartbeat (15s)         │
                              │   ├─ handlers: publish_request           │
                              │   └─ exec publish-wechat-article.cjs     │
                              │              ↓ (微信 API: 仅 draft/add)  │
                              │       微信公众平台（草稿区）              │
                              └──────────────────────────────────────────┘
```

---

## 关键文件清单

### 新建（API 端，5 文件）
- `apps/api/src/services/agent-registry.ts` — 单例，维护在线 Agent 状态 + 消息广播
- `apps/api/src/services/agent-ws.ts` — `WebSocketServer` 挂载 + token 鉴权 + 消息路由
- `apps/api/src/routes/agent.ts` — `POST /api/agent/test-publish`、`GET /api/agent/status`
- `apps/api/src/schemas/agent-protocol.ts` — zod schema
- `apps/api/src/services/__tests__/agent-registry.test.ts`

### 修改（API 端）
- `apps/api/src/index.ts` — `http.createServer(app)` 共享端口给 WSS
- `apps/api/src/app.ts` — mount `agentRouter`
- `apps/api/package.json` — 加 `ws` 依赖

### 新建（Agent 端）
- `services/agent/package.json`
- `services/agent/src/index.ts` — 主循环 + 重连退避
- `services/agent/src/handlers/wechat-publish.ts` — 调 `publish-wechat-article.cjs`

### 新建（Dashboard 端）
- `apps/dashboard/src/pages/AgentDebugPage.tsx`
- `apps/dashboard/src/api/agent.api.ts` — `testPublish()` + `useAgentSocket()` hook

### 修改（Dashboard 端）
- `apps/dashboard/src/config/navigation.config.ts` — `additionalRoutes` 加 `/agent-debug`
- `apps/dashboard/src/pages/AdminSettingsPage.tsx` — 加入口链接
- nginx 配置 — 加 `location /agent-ws`（WSS 代理）

### 配置
- 1Password CS Vault: 新建 `Agent Token` 条目
- `~/.credentials/agent.env`（chmod 600）

---

## 实现顺序（按依赖排）

1. **协议 schema 先行** (`agent-protocol.ts`) — 三方共享，先定下来
2. **AgentRegistry + WS server** — 让 Agent 能连上 + 心跳跑通
3. **Agent stub** — 只发 hello/heartbeat，验证连接和鉴权
4. **publish_request 双向** — Server 推 Agent，Agent 回 task_progress/result
5. **HTTP `POST /api/agent/test-publish`** — 触发入口
6. **Agent 端真调 wechat-publisher（draft-only 模式）**
7. **Dashboard `/agent-debug` 页面** — WS 实时订阅 + 测试按钮
8. **nginx wss 配置 + 部署 hk-vps** — 端到端联调

---

## 关键风险点

| 风险 | 影响 | 对策 |
|---|---|---|
| WSS 跨 nginx 代理 | 升级握手失败 502 | nginx 必须 `proxy_http_version 1.1` + `Upgrade $http_upgrade` + `Connection upgrade`；超时调到 3600s |
| Agent 重连风暴 | Server 端 OOM / 连接泄漏 | 指数退避 1→2→4→8→30s 上限；Server 端同 agentId 后到踢前到 |
| publish-wechat-article.cjs 真发了 | 污染公众号 | Agent handler 不传 `--publish` 参数，加 `--draft-only` 模式或 wrapper 截到第 5 步 |
| 微信 token 缓存竞争 | Agent 容器重启后丢 `/tmp/wechat_token.json` | ENV 路径 `WECHAT_TOKEN_CACHE` 指向持久路径 |
| AGENT_TOKEN 泄漏 | 公网假冒 Agent | 1Password 严格管理；nginx 层加 IP 白名单兜底 |
| WS 同端口共享 (5200) | 现有 `app.listen(PORT)` 无 server 句柄 | 改 `index.ts`：`http.createServer(app)` + `attachAgentWS(server)` + `server.listen(PORT)` |
| dotenv 覆盖 plist | 容器内 AGENT_TOKEN 被 .env 覆盖空 | `dotenv.config({ override: false })` |

---

## 验收标准（v0.1 DoD）

- [ ] Agent 启动后 5 秒内出现在 `/agent-debug` 在线列表
- [ ] 点"测试发布" → 5 秒内看到 task_progress 流 → task_result.ok=true
- [ ] 微信公众号"草稿箱"出现新草稿，标题含 `[Agent v0.1 自检]`
- [ ] Agent 进程 kill -9 → Dashboard 30 秒内显示离线
- [ ] 错 token 连接被拒（4401 关闭码）

---

## 工期

- Day 1（4-6h）：决策 1-3 + Step 1-4（协议、AgentRegistry、Agent stub、双向通信）
- Day 1.5（3-4h）：Step 5-6（HTTP 端点、真调 wechat-publisher）
- Day 2 上半天（3-4h）：Step 7-8（Dashboard UI、nginx、端到端联调）

**总计：1.5-2 天单人**
