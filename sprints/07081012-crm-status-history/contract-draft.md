# Contract Draft — CRM 客户状态历史追踪表

sprint: 07081012-crm-status-history
journey: Line04（客户私域 AI 接管）
branch: cp-07081127-ws-5d090237
date: 2026-07-08

---

## 功能合同

以下 [BEHAVIOR] 断言描述系统在各场景下**必须**表现出的可验证行为。所有断言与 FR 编号一一对应。

### [BEHAVIOR] FR-01：Migration 回填幂等

**描述**：`crm_customer_status_history` migration 重复执行后，历史表中不产生重复行。

**断言**：
- migration SQL 使用 `CREATE TABLE IF NOT EXISTS` 建表，重跑不报错
- 回填 INSERT 使用 `WHERE NOT EXISTS (SELECT 1 FROM crm_customer_status_history WHERE ...)` 幂等守卫
- 对同一组 `(tenant_id, cs_wechat_id, contact)`，回填后历史表中该三元组的记录数 = 1
- 执行两次 migration 后，`SELECT count(*) FROM zenithjoy.crm_customer_status_history` 结果不变

### [BEHAVIOR] FR-02：新客户首次写 status → 历史表出现 old_status=NULL 记录

**描述**：调用 `PUT /api/crm/customers/status` 写入一个数据库中不存在的新客户时，历史表必须插入初始行。

**断言**：
- 请求成功返回 HTTP 200，响应格式与改造前一致（向前兼容）
- `zenithjoy.crm_customer_status_history` 中出现一行，其中：
  - `old_status IS NULL`
  - `new_status = <请求中的 status 值>`
  - `(tenant_id, cs_wechat_id, contact)` 三元组与请求匹配

### [BEHAVIOR] FR-03：已有客户 status 变化 → 历史表新增正确记录

**描述**：对已存在的客户发起状态变更请求（新 status ≠ 旧 status），历史表必须追加一条完整变更记录。

**断言**：
- 请求成功返回 HTTP 200
- 历史表新增一行（行数 +1）
- 新行的 `old_status = 变更前的 status 值`
- 新行的 `new_status = 请求中的新 status 值`
- `changed_at` 为当前时间（允许 ±5s 误差）

### [BEHAVIOR] FR-04：相同 status 重复提交 → 历史表行数不变

**描述**：对已存在的客户提交与当前 status 相同的值，历史表不追加记录。

**断言**：
- 请求成功返回 HTTP 200（主表 upsert 照常执行，响应不变）
- 历史表中该三元组的记录数与请求前相同（不新增）
- 路由层通过 `old_status IS DISTINCT FROM new_status` 判断，NULL 安全

### [BEHAVIOR] FR-05：upsert 失败时事务完整回滚 → 历史表无残留

**描述**：当主表 upsert 操作失败（如 DB 约束冲突、连接中断），整个事务回滚，历史表不留脏数据。

**断言**：
- upsert 失败时，历史表中不出现新增行
- 路由返回 HTTP 5xx 错误
- 历史表行数与失败前一致
- upsert 与历史写入同处一个 `BEGIN / COMMIT` 事务块

### [BEHAVIOR] FR-06：CI 全绿

**描述**：所有检查项通过，PR 可合并。

**断言**：
- ESLint 0 error
- TypeScript 编译 0 error
- 单元/集成测试全部通过（含 FR-01 ~ FR-05 对应 test cases）
- smoke 脚本 `crm-status-history-smoke.sh` 退出码 0
- 不破坏 `golden-path-1-smoke.sh` 已通过的步骤（向前兼容）

### [BEHAVIOR] FR-07：响应格式向前兼容

**描述**：路由改造（pool.query → 事务）不改变 `PUT /api/crm/customers/status` 的对外响应结构。

**断言**：
- 成功响应 body 结构与改造前一致（`success: true, data: {...}, message: ...`）
- 现有调用方无需修改即可继续工作

---

## E2E 验收

smoke 脚本路径：`.github/workflows/scripts/smoke/crm-status-history-smoke.sh`

### 脚本执行步骤

```bash
# Step 1：准备测试环境变量
#   DATABASE_URL, API_BASE（如 http://localhost:3000）, TENANT_ID, CS_WECHAT_ID, CONTACT

# Step 2（FR-02）：写新客户 → 验证历史表 old_status IS NULL
curl -s -X PUT "$API_BASE/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"$TENANT_ID","cs_wechat_id":"$CS_WECHAT_ID","contact":"$CONTACT","status":"A1"}'
# 断言：HTTP 200
# 断言：psql 查历史表 old_status IS NULL, new_status='A1'

# Step 3（FR-03）：改 status → 验证历史表新增一行，old_status 正确
curl -s -X PUT "$API_BASE/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"$TENANT_ID","cs_wechat_id":"$CS_WECHAT_ID","contact":"$CONTACT","status":"A2"}'
# 断言：HTTP 200
# 断言：psql 查历史表行数 = 2，最新行 old_status='A1', new_status='A2'

# Step 4（FR-04）：重复提交相同 status → 验证历史表行数不变
curl -s -X PUT "$API_BASE/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"$TENANT_ID","cs_wechat_id":"$CS_WECHAT_ID","contact":"$CONTACT","status":"A2"}'
# 断言：HTTP 200
# 断言：psql 查历史表行数仍 = 2

# Step 5（FR-05）：模拟事务失败 → 验证历史表无残留
# 注入无效 tenant_id（UUID 约束冲突）或通过临时 DB 规则触发回滚
# 断言：HTTP 5xx
# 断言：psql 查历史表行数不变

# Step 6（FR-01）：重跑 migration → 验证行数不增加
# psql -f migration.sql && psql 查总行数不变

# 所有步骤通过 → exit 0
```

### smoke-baseline.txt 棘轮

本 sprint 完成后，将 `crm-status-history-smoke.sh` 加入 `.github/workflows/scripts/smoke/smoke-baseline.txt`，防止后续 sprint 回归。

---

## 测试覆盖

文件路径：`apps/api/tests/routes/crm-status-history.test.ts`

| [BEHAVIOR] | it() 测试名称 | 类型 |
|-----------|-------------|------|
| FR-01 | `migration is idempotent — running twice does not duplicate history rows` | 集成 |
| FR-02 | `PUT /status for new customer inserts history row with old_status=null` | 集成 |
| FR-03 | `PUT /status with changed status inserts history row with correct old_status` | 集成 |
| FR-04 | `PUT /status with same status does not insert history row` | 集成 |
| FR-05 | `PUT /status rolls back history insert when upsert fails` | 集成 |
| FR-06 | `CI: ESLint passes on crm.ts and migration file` | lint（CI 阶段） |
| FR-07 | `PUT /status response shape is unchanged after transaction refactor` | 集成 |

### 附加单元测试

| 测试名称 | 覆盖点 |
|---------|--------|
| `statusDidChange returns true when old IS DISTINCT FROM new` | IS DISTINCT FROM 逻辑（含 NULL） |
| `statusDidChange returns false when old equals new` | 相同值不写历史 |
| `statusDidChange returns true when old is null and new is non-null` | 新客户 NULL→值 |
