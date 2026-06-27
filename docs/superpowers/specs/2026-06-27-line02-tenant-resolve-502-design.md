# Line02 staging 主链 502 — tenant 从 session 解析（设计）

> Bug fix。Journey: Line02 客户智能获客 (afa6abca)。Decision: ee621d88。

## 问题
staging dashboard 绑小号/抓评论 → 502 "unexpected token";采集起不来。

## 根因（staging 实证）
- 前端 `DouyinBurnerBindPage.tsx:51` 发占位 `?tenant_id=current`。
- 后端 `agent-burner.ts:148 /sessions` **无 tenantContext 中间件**,直读 `req.query.tenant_id="current"` → `WHERE a.tenant_id='current'`(UUID 列)→ Postgres `invalid input syntax for type uuid` → awaited pool.query reject → 无 try/catch → 进程级 unhandledRejection → 网关 502。
- `/crawl-tasks/latest`(:306)同样直读 query.tenant_id。
- `acquisition collect/start` 返 400 TENANT_ID_REQUIRED(前端没把 tenant 传对)。

## 正确样板（codebase 已有，照抄）
`acquisition-dispatch.ts` / `agent-machines.ts` / `agent-events.ts`：`tenantContextOptional` 中间件 + `tenantOf(req,res)`(读 `req.tenantId`,无则 401 JSON)。`tenantContextOptional` 只读 X-Tenant-Id 头/body.tenant_id,**不读 query** → 挂上后前端的 `?tenant_id=current` query 自动被无视,tenant 来自 better-auth session 的真 UUID。

## 修法（单元）
### 单元 1：agent-burner.ts
- 加 `import { tenantContextOptional } from '../middleware/tenant-context'`(若未引)。
- 加 `tenantOf(req,res)` helper(同 acquisition-dispatch.ts:36-43,读 req.tenantId,无则 401 ERR('NO_TENANT'))。
- `/sessions`：挂 `tenantContextOptional` 中间件;删 `req.query.tenant_id`,改 `const tenantId = tenantOf(req,res); if(!tenantId) return;`;handler body 包 try/catch(catch → 500 JSON,绝不让进程崩)。
- `/crawl-tasks/latest`：同样挂中间件 + tenantOf + try/catch。

### 单元 2：acquisition.ts collect/start
- tenant 从 `req.tenantId`(挂 tenantContextOptional)解析,不再强求 body.tenant_id 才放行。

### 单元 3：前端 DouyinBurnerBindPage.tsx
- 去掉 `/api/agent/burner/sessions?tenant_id=current` 及同页其它 `tenant_id=current` 占位 query,改纯 `fetch('/api/agent/burner/sessions')`(靠 cookie session)。
- 全仓扫 `tenant_id=current` 其它占位点一并清。

## 测试策略
- **Unit/integration（apps/api vitest，proven-to-fire）**：
  - `GET /sessions` 带 `X-Tenant-Id: <uuid>` 头 → 200,返该 tenant 的 burner sessions。
  - `GET /sessions?tenant_id=current` 无 session 头 → **不崩、不 502**,返 401 JSON(NO_TENANT)。这条先写会红(现状直读 query → 崩),修后绿 = proven-to-fire。
  - `GET /sessions` 无 tenant 上下文 → 401 JSON(不是 500/进程崩)。
- **前端源码断言**：DouyinBurnerBindPage 不再含 `tenant_id=current`。
- **staging e2e（我自己点，不入 CI）**：部署 staging 后登录 → 绑小号页加载不 502 → 采集能起。

## 不做（另立 sprint）
- 飞书 Base Table 数据拉取 internal error
- agent 换 agent-env id 重注册导致重复机器
- staging 下载 agent bake 生产 API base(401)
