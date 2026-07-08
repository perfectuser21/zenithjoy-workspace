# Sprint PRD：CRM 客户状态历史追踪表

## 背景

"装真人"人格项目需要度量 A/B 测试指标之一——"推进速度"（两次状态变化的时间间隔）。
当前 `crm_customers.status` 只保留最新值，无历史记录，无法计算时间间隔。
本 sprint 是该项目 5 块子项目里最先做的数据基础设施，后续 timeline 查询等子项目将接入此历史表。

## 改动范围

1. **新增 migration**：`apps/api/db/migrations/YYYYMMDD_HHMMSS_add_crm_customer_status_history.sql`
   - 创建 `zenithjoy.crm_customer_status_history` 表 + 索引
   - 回填现有客户的当前 status（幂等 INSERT WHERE NOT EXISTS）

2. **改造路由**：`apps/api/src/routes/crm.ts`
   - `PUT /api/crm/customers/status`：原 pool.query 改为事务，SELECT 旧值 → UPSERT → 条件写历史

## Invariant 约束

- **唯一冲突键**：`crm_customers (tenant_id, cs_wechat_id, contact)` 三元组，历史表同样用此三元组定位客户（无 customer_id 外键）
- **VALID_STATUS**：仅允许 `A1 / A2 / A3 / A4 / A5`，路由层已校验，历史表不重复校验
- **历史表只追加**：只 INSERT，永不 UPDATE / DELETE
- **事务原子性**：UPSERT crm_customers 与 INSERT crm_customer_status_history 必须在同一数据库事务内；任一失败则全部回滚，历史表不残留脏数据

## 累积 FR（功能要求）

| ID | 验收标准 |
|----|---------|
| FR-01 | migration 回填幂等：同一 migration 重跑，历史表不产生重复行，有 test 覆盖 |
| FR-02 | 新客户首次写 status → 历史表出现一条 `old_status = NULL`、`new_status = <st>` 记录 |
| FR-03 | 已有客户 status 发生变化 → 历史表新增对应记录，`old_status` 为变化前的值 |
| FR-04 | 重复提交相同 status（status 未变化）→ 历史表不新增记录 |
| FR-05 | upsert 失败时历史表不残留记录（事务回滚） |
| FR-06 | CI 全绿（ESLint + TypeScript + 单元/集成测试 + smoke） |

## 技术设计

### Migration 文件

```sql
-- 建表
CREATE TABLE IF NOT EXISTS zenithjoy.crm_customer_status_history (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID        NOT NULL,
  cs_wechat_id TEXT       NOT NULL,
  contact     TEXT        NOT NULL,
  old_status  TEXT,                        -- NULL 表示首次写入
  new_status  TEXT        NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csh_tenant_cs_contact
  ON zenithjoy.crm_customer_status_history (tenant_id, cs_wechat_id, contact, changed_at DESC);

-- 回填（幂等：只对尚无历史记录的客户插一条初始行）
INSERT INTO zenithjoy.crm_customer_status_history
  (tenant_id, cs_wechat_id, contact, old_status, new_status, changed_at)
SELECT c.tenant_id, c.cs_wechat_id, c.contact, NULL, c.status, c.updated_at
FROM   zenithjoy.crm_customers c
WHERE  NOT EXISTS (
  SELECT 1 FROM zenithjoy.crm_customer_status_history h
  WHERE  h.tenant_id    = c.tenant_id
    AND  h.cs_wechat_id = c.cs_wechat_id
    AND  h.contact      = c.contact
);
```

### 路由改造（crm.ts）

```
BEGIN
  SELECT status AS old_status FROM crm_customers WHERE (tenant_id, cs_wechat_id, contact) = ($1,$2,$3) FOR UPDATE
  UPSERT crm_customers SET status=$4, updated_at=now()
  IF old_status IS DISTINCT FROM $4:
    INSERT INTO crm_customer_status_history (tenant_id, cs_wechat_id, contact, old_status, new_status, changed_at)
    VALUES ($1, $2, $3, old_status, $4, now())
COMMIT
```

`IS DISTINCT FROM` 处理 NULL（新客户）和值变化两种情况，相同值不插入（满足 FR-04）。

### 测试文件

新增 `apps/api/tests/routes/crm-status-history.test.ts`，覆盖 FR-01 ~ FR-05 五条验收标准。

## NFR

- **事务隔离**：`READ COMMITTED`（PostgreSQL 默认），`SELECT FOR UPDATE` 防止并发 status 乱序
- **性能**：历史表写入为追加，单行 INSERT，P99 < 5ms，不影响主写路径
- **索引**：按 `(tenant_id, cs_wechat_id, contact, changed_at DESC)` 索引，支持后续 timeline 查询

## E2E 验收

smoke 脚本：`.github/workflows/scripts/smoke/crm-status-history-smoke.sh`

覆盖场景：
1. 调 PUT /api/crm/customers/status 写新客户 → psql 查历史表确认 `old_status IS NULL`
2. 再调一次改 status → psql 确认历史表多一条，`old_status` 正确
3. 再调一次同 status → psql 确认历史表行数不变
4. 故意触发 DB 错误（断事务）→ 确认历史表无残留

---

journey_type: line04_crm
target_environment: local_api
