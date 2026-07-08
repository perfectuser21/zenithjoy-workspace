# Contract DoD — CRM 客户状态历史追踪

**Sprint**: 07081012-crm-status-history
**Journey**: Line04（bfeed805-deed-46c3-8624-87f0028101d4）
**环境**: local_api
**版本**: v1

---

## [BEHAVIOR] B1：新客户首次写 status，历史表出现 old_status=NULL 记录

**前置条件**：
- `zenithjoy.crm_customer_status_history` 表已建（migration 已跑）
- `crm_customers` 中不存在 (tenant_id, cs_wechat_id='cs_new', contact='Alice') 这行

**操作**：
```
PUT /api/crm/customers/status
Authorization: Bearer <valid_jwt>
{ "wechat_id": "cs_new", "contact": "Alice", "status": "A1" }
```

**期望**：
1. HTTP 200 `{ "success": true, "status": "A1" }`
2. `zenithjoy.crm_customer_status_history` 有且仅有 1 行满足：
   - `tenant_id` = 该租户 UUID
   - `cs_wechat_id` = 'cs_new'
   - `contact` = 'Alice'
   - `old_status` IS NULL
   - `new_status` = 'A1'
3. `zenithjoy.crm_customers` 中存在该行，`status='A1'`

**铁律覆盖**：租户隔离、端点鉴权、事务原子性

---

## [BEHAVIOR] B2：已有客户 status 变化，历史表新增对应记录

**前置条件**：
- `crm_customers` 中 (tenant_id, cs_wechat_id='cs_exist', contact='Bob') 已存在，`status='A1'`
- 历史表已有 1 行对应记录

**操作**：
```
PUT /api/crm/customers/status
Authorization: Bearer <valid_jwt>
{ "wechat_id": "cs_exist", "contact": "Bob", "status": "A3" }
```

**期望**：
1. HTTP 200 `{ "success": true, "status": "A3" }`
2. 历史表新增 1 行：`old_status='A1'`, `new_status='A3'`，`changed_at` 近似 now()
3. 历史表总行数 = 2（原有 1 行 + 新增 1 行）
4. `crm_customers` 中该行 `status='A3'`

**铁律覆盖**：事务原子性、append-only、租户隔离

---

## [BEHAVIOR] B3：重复提交相同 status，历史表不新增记录

**前置条件**：
- `crm_customers` 中 (tenant_id, 'cs_dup', 'Carol') 存在，`status='A2'`
- 历史表已有 1 行 `old_status='A1', new_status='A2'`

**操作**：
```
PUT /api/crm/customers/status  { "wechat_id": "cs_dup", "contact": "Carol", "status": "A2" }
（与当前 status 相同）
```

**期望**：
1. HTTP 200 `{ "success": true, "status": "A2" }`
2. 历史表行数不变（仍为 1 行）
3. `crm_customers.updated_at` 刷新（upsert 正常执行）

**铁律覆盖**：append-only（不写冗余历史行）

---

## [BEHAVIOR] B4：upsert 失败，事务回滚，历史表不残留记录

**前置条件**：
- 历史表当前行数 = N
- mock `pool.query` 在 history INSERT 语句执行时抛出数据库错误

**操作**：
```
PUT /api/crm/customers/status { "wechat_id": "cs_err", "contact": "Dave", "status": "A1" }
```

**期望**：
1. HTTP 500 `{ "error": ... }`（或路由错误响应）
2. 历史表行数仍 = N（事务已回滚，无残留）
3. `crm_customers` 中无新增行（整个事务原子回滚）

**铁律覆盖**：事务原子性、upsert + 写历史在同一事务

---

## [BEHAVIOR] B5：多租户隔离，租户 A 历史记录不出现在租户 B 查询

**前置条件**：
- 租户 A（tenant_a_id）: 客户 'Eve'，status 变化历史 A1→A2，历史表有 2 行
- 租户 B（tenant_b_id）: 客户 'Eve'（同名不同租户），无历史

**操作**：以租户 B 身份查询历史（直连 DB 或通过未来 read API）

**期望**：
1. 租户 B 的结果集行数 = 0（不泄露租户 A 数据）
2. `SELECT * FROM zenithjoy.crm_customer_status_history WHERE tenant_id = 'tenant_b_id';` → 0 rows

**铁律覆盖**：租户隔离（测试默认多租户，断言互不串）

---

## [BEHAVIOR] B6：migration 幂等，重跑不重复插入回填行

**前置条件**：
- migration 已跑一次，历史表有回填数据（行数 = M）

**操作**：
```bash
psql "$DATABASE_URL" -f apps/api/db/migrations/20260708_120000_create_crm_customer_status_history.sql
```

**期望**：
1. 命令无报错退出（exit 0）
2. 历史表行数仍 = M（ON CONFLICT DO NOTHING 回填不重复插入）
3. 表结构、索引均正常（CREATE TABLE IF NOT EXISTS 不报冲突错误）

**铁律覆盖**：migration 幂等

---

## manual:bash 验收命令

```bash
# manual:bash target=local_api label=smoke-schema
# 验证 schema 存在
psql "$DATABASE_URL" -Atc "
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='zenithjoy' AND table_name='crm_customer_status_history';
"
# 期望输出: crm_customer_status_history

# manual:bash target=local_api label=smoke-idempotent
# 验证 migration 幂等
COUNT_BEFORE=$(psql "$DATABASE_URL" -Atc "SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history;")
psql "$DATABASE_URL" -f apps/api/db/migrations/20260708_120000_create_crm_customer_status_history.sql 2>&1
COUNT_AFTER=$(psql "$DATABASE_URL" -Atc "SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history;")
[ "$COUNT_BEFORE" = "$COUNT_AFTER" ] && echo "PASS: idempotent" || { echo "FAIL: $COUNT_BEFORE -> $COUNT_AFTER"; exit 1; }

# manual:bash target=local_api label=smoke-ci
# 运行 API 测试套件
cd /workspace && pnpm --filter api test --run 2>&1 | grep -E "(PASS|FAIL|ERROR|Tests)" | tail -20
# 期望: 无 FAIL，exit 0
```

---

## 铁律覆盖矩阵

| 铁律 | 覆盖方式 | 对应 [BEHAVIOR] |
|------|---------|----------------|
| 租户隔离（所有操作带 tenant_id） | B1/B2/B3 验证写入带 tenant_id；B5 断言跨租户不泄露 | B1, B2, B3, B5 |
| 事务原子性（upsert + 写历史同一事务） | B4 mock 抛错验证回滚无残留 | B4 |
| migration 幂等（重跑不重复插入） | B6 重跑 migration 后行数不变 | B6 |
| 端点鉴权（JWT requireCsWriteAccess） | B1 中带有效 JWT；另有单独 401 测试（见 test 文件 #auth） | B1 |
| append-only（历史表只 INSERT） | B3 重复 status 不写；代码审查确认无 UPDATE/DELETE | B3 |
| 测试默认多租户 | B5 种 2 个租户断言互不串 | B5 |
