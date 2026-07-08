# Contract Draft — CRM 客户状态历史追踪表

**Sprint**: 07081012-crm-status-history
**Base Repo**: zenithjoy
**Target Environment**: local_api
**起草日期**: 2026-07-08
**状态**: 草稿（首轮，待 Reviewer 确认）

---

## 范围声明

本合同覆盖以下变更的验收标准：

1. 新建 migration `crm_customer_status_history` 表 + 索引 + 回填
2. 改造 `PUT /api/crm/customers/status` 路由包事务写历史
3. 不变更 response schema（仍返回 `{ success: true, status: "Ax" }`）
4. 不新增读路径 API 端点

---

## Invariant 约束（合同级别，不得违反）

| # | Invariant | 验收断言 |
|---|-----------|---------|
| I-1 | **原子性**：`crm_customers` upsert 与历史 insert 同一 DB 事务 | 模拟 DB 错误时历史表无残留（FR-6） |
| I-2 | **幂等性**：migration 回填 `ON CONFLICT DO NOTHING` | 重跑 migration 后历史表行数不变 |
| I-3 | **无副作用写入**：`old_status = new_status` 时不写历史 | FR-5 验证行数不变 |
| I-4 | **历史只追加**：无 UPDATE/DELETE 路径 | 代码审查 + 无对应 endpoint |
| I-5 | **单一写入点**：仅 `PUT /api/crm/customers/status` 写 status | 代码审查确认 |

---

## FR 验收断言（技术级别）

### FR-1：建表 + 回填

**断言**：
- `zenithjoy.crm_customer_status_history` 表存在，字段含：`id UUID PK DEFAULT gen_random_uuid()`、`tenant_id UUID NOT NULL`、`cs_wechat_id TEXT NOT NULL`、`contact TEXT NOT NULL`、`old_status TEXT NULL`、`new_status TEXT NOT NULL`、`changed_at TIMESTAMPTZ DEFAULT now()`
- 索引 `idx_crm_customer_status_history_lookup` 在 `(tenant_id, cs_wechat_id, contact)` 上存在
- 已有 `crm_customers` 记录（`status NOT NULL`）每行在历史表有对应 `old_status=NULL, new_status=当前status` 回填记录
- migration 重跑后行数不变

**psql 验证**：
```sql
-- 确认表结构
\d zenithjoy.crm_customer_status_history

-- 确认回填幂等（重跑后行数不变）
SELECT count(*) FROM zenithjoy.crm_customer_status_history WHERE old_status IS NULL;
```

---

### FR-2：事务包裹

**断言**：
- `PUT /api/crm/customers/status` 使用 `pool.connect()` 获取独立 client，依次执行 `BEGIN`、SELECT 旧值、upsert、条件 INSERT 历史、`COMMIT`；任何步骤抛异常时执行 `ROLLBACK`
- 响应结构不变：`{ success: true, status: "Ax" }`

**验证方式**：代码审查 `apps/api/src/routes/crm.ts` + FR-6 integration test

---

### FR-3：新客户首次写 status

**断言**：
- 调用 `PUT /api/crm/customers/status` 写入一个从未出现过的 `(cs_wechat_id, contact)` 组合
- 历史表出现且仅出现 1 条记录：`old_status IS NULL`，`new_status = <st>`，`tenant_id` 匹配

**curl 验证**：
```bash
BASE="http://localhost:3000"
curl -sf -X PUT "$BASE/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d '{"wechat_id":"test_cs_001","contact":"test_customer_new","status":"A1"}'
# 期望响应：{"success":true,"status":"A1"}

psql "$DATABASE_URL" -c \
  "SELECT id, old_status, new_status, changed_at
   FROM zenithjoy.crm_customer_status_history
   WHERE cs_wechat_id='test_cs_001' AND contact='test_customer_new';"
# 期望：1行，old_status=NULL，new_status='A1'
```

---

### FR-4：状态变化写历史

**断言**：
- 先写 A1，再写 A3（同一客户）
- 历史表出现第 2 条记录：`old_status='A1'`，`new_status='A3'`
- 历史表总共 2 条（NULL→A1 + A1→A3）

**curl 验证**：
```bash
# 前置：客户已存在 status=A1
curl -sf -X PUT "$BASE/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d '{"wechat_id":"test_cs_001","contact":"test_customer_change","status":"A3"}'
# 期望响应：{"success":true,"status":"A3"}

psql "$DATABASE_URL" -c \
  "SELECT old_status, new_status FROM zenithjoy.crm_customer_status_history
   WHERE cs_wechat_id='test_cs_001' AND contact='test_customer_change'
   ORDER BY changed_at;"
# 期望：第二行 old_status='A1', new_status='A3'
```

---

### FR-5：重复 status 不写历史

**断言**：
- 客户当前 status=A3，再次调用 `PUT` 写 A3
- 历史表行数不变（不新增记录）
- API 仍返回 `{ success: true, status: "A3" }`

**psql 验证**：
```bash
BEFORE=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history
   WHERE cs_wechat_id='test_cs_001' AND contact='test_customer_change'")
curl -sf -X PUT "$BASE/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d '{"wechat_id":"test_cs_001","contact":"test_customer_change","status":"A3"}'
AFTER=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history
   WHERE cs_wechat_id='test_cs_001' AND contact='test_customer_change'")
[ "$BEFORE" -eq "$AFTER" ] && echo "PASS" || echo "FAIL"
```

---

### FR-6：事务回滚不残留历史

**断言**：
- 模拟 `crm_customers` upsert 失败（例如：注入 DB 错误或 mock pool）
- 历史表无对应记录写入
- API 返回 500

**验证方式**：integration test mock `pool.connect()` 的 client.query 在 upsert 步骤抛错，断言历史表无新增行

---

## E2E 验收（smoke test 路径）

Smoke test 文件：`.github/workflows/scripts/smoke/crm-status-history-smoke.sh`

```bash
#!/usr/bin/env bash
# crm-status-history-smoke.sh
# 前置条件：API 已启动（localhost:3000），DATABASE_URL 已设置，DB migration 已跑
set -euo pipefail

BASE="http://localhost:3000"
WECHAT_ID="smoke_cs_$(date +%s)"
CONTACT="smoke_customer_$(date +%s)"

echo "=== [1/3] 新客户首次写 status → 历史表出现 old_status=NULL 记录 ==="
curl -sf -X PUT "$BASE/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"$WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A1\"}"

COUNT=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history \
   WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT' AND old_status IS NULL AND new_status='A1'")
[ "$COUNT" -eq 1 ] || { echo "FAIL: 新客户历史记录未写入 (count=$COUNT)"; exit 1; }
echo "PASS"

echo "=== [2/3] 状态变化（A1→A3）→ 历史表新增 old_status='A1' 记录 ==="
curl -sf -X PUT "$BASE/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"$WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A3\"}"

COUNT2=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history \
   WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT' AND old_status='A1' AND new_status='A3'")
[ "$COUNT2" -eq 1 ] || { echo "FAIL: 状态变化历史未写入 (count=$COUNT2)"; exit 1; }
echo "PASS"

echo "=== [3/3] 重复提交相同 status（A3）→ 历史表行数不增加 ==="
BEFORE=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history \
   WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT'")

curl -sf -X PUT "$BASE/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"$WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A3\"}"

AFTER=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history \
   WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT'")
[ "$BEFORE" -eq "$AFTER" ] || { echo "FAIL: 重复 status 不应新增历史记录 (before=$BEFORE, after=$AFTER)"; exit 1; }
echo "PASS"

echo ""
echo "crm-status-history smoke 全部通过 (3/3)"
```

---

## 超出范围（本合同不覆盖）

- 历史数据查询 API（timeline 端点）
- Dashboard 前端历史展示
- A/B 测试分析 pipeline
- `POST /api/crm/customers` 写 status 初始值

---

## 假设与风险

| 假设 | 风险 | 缓解 |
|------|------|------|
| `pool.query` 需改为 `pool.connect()` + client 模式以支持事务 | 改动范围稍大 | 实现时优先确认，约 +5 行 |
| `crm_customers` 无脏 status 数据 | 回填失败 | migration 含 `WHERE status IS NOT NULL` 防御 |
| migration 时间戳格式 `20260708_HHMMSS` | 与现有不一致 | 实现前确认 migration 目录现有文件命名 |
