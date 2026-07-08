# Contract DoD — CRM 客户状态历史追踪表

**Sprint**: 07081012-crm-status-history
**Base Repo**: zenithjoy
**版本**: 1.0（首轮，无 reviewer feedback）
**日期**: 2026-07-08

---

## Done 定义（全部通过才算 DONE）

### [BEHAVIOR-1] 新客户首次写 status → 历史表写入 old_status=NULL 记录

**描述**：当 `(tenant_id, cs_wechat_id, contact)` 组合在 `crm_customers` 中不存在时，调用 `PUT /api/crm/customers/status` 会在历史表写入一条 `old_status IS NULL, new_status = <status>` 的记录。

**验收方式**: `manual:bash`

```bash
# 前置：export DATABASE_URL=<本地连接串>，API 在 localhost:3000 运行
WECHAT_ID="dod_test_cs_$(date +%s)"
CONTACT="dod_test_new_$(date +%s)"

# 执行
curl -sf -X PUT "http://localhost:3000/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"$WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A1\"}"

# 验证
COUNT=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history
   WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT'
     AND old_status IS NULL AND new_status='A1'")
echo "历史记录数（期望=1）: $COUNT"
[ "$COUNT" -eq 1 ] && echo "[BEHAVIOR-1] PASS" || echo "[BEHAVIOR-1] FAIL"
```

---

### [BEHAVIOR-2] 状态真实变化（old != new）→ 历史表新增一条带旧值的记录

**描述**：客户已有 `status=A1`，再次调用 `PUT /api/crm/customers/status` 写入 `status=A3`，历史表新增一条 `old_status='A1', new_status='A3'` 的记录。

**验收方式**: `manual:bash`

```bash
WECHAT_ID="dod_test_cs_change"
CONTACT="dod_test_change_$(date +%s)"

# 步骤 1：写 A1（建立初始状态）
curl -sf -X PUT "http://localhost:3000/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"$WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A1\"}"

# 步骤 2：写 A3（触发变化）
curl -sf -X PUT "http://localhost:3000/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"$WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A3\"}"

# 验证：第二条记录 old='A1', new='A3'
ROWS=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history
   WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT'
     AND old_status='A1' AND new_status='A3'")
echo "变化历史行数（期望=1）: $ROWS"
[ "$ROWS" -eq 1 ] && echo "[BEHAVIOR-2] PASS" || echo "[BEHAVIOR-2] FAIL"
```

---

### [BEHAVIOR-3] 重复提交相同 status（old = new）→ 历史表行数不增加

**描述**：客户当前 `status=A3`，再次提交 `status=A3`，历史表行数不变，API 仍返回 `{"success":true,"status":"A3"}`。

**验收方式**: `manual:bash`

```bash
WECHAT_ID="dod_test_cs_dup"
CONTACT="dod_test_dup_$(date +%s)"

# 步骤 1：写 A3（建立状态）
curl -sf -X PUT "http://localhost:3000/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"$WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A3\"}"

# 记录写前行数
BEFORE=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history
   WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT'")

# 步骤 2：重复写 A3
RESP=$(curl -sf -X PUT "http://localhost:3000/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"$WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A3\"}")
echo "API 响应: $RESP"

AFTER=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history
   WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT'")

echo "写前行数: $BEFORE，写后行数: $AFTER（期望相等）"
[ "$BEFORE" -eq "$AFTER" ] && echo "[BEHAVIOR-3] PASS" || echo "[BEHAVIOR-3] FAIL"
```

---

### [BEHAVIOR-4] 事务原子性：upsert 失败时历史表无残留记录

**描述**：若 `crm_customers` 的 upsert 操作失败（DB 级错误），事务回滚，`crm_customer_status_history` 不留下任何孤立记录。

**验收方式**: `manual:bash`（需 integration test 覆盖，以下为手动验证思路）

```bash
# 手动验证：调用前后行数一致（前提：此 contact 从未存在过）
WECHAT_ID="dod_test_cs_rollback"
CONTACT="dod_test_rollback_$(date +%s)"

BEFORE=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history
   WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT'")

# 模拟 integration test 中 DB mock 注入错误后的结果验证
# 在 CI integration test 中：mock pool.connect() 的 client 在 upsert 时 throw，
# 断言此 contact 的历史表行数仍为 0

AFTER=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history
   WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT'")

echo "写前: $BEFORE，写后: $AFTER（期望相等，均为 0）"
[ "$BEFORE" -eq "$AFTER" ] && echo "[BEHAVIOR-4] PASS（手动前置验证）" || echo "[BEHAVIOR-4] FAIL"
# 完整验证以 integration test FR-6 为准
```

---

### [BEHAVIOR-5] Migration 回填幂等：重跑后历史表行数不增加

**描述**：执行 migration 后，再次执行相同 migration（或其回填部分），`crm_customer_status_history` 行数不变（`ON CONFLICT DO NOTHING`）。

**验收方式**: `manual:bash`

```bash
# 记录 migration 后行数
COUNT1=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history WHERE old_status IS NULL")

# 重跑回填 SQL（仅回填部分）
psql "$DATABASE_URL" -c "
  INSERT INTO zenithjoy.crm_customer_status_history
    (tenant_id, cs_wechat_id, contact, old_status, new_status, changed_at)
  SELECT tenant_id, cs_wechat_id, contact, NULL, status, COALESCE(updated_at, now())
  FROM zenithjoy.crm_customers
  WHERE status IS NOT NULL
  ON CONFLICT DO NOTHING;
"

COUNT2=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history WHERE old_status IS NULL")

echo "首次回填行数: $COUNT1，重跑后行数: $COUNT2（期望相等）"
[ "$COUNT1" -eq "$COUNT2" ] && echo "[BEHAVIOR-5] PASS" || echo "[BEHAVIOR-5] FAIL"
```

> **注**：BEHAVIOR-5 要求 migration 必须在历史表上建唯一约束以支持 `ON CONFLICT DO NOTHING`，建议复合唯一约束为 `(tenant_id, cs_wechat_id, contact, new_status) WHERE old_status IS NULL`，或改用 `WHERE NOT EXISTS` 回填方式。实现时确认。

---

## CI 门禁（DoD 技术门禁）

| 门禁 | 通过条件 |
|------|---------|
| `vitest` integration tests | FR-3 / FR-4 / FR-5 / FR-6 全部 PASS |
| smoke test | `crm-status-history-smoke.sh` exit 0 |
| TypeScript 编译 | `tsc --noEmit` 无报错 |
| ESLint | 0 error |
| Migration 重跑 | 历史表行数不变 |

---

## 产物清单

| 产物 | 路径 | 状态 |
|------|------|------|
| Migration SQL | `apps/api/db/migrations/20260708_??????_crm_customer_status_history.sql` | 待实现 |
| 路由改造 | `apps/api/src/routes/crm.ts`（PUT /customers/status 包事务） | 待实现 |
| Integration Tests | `apps/api/src/routes/__tests__/crm-status-history.test.ts` | 骨架已建（Red） |
| Smoke Test | `.github/workflows/scripts/smoke/crm-status-history-smoke.sh` | 待实现 |
| Contract Draft | `sprints/07081012-crm-status-history/contract-draft.md` | 已完成 |
| Contract DoD | `sprints/07081012-crm-status-history/contract-dod.md` | 已完成（本文件） |
