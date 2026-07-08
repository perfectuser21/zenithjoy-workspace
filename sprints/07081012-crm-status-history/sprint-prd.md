# Sprint PRD — CRM Status History 历史追踪表

**Task**: 5d090237-6046-410a-97a6-2bb0c91db411
**Sprint**: 07081012-crm-status-history
**Date**: 2026-07-08

---

## Invariant 约束

1. `crm_customers` 唯一键 `(tenant_id, cs_wechat_id, contact)` 不可破坏；upsert 语义不变
2. `status` 值域固定为 `A1|A2|A3|A4|A5`（CHECK 约束），不得放宽
3. `PUT /api/crm/customers/status` 是 `crm_customers.status` 的**唯一写入点**，不得绕过
4. 租户隔离：所有读写必须携带 `tenant_id` 过滤，不得跨租户
5. 历史表不承载业务主路径；**upsert 失败时历史表不得残留记录**（事务原子性）
6. migration 文件必须幂等（`CREATE TABLE IF NOT EXISTS` + `INSERT … ON CONFLICT DO NOTHING`）

---

## 累积 FR

### FR-1 新建 `crm_customer_status_history` 表（migration）
- 字段：`id BIGSERIAL PK`、`tenant_id uuid`、`cs_wechat_id text`、`contact text`、`old_status text NULL`（新客户首次为 NULL）、`new_status text NOT NULL`、`changed_at timestamptz DEFAULT now()`
- 索引：`(tenant_id, cs_wechat_id, contact, changed_at DESC)` 供时序查询
- 回填：对 `crm_customers` 当前所有行插一条 `old_status=NULL`、`new_status=status` 历史记录（幂等：`ON CONFLICT DO NOTHING`，需加唯一约束或用 `NOT EXISTS` 子查询）

### FR-2 `PUT /api/crm/customers/status` 包事务 + 写历史
- 用 `pool.connect()` 获取客户端，`BEGIN … COMMIT / ROLLBACK`
- upsert 前先 `SELECT status FROM crm_customers WHERE …` 取 `old_status`（可能为 NULL = 新客户）
- upsert 后，当且仅当 `old_status IS DISTINCT FROM new_status` 时写一行历史记录
- 任何步骤抛异常 → `ROLLBACK`，历史表不残留

---

## NFR

| 维度 | 要求 |
|------|------|
| 幂等 | migration 重跑不重复插入历史行；回填用 `NOT EXISTS` 或唯一约束 |
| 事务 | upsert + 历史写入原子，upsert 失败必须回滚历史 |
| 性能 | `SELECT old_status` + upsert + `INSERT history` = 3 次 RTT，P99 < 200ms（单条写） |
| 测试 | vitest + supertest + `vi.mock(pool)`，mock `client.query` 验证事务顺序 |

---

## Golden Path（核心场景）

1. **新客户首次写 status** → upsert 插入新行（old=NULL）→ 历史表写 `old_status=NULL, new_status='A2'` → 返回 `{success:true, status:'A2'}`
2. **已有客户 status 变化** → 取 `old_status='A2'` → upsert 改为 `A3` → 历史表写 `old='A2', new='A3'`
3. **重复提交相同 status** → 取 `old_status='A3'` == new → upsert 执行（updated_at 刷新）→ **历史表不新增**
4. **upsert 失败（DB 异常）** → ROLLBACK → 历史表行数不变，接口返回 500
5. **migration 重跑** → `IF NOT EXISTS` + `ON CONFLICT DO NOTHING` → 无重复行，无报错

---

## Response Schema

### 新 Migration DDL（结构）

```sql
CREATE TABLE IF NOT EXISTS zenithjoy.crm_customer_status_history (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  cs_wechat_id text NOT NULL,
  contact      text NOT NULL,
  old_status   text CHECK (old_status IN ('A1','A2','A3','A4','A5')),  -- NULL = 新客户首次
  new_status   text NOT NULL CHECK (new_status IN ('A1','A2','A3','A4','A5')),
  changed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_status_history_lookup
  ON zenithjoy.crm_customer_status_history (tenant_id, cs_wechat_id, contact, changed_at DESC);
```

### 路由行为变化

| 场景 | 旧行为 | 新行为 |
|------|--------|--------|
| 任意 status 写入 | 单条 upsert | BEGIN → SELECT old → upsert → INSERT history（条件）→ COMMIT |
| upsert 失败 | 500，无副作用 | ROLLBACK，历史表无残留，同样 500 |
| 相同 status 重复提交 | upsert（updated_at 刷新） | 同上，但历史表不写 |
| 接口响应 | `{success, status}` | 不变 |

---

journey_type: backend_infra
target_environment: windows_cloud
