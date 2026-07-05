# Bug PrepPRD：关键词任务跨租户被抢占（缺 tenant_id 隔离）

## 症状
派发关键词任务后，staging 上另一个租户的机器（DESKTOP-LBV5PAE，tenant_id=455a8ca9）
抢走了本租户（2ac0aa4a，ROG）的任务，处理失败后不回报，任务永久卡在 processing。

## 根因
1. `acquisition_keyword_tasks` 表无 `tenant_id` 字段，任务无归属
2. `POST /api/acquisition/keyword-search` 插入任务时不写 tenant_id
3. `GET /api/acquisition/pending-keyword-tasks` 无鉴权、无 tenant 过滤，
   任何 agent 都能拿走全部 tenant 的任务

## 关联上下文
- Journey：客户智能获客路径（afa6abca）
- 已有中间件：`tenantContextOptional`（从 session 取 tenant_id）
- agent 已有：`cfg.licenseKey`（注册时返回的 license_key）、`cfg.wsToken`

## 修法（三处，一个 PR）

### 1. DB migration
```sql
ALTER TABLE zenithjoy.acquisition_keyword_tasks
  ADD COLUMN tenant_id UUID REFERENCES zenithjoy.tenants(id);
-- 旧数据 tenant_id 为 NULL，不强制 NOT NULL（避免迁移断服）
-- 新插入必须有 tenant_id（应用层保证）
CREATE INDEX ON zenithjoy.acquisition_keyword_tasks(tenant_id, status);
```

### 2. API：派发时写 tenant_id
`apps/api/src/routes/acquisition.ts` → `POST /keyword-search`：
- 加 `tenantContextOptional` 中间件
- 插入任务时带 `tenant_id`（从 req 的 tenant context 取，空则拒绝）

### 3. API：轮询时按 tenant 过滤
`GET /pending-keyword-tasks`：
- 从 `Authorization: Bearer <license_key>` 或 `x-agent-license` header 取 license
- 通过 license 查 tenant_id（`licenses` 表已有 tenant_id）
- SQL 加 `WHERE tenant_id = $1 AND status = 'dispatched'`

### 4. Agent：轮询带 license header
`services/agent/src/index.ts` → `pollAndProcess()`：
- fetch 加 `headers: { 'x-agent-license': cfg.licenseKey }`

## Regression Test 计划
`apps/api/src/routes/acquisition.test.ts` 新增：
- 两个不同 tenant 各自有 pending 任务
- tenant A 的 agent（带 A 的 license）只能拿到 A 的任务，拿不到 B 的

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] staging 验证：ROG 派发任务，只有 ROG 的 agent 拿到，DESKTOP-LBV5PAE 拿不到
- [ ] CI 全绿
