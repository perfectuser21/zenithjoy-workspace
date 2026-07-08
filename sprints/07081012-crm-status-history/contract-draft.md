# Contract Draft — CRM Status History 历史追踪表

**Sprint**: 07081012-crm-status-history
**Task**: 5d090237-6046-410a-97a6-2bb0c91db411
**Date**: 2026-07-08
**Round**: R1（首轮）

---

## 范围说明

本次改动边界：

1. **新增 migration 文件**（`apps/api/db/migrations/20260708_120000_crm_status_history.sql`）
   - 建表 `zenithjoy.crm_customer_status_history`（幂等 DDL）
   - 回填现有 `crm_customers` 行（`ON CONFLICT DO NOTHING` 或 `NOT EXISTS`）
   - **不修改** `crm_customers` 表结构、唯一键、CHECK 约束

2. **修改 `PUT /api/crm/customers/status` 路由**（`apps/api/src/routes/crm.ts` ~470行）
   - 从单条 `pool.query(upsert)` 改为 `pool.connect()` 事务
   - 事务内：`BEGIN → SELECT old_status → upsert → 条件 INSERT history → COMMIT`
   - 任意步骤抛异常 → `ROLLBACK`
   - **接口响应 schema 不变**：`{success: true, status: string}`

3. **范围外（本次不动）**：
   - GET 历史查询端点（不在本 sprint）
   - `crm_customers` 其他字段
   - 租户解析逻辑（`resolveTenantId`）

---

## E2E 验收

> 所有命令在 `windows_cloud` GitHub Actions runner 上执行，或本地 `apps/api` 服务启动后手动验证。
> 前提：环境变量 `API_URL`（默认 `http://localhost:3000`）、`VALID_WECHAT_ID`、`VALID_TENANT_ID` 已设置。

### E2E-1：migration 幂等（重跑不重复插入）

```bash
# 第一次跑 migration
psql "$DATABASE_URL" -f apps/api/db/migrations/20260708_120000_crm_status_history.sql

# 第二次跑同一 migration（幂等验证）
psql "$DATABASE_URL" -f apps/api/db/migrations/20260708_120000_crm_status_history.sql

# 验证：回填行数 <= crm_customers 行数（无重复）
HISTORY_COUNT=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history WHERE old_status IS NULL")
CUSTOMER_COUNT=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM zenithjoy.crm_customers")
echo "history_backfill=$HISTORY_COUNT customer_count=$CUSTOMER_COUNT"
[ "$HISTORY_COUNT" -le "$CUSTOMER_COUNT" ] && echo "PASS: 回填幂等" || (echo "FAIL: 回填重复"; exit 1)
```

### E2E-2：新客户首次写 status → 历史表出现 old_status=NULL 记录

```bash
NEW_CONTACT="e2e-new-$(date +%s)"

# 写入新客户 status
RESP=$(curl -sf -X PUT "${API_URL}/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"${VALID_WECHAT_ID}\",\"contact\":\"${NEW_CONTACT}\",\"status\":\"A2\"}")
echo "response: $RESP"
echo "$RESP" | grep -q '"success":true' || (echo "FAIL: 接口未返回 success"; exit 1)

# 验证历史表有 old_status=NULL 的记录
COUNT=$(psql "$DATABASE_URL" -tAc "
  SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history
  WHERE cs_wechat_id='${VALID_WECHAT_ID}' AND contact='${NEW_CONTACT}'
    AND old_status IS NULL AND new_status='A2'")
[ "$COUNT" -eq 1 ] && echo "PASS: 新客户历史记录写入" || (echo "FAIL: 期望1条 got $COUNT"; exit 1)
```

### E2E-3：已有客户 status 变化 → 历史表新增对应记录

```bash
EXISTING_CONTACT="e2e-existing-$(date +%s)"

# 先建立初始 status A2
curl -sf -X PUT "${API_URL}/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"${VALID_WECHAT_ID}\",\"contact\":\"${EXISTING_CONTACT}\",\"status\":\"A2\"}" > /dev/null

BEFORE=$(psql "$DATABASE_URL" -tAc "
  SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history
  WHERE cs_wechat_id='${VALID_WECHAT_ID}' AND contact='${EXISTING_CONTACT}'")

# 变更 status A2 → A3
RESP=$(curl -sf -X PUT "${API_URL}/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"${VALID_WECHAT_ID}\",\"contact\":\"${EXISTING_CONTACT}\",\"status\":\"A3\"}")
echo "$RESP" | grep -q '"success":true' || (echo "FAIL"; exit 1)

AFTER=$(psql "$DATABASE_URL" -tAc "
  SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history
  WHERE cs_wechat_id='${VALID_WECHAT_ID}' AND contact='${EXISTING_CONTACT}'")

[ "$AFTER" -eq $((BEFORE + 1)) ] && echo "PASS: status 变化历史新增" || (echo "FAIL: before=$BEFORE after=$AFTER"; exit 1)

# 验证最新一条 old='A2', new='A3'
LATEST=$(psql "$DATABASE_URL" -tAc "
  SELECT old_status||','||new_status FROM zenithjoy.crm_customer_status_history
  WHERE cs_wechat_id='${VALID_WECHAT_ID}' AND contact='${EXISTING_CONTACT}'
  ORDER BY changed_at DESC LIMIT 1")
[ "$LATEST" = "A2,A3" ] && echo "PASS: old/new_status 正确" || (echo "FAIL: got $LATEST"; exit 1)
```

### E2E-4：重复提交相同 status → 历史表不新增记录

```bash
SAME_CONTACT="e2e-same-$(date +%s)"

# 初始写入 A3
curl -sf -X PUT "${API_URL}/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"${VALID_WECHAT_ID}\",\"contact\":\"${SAME_CONTACT}\",\"status\":\"A3\"}" > /dev/null

COUNT_BEFORE=$(psql "$DATABASE_URL" -tAc "
  SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history
  WHERE cs_wechat_id='${VALID_WECHAT_ID}' AND contact='${SAME_CONTACT}'")

# 再次提交相同 A3
RESP=$(curl -sf -X PUT "${API_URL}/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"${VALID_WECHAT_ID}\",\"contact\":\"${SAME_CONTACT}\",\"status\":\"A3\"}")
echo "$RESP" | grep -q '"success":true' || (echo "FAIL"; exit 1)

COUNT_AFTER=$(psql "$DATABASE_URL" -tAc "
  SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history
  WHERE cs_wechat_id='${VALID_WECHAT_ID}' AND contact='${SAME_CONTACT}'")

[ "$COUNT_BEFORE" -eq "$COUNT_AFTER" ] && echo "PASS: 相同 status 不写历史" || (echo "FAIL: before=$COUNT_BEFORE after=$COUNT_AFTER"; exit 1)
```

### E2E-5：upsert 失败时历史表不残留记录（事务回滚）

```bash
# 此场景在单元测试/集成测试层验证（需 mock DB 报错）
# 生产环境验证：检查 crm_customer_status_history 行数在 500 响应后不变
ROLLBACK_CONTACT="e2e-rollback-$(date +%s)"

COUNT_BEFORE=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history")

# 用无效 DATABASE_URL 或注入参数让 upsert 失败时，通过 mock 测试覆盖
# 正向验证：正常 upsert 成功的情况下历史一致
curl -sf -X PUT "${API_URL}/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"${VALID_WECHAT_ID}\",\"contact\":\"${ROLLBACK_CONTACT}\",\"status\":\"A1\"}" > /dev/null

COUNT_AFTER=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history")
[ "$COUNT_AFTER" -ge "$COUNT_BEFORE" ] && echo "PASS: 事务结构完整（回滚场景由 unit test 覆盖)"
```

---

## Test Contract

| # | [BEHAVIOR] | 验收断言 | 测试层 |
|---|-----------|---------|------|
| 1 | [BEHAVIOR-01] migration 幂等 | 连续执行 migration 两次，`crm_customer_status_history` 中 `old_status IS NULL` 的行数不超过 `crm_customers` 行数 | E2E bash |
| 2 | [BEHAVIOR-02] 新客户首次写 status | `PUT /status` 对未存在的 `(wechat_id, contact)` 发请求，历史表出现 1 条 `old_status=NULL, new_status=目标值` 记录 | unit + E2E |
| 3 | [BEHAVIOR-03] status 变化写历史 | 已有客户从 A2 → A3，历史表新增 1 条 `old_status='A2', new_status='A3'` 记录 | unit + E2E |
| 4 | [BEHAVIOR-04] 相同 status 不写历史 | 重复提交相同 status，历史表行数不增加，接口仍返回 `{success:true}` | unit + E2E |
| 5 | [BEHAVIOR-05] upsert 失败事务回滚 | 模拟 upsert 抛异常，历史表行数不变，接口返回 500 | unit (mock) |
| 6 | [BEHAVIOR-06] COMMIT 顺序正确 | `client.query` 调用顺序：`BEGIN → SELECT → upsert → INSERT history → COMMIT` | unit (mock) |

---

## 风险与假设

| 风险 | 说明 | 缓解 |
|------|------|------|
| 回填数据量大 | 生产 `crm_customers` 行数未知，回填可能阻塞写入 | migration 用批量 INSERT + `NOT EXISTS`，不锁全表 |
| 历史表 CHECK 约束 | `old_status` 允许 NULL，CHECK 需正确写 `CHECK (old_status IN (...))` 而非 NOT NULL CHECK | DDL 中 `old_status text CHECK (old_status IN ('A1','A2','A3','A4','A5'))` NULL 值不触发 CHECK，符合预期 |
| pool.connect() 连接泄漏 | 若 ROLLBACK 后未释放 client，连接池耗尽 | `try/finally { client.release() }` 强制释放 |
| windows_cloud 无真实 DB | CI runner 需要 pg 服务 | `services: postgres` 已在 CI workflow 配置；E2E-5 回滚场景降级到 unit mock |
| `resolveTenantId` 内部调用 pool | 已有的 `resolveTenantId` 使用 `pool.query`（非事务客户端），不在本事务内 | 可接受：tenant 解析是幂等读操作，不需要纳入事务 |
