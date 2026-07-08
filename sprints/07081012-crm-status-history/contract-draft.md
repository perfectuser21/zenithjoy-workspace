# Contract Draft — CRM 客户状态历史追踪（crm_customer_status_history）

**Sprint**: 07081012-crm-status-history
**Journey**: Line04 客户私域 AI 接管（bfeed805-deed-46c3-8624-87f0028101d4）
**环境**: local_api（jest 集成测试 + psql schema 验证）
**起草版本**: v1（首轮，无 reviewer feedback）

---

## 背景与范围

本 sprint 给 `crm_customers.status` 建历史追踪表，支撑 A/B 测试"客户状态推进速度"指标。
唯一写入点 `PUT /api/crm/customers/status` 用事务改造：取旧值 → upsert → 按条件写历史行。

**不在范围**：历史读路径（timeline API）、`POST /api/crm/customers` 首次入册历史、A/B 报表。

---

## 产物定义

| 产物 | 路径 | 说明 |
|------|------|------|
| DB migration | `apps/api/db/migrations/20260708_120000_create_crm_customer_status_history.sql` | 表定义 + 索引 + 幂等回填 |
| 路由改造 | `apps/api/src/routes/crm.ts`（L470-500） | `PUT /api/crm/customers/status` 事务包裹 |
| 合同测试 | `apps/api/tests/routes/crm-status-history.test.ts` | jest/vitest 集成测试 |

---

## E2E 验收

### 1. Schema 存在验证（migration 幂等）

```bash
# manual:bash target=local_api
psql "$DATABASE_URL" -c "
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema='zenithjoy' AND table_name='crm_customer_status_history';
"
# 期望: count = 1
```

重跑 migration 不报错，历史行数不重复增长：

```bash
# manual:bash target=local_api
COUNT_BEFORE=$(psql "$DATABASE_URL" -Atc "SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history;")
psql "$DATABASE_URL" -f apps/api/db/migrations/20260708_120000_create_crm_customer_status_history.sql
COUNT_AFTER=$(psql "$DATABASE_URL" -Atc "SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history;")
[ "$COUNT_BEFORE" = "$COUNT_AFTER" ] && echo "PASS: 幂等回填不重复插入" || echo "FAIL: 行数变化 $COUNT_BEFORE -> $COUNT_AFTER"
```

### 2. 新客户首次写 status → old_status=NULL

```bash
# jest 集成测试覆盖（见 contract-tests/crm-status-history.test.ts #B1）
# PUT /api/crm/customers/status { wechat_id: "test_cs_new", contact: "NewUser", status: "A1" }
# psql: SELECT old_status, new_status FROM zenithjoy.crm_customer_status_history WHERE contact='NewUser';
# 期望: old_status IS NULL, new_status='A1'
```

### 3. 已有客户 status 变化 → 新增历史行

```bash
# jest 集成测试覆盖（见 contract-tests/crm-status-history.test.ts #B2）
# 先写 A1，再 PUT status=A2
# psql: 最新一行 old_status='A1', new_status='A2'
```

### 4. 重复提交相同 status → 历史表不新增

```bash
# jest 集成测试覆盖（见 contract-tests/crm-status-history.test.ts #B3）
# 两次 PUT status='A2'，历史行数 = 1（不是 2）
```

### 5. 事务回滚不残留历史记录

```bash
# jest 集成测试覆盖（见 contract-tests/crm-status-history.test.ts #B4）
# mock pool.query 在 history INSERT 前抛错
# 期望: 历史行数不变（upsert 和 history INSERT 同一事务回滚）
```

### 6. 多租户隔离

```bash
# jest 集成测试覆盖（见 contract-tests/crm-status-history.test.ts #B5）
# 租户 A 写入历史 → 租户 B 查询不到该行
```

### 7. CI 全绿

```bash
# manual:bash target=local_api
cd /workspace && pnpm --filter api test --run 2>&1 | tail -20
# 期望: 无 FAIL，exit 0
```

---

## DoD 核查清单

- [ ] migration 文件存在且 idempotent（ON CONFLICT DO NOTHING 回填）
- [ ] `PUT /api/crm/customers/status` 用 `pool.connect()` 事务（BEGIN / COMMIT / ROLLBACK）
- [ ] 事务内：取旧 status → upsert crm_customers → 条件写历史行（新客户 OR status 变化）
- [ ] 历史表无 UPDATE/DELETE（append-only）
- [ ] 所有 DB 操作带 `tenant_id` 过滤（租户隔离）
- [ ] JWT 鉴权中间件 `requireCsWriteAccess` 保持原位不被移除
- [ ] 测试种 ≥2 个租户，断言互不串
- [ ] CI `pnpm --filter api test` 全绿

---

## 假设与约束

- [ASSUMPTION] `PUT /api/crm/customers/status` 是 `crm_customers.status` 的唯一写入点；`POST /api/crm/customers` 首次入册不追踪历史（PRD 明确）
- [ASSUMPTION] 回填使用 `old_status=NULL`、`changed_at=created_at`，幂等靠 (tenant_id, cs_wechat_id, contact, new_status, changed_at) UNIQUE 约束的 ON CONFLICT DO NOTHING
- [CONSTRAINT] 历史表只 INSERT，禁止 UPDATE/DELETE
- [CONSTRAINT] 所有查询必须 scope 到 tenant_id
