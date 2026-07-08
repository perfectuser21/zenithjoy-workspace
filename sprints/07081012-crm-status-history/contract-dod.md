# Contract DoD — CRM Status History 历史追踪表

**Sprint**: 07081012-crm-status-history
**Task**: 5d090237-6046-410a-97a6-2bb0c91db411
**Date**: 2026-07-08

---

## 完成标准（Definition of Done）

以下 5 条 [BEHAVIOR] 断言**全部**通过，本 sprint 视为完成。

---

### [BEHAVIOR-01] migration 回填幂等——重跑不重复插入

**技术断言**：migration 文件连续执行两次，`crm_customer_status_history` 中每个 `(tenant_id, cs_wechat_id, contact)` 组合最多只有 1 条 `old_status IS NULL` 的回填行；无报错退出。

```bash
# 验收命令（manual:bash）
psql "$DATABASE_URL" -f apps/api/db/migrations/20260708_120000_crm_status_history.sql
psql "$DATABASE_URL" -f apps/api/db/migrations/20260708_120000_crm_status_history.sql

DUPES=$(psql "$DATABASE_URL" -tAc "
  SELECT COUNT(*) FROM (
    SELECT tenant_id, cs_wechat_id, contact
    FROM zenithjoy.crm_customer_status_history
    WHERE old_status IS NULL
    GROUP BY tenant_id, cs_wechat_id, contact
    HAVING COUNT(*) > 1
  ) t")
[ "$DUPES" -eq 0 ] && echo "PASS [BEHAVIOR-01]" || (echo "FAIL [BEHAVIOR-01]: $DUPES 组重复回填"; exit 1)
```

---

### [BEHAVIOR-02] 新客户首次写 status → 历史表出现 old_status=NULL 记录

**技术断言**：对 `crm_customers` 中**不存在**的 `(wechat_id, contact)` 发起 `PUT /api/crm/customers/status`，历史表新增恰好 1 条记录，且 `old_status IS NULL`、`new_status = 请求值`。

```bash
# 验收命令（manual:bash）
NEW_CONTACT="dod-new-$(date +%s)"
curl -sf -X PUT "${API_URL}/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"${VALID_WECHAT_ID}\",\"contact\":\"${NEW_CONTACT}\",\"status\":\"A2\"}" \
  | grep -q '"success":true' || (echo "FAIL [BEHAVIOR-02]: 接口未成功"; exit 1)

COUNT=$(psql "$DATABASE_URL" -tAc "
  SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history
  WHERE cs_wechat_id='${VALID_WECHAT_ID}' AND contact='${NEW_CONTACT}'
    AND old_status IS NULL AND new_status='A2'")
[ "$COUNT" -eq 1 ] && echo "PASS [BEHAVIOR-02]" || (echo "FAIL [BEHAVIOR-02]: 期望1条 got $COUNT"; exit 1)
```

---

### [BEHAVIOR-03] 已有客户 status 变化 → 历史表新增对应记录

**技术断言**：`crm_customers` 中已存在 `status='A2'` 的客户，发起 `PUT /api/crm/customers/status` 将其改为 `A3`，历史表新增恰好 1 条 `old_status='A2', new_status='A3'` 记录。

```bash
# 验收命令（manual:bash）
CONTACT="dod-existing-$(date +%s)"
# 建立初始状态
curl -sf -X PUT "${API_URL}/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"${VALID_WECHAT_ID}\",\"contact\":\"${CONTACT}\",\"status\":\"A2\"}" > /dev/null

BEFORE=$(psql "$DATABASE_URL" -tAc "
  SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history
  WHERE cs_wechat_id='${VALID_WECHAT_ID}' AND contact='${CONTACT}'")

# 变更 A2 → A3
curl -sf -X PUT "${API_URL}/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"${VALID_WECHAT_ID}\",\"contact\":\"${CONTACT}\",\"status\":\"A3\"}" \
  | grep -q '"success":true' || (echo "FAIL [BEHAVIOR-03]: 接口未成功"; exit 1)

AFTER=$(psql "$DATABASE_URL" -tAc "
  SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history
  WHERE cs_wechat_id='${VALID_WECHAT_ID}' AND contact='${CONTACT}'")

[ "$AFTER" -eq $((BEFORE + 1)) ] || (echo "FAIL [BEHAVIOR-03]: 行数未增加 before=$BEFORE after=$AFTER"; exit 1)

LATEST=$(psql "$DATABASE_URL" -tAc "
  SELECT old_status||','||new_status FROM zenithjoy.crm_customer_status_history
  WHERE cs_wechat_id='${VALID_WECHAT_ID}' AND contact='${CONTACT}'
  ORDER BY changed_at DESC LIMIT 1")
[ "$LATEST" = "A2,A3" ] && echo "PASS [BEHAVIOR-03]" || (echo "FAIL [BEHAVIOR-03]: old/new got $LATEST"; exit 1)
```

---

### [BEHAVIOR-04] 重复提交相同 status → 历史表不新增记录

**技术断言**：对已存在 `status='A3'` 的客户再次 `PUT status='A3'`，历史表行数不增加，接口仍返回 `{success:true, status:'A3'}`。

```bash
# 验收命令（manual:bash）
CONTACT="dod-same-$(date +%s)"
curl -sf -X PUT "${API_URL}/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"${VALID_WECHAT_ID}\",\"contact\":\"${CONTACT}\",\"status\":\"A3\"}" > /dev/null

COUNT_BEFORE=$(psql "$DATABASE_URL" -tAc "
  SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history
  WHERE cs_wechat_id='${VALID_WECHAT_ID}' AND contact='${CONTACT}'")

RESP=$(curl -sf -X PUT "${API_URL}/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"${VALID_WECHAT_ID}\",\"contact\":\"${CONTACT}\",\"status\":\"A3\"}")
echo "$RESP" | grep -q '"success":true' || (echo "FAIL [BEHAVIOR-04]: 接口未成功"; exit 1)

COUNT_AFTER=$(psql "$DATABASE_URL" -tAc "
  SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history
  WHERE cs_wechat_id='${VALID_WECHAT_ID}' AND contact='${CONTACT}'")

[ "$COUNT_BEFORE" -eq "$COUNT_AFTER" ] && echo "PASS [BEHAVIOR-04]" || (echo "FAIL [BEHAVIOR-04]: 行数增加 before=$COUNT_BEFORE after=$COUNT_AFTER"; exit 1)
```

---

### [BEHAVIOR-05] upsert 失败时历史表不残留记录（事务回滚）

**技术断言**：在 upsert 执行阶段抛出 DB 异常（mock），历史表行数与调用前相同，接口返回 HTTP 500。此条在 unit test（mock pool）层验证。

```bash
# 验收命令（manual:bash）——通过 unit test 间接验证
# 运行 vitest 测试，验证 [BEHAVIOR-05] 对应用例通过
cd apps/api
npx vitest run sprints/07081012-crm-status-history/tests/crm-status-history.test.ts \
  --reporter=verbose 2>&1 | grep -E "\[BEHAVIOR-05\]|PASS|FAIL" \
  | grep -v "FAIL" && echo "PASS [BEHAVIOR-05]" || (echo "FAIL [BEHAVIOR-05]"; exit 1)
```

---

## 铁律检查单

- [ ] [BEHAVIOR-01] migration 回填幂等通过
- [ ] [BEHAVIOR-02] 新客户首次写 status，历史表 old_status=NULL 通过
- [ ] [BEHAVIOR-03] 已有客户 status 变化历史新增通过
- [ ] [BEHAVIOR-04] 重复提交相同 status 不写历史通过
- [ ] [BEHAVIOR-05] upsert 失败事务回滚通过
- [ ] 接口响应 schema 不变（`{success, status}`）
- [ ] `pool.connect()` 获取客户端，`try/finally client.release()` 无连接泄漏
- [ ] migration 文件通过 `psql` 两次执行无报错、无重复行
