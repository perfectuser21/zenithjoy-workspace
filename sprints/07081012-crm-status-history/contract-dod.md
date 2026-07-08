# Contract DoD — CRM 客户状态历史追踪表

sprint: 07081012-crm-status-history
journey: Line04（客户私域 AI 接管）
branch: cp-07081127-ws-5d090237
date: 2026-07-08

---

## [BEHAVIOR] 断言

[BEHAVIOR] FR-01: migration 幂等回填 → 同一 migration 重跑两次后，`zenithjoy.crm_customer_status_history` 中每个 `(tenant_id, cs_wechat_id, contact)` 三元组的记录数不增加，总行数不变

[BEHAVIOR] FR-02: 新客户首次写 status → `PUT /api/crm/customers/status` 成功返回 HTTP 200，历史表出现一条 `old_status IS NULL`、`new_status = <请求值>` 的记录，且三元组与请求匹配

[BEHAVIOR] FR-03: 已有客户 status 变化 → `PUT /api/crm/customers/status` 成功返回 HTTP 200，历史表行数 +1，新行 `old_status = 变更前值`、`new_status = 请求中新值`

[BEHAVIOR] FR-04: 相同 status 重复提交 → `PUT /api/crm/customers/status` 成功返回 HTTP 200，历史表该三元组行数不变（路由通过 `IS DISTINCT FROM` 判断，NULL 安全）

[BEHAVIOR] FR-05: upsert 失败事务回滚 → 主表 upsert 失败时整个事务回滚，历史表行数与失败前完全一致，无脏数据残留，API 返回 HTTP 5xx

[BEHAVIOR] FR-07: 响应格式向前兼容 → 路由从 pool.query 改为事务后，`PUT /api/crm/customers/status` 成功响应 body 结构与改造前一致（`{ success: true, data: {...}, message: "..." }`），现有调用方无需修改

---

## [ARTIFACT] 产物清单

[ARTIFACT] migration: `apps/api/db/migrations/YYYYMMDD_HHMMSS_add_crm_customer_status_history.sql`
- `CREATE TABLE IF NOT EXISTS zenithjoy.crm_customer_status_history (...)`
- `CREATE INDEX IF NOT EXISTS idx_csh_tenant_cs_contact ON ...`
- 回填 INSERT 带 `WHERE NOT EXISTS` 幂等守卫

[ARTIFACT] route: `apps/api/src/routes/crm.ts`
- `PUT /api/crm/customers/status` 改为事务：`BEGIN → SELECT FOR UPDATE → UPSERT → 条件 INSERT 历史 → COMMIT`
- 使用 `IS DISTINCT FROM` 判断状态是否变化（NULL 安全）
- 错误时 `ROLLBACK`，保持原有响应格式

[ARTIFACT] test: `apps/api/tests/routes/crm-status-history.test.ts`
- 覆盖 FR-01 ~ FR-05 + FR-07 共 6 条集成测试
- 覆盖 `statusDidChange` 单元测试（NULL/相同/不同三种场景）

[ARTIFACT] smoke: `.github/workflows/scripts/smoke/crm-status-history-smoke.sh`
- 4 个场景验证（FR-02/03/04/05）
- 使用真实 curl + psql 断言，非占位符

[ARTIFACT] baseline: `.github/workflows/scripts/smoke/smoke-baseline.txt`
- 新增条目 `crm-status-history-smoke.sh`（棘轮，防回归）

---

## [DoD 检查项]

### Migration

- [ ] `CREATE TABLE IF NOT EXISTS` 建表，幂等可重跑
- [ ] `CREATE INDEX IF NOT EXISTS` 建索引
- [ ] 回填 INSERT 使用 `WHERE NOT EXISTS` 幂等守卫
- [ ] migration 重跑两次后历史表行数不变（FR-01 验证通过）

### 路由改造

- [ ] `PUT /api/crm/customers/status` 使用数据库事务（BEGIN / COMMIT / ROLLBACK）
- [ ] 事务内顺序：SELECT FOR UPDATE → UPSERT → 条件 INSERT 历史
- [ ] 使用 `IS DISTINCT FROM` 判断 status 是否变化（覆盖 NULL 新客户场景）
- [ ] status 无变化时不写历史表（FR-04）
- [ ] upsert 失败时事务回滚，历史表无残留（FR-05）
- [ ] 响应格式与改造前一致，向前兼容（FR-07）

### 测试

- [ ] `crm-status-history.test.ts` 中 FR-01 ~ FR-05 + FR-07 全部通过
- [ ] `statusDidChange` 单元测试通过（NULL/相同/不同）
- [ ] 测试文件已 commit 进 repo（regression 永久留存，不删除）

### Smoke & CI

- [ ] `crm-status-history-smoke.sh` 本地跑通（exit 0）
- [ ] smoke 脚本加入 `smoke-baseline.txt` 棘轮
- [ ] `golden-path-1-smoke.sh` 原有通过步骤未被破坏
- [ ] ESLint 0 error
- [ ] TypeScript 编译 0 error
- [ ] CI 全绿（FR-06）

### 兼容性 & 数据一致性

- [ ] 不破坏现有 `PUT /api/crm/customers/status` 响应格式
- [ ] 历史表只追加，无 UPDATE / DELETE 路径
- [ ] `(tenant_id, cs_wechat_id, contact)` 三元组定位唯一客户，无 customer_id 外键依赖

---

## manual:bash 验收命令

```bash
# 1. 确认历史表存在
manual:bash: psql $DATABASE_URL -c "\d zenithjoy.crm_customer_status_history"

# 2. 确认历史表行数（回填后应 > 0）
manual:bash: psql $DATABASE_URL -c "SELECT count(*) FROM zenithjoy.crm_customer_status_history"

# 3. 确认新客户首写历史记录（FR-02）
manual:bash: psql $DATABASE_URL -c "SELECT old_status, new_status FROM zenithjoy.crm_customer_status_history WHERE contact='<test_contact>' ORDER BY changed_at ASC LIMIT 1"

# 4. 确认状态变化历史记录（FR-03）
manual:bash: psql $DATABASE_URL -c "SELECT old_status, new_status, changed_at FROM zenithjoy.crm_customer_status_history WHERE contact='<test_contact>' ORDER BY changed_at DESC"

# 5. 确认 migration 幂等（FR-01）：重跑后行数不变
manual:bash: COUNT_BEFORE=$(psql $DATABASE_URL -t -c "SELECT count(*) FROM zenithjoy.crm_customer_status_history"); psql $DATABASE_URL -f apps/api/db/migrations/*_add_crm_customer_status_history.sql; COUNT_AFTER=$(psql $DATABASE_URL -t -c "SELECT count(*) FROM zenithjoy.crm_customer_status_history"); [ "$COUNT_BEFORE" = "$COUNT_AFTER" ] && echo "IDEMPOTENT OK" || echo "FAIL: count changed"

# 6. 跑 smoke 脚本
manual:bash: bash .github/workflows/scripts/smoke/crm-status-history-smoke.sh
```
