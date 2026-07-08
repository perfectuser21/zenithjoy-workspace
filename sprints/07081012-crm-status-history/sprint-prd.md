# Sprint PRD — CRM 客户状态历史追踪表（crm_customer_status_history）

## OKR 对齐

- **对应 KR**：Line 04 客户私域 AI 接管 — "装真人"人格 A/B 测试数据基础设施
- **当前进度**：`crm_customers.status` 唯一写入点无历史留存，无法测量"推进速度"（状态变化时间间隔）
- **本次推进预期**：建历史表 + 改写入路由包事务，全量捕获 status 变化，为 A/B 测试 pipeline 提供数据源

## 背景

"装真人"人格项目要对 5 个子项目做 A/B 测试，核心指标之一是**推进速度**：同一个客户在 A 人格 vs B 人格下从 A1→A3 分别花了多少天。当前 `crm_customers` 只有 `status` 字段（当前值），无历史记录，无法计算变化间隔。本 sprint 补上这块数据基础设施，不动读路径（timeline 等后续子项目再接入）。

## Golden Path（核心场景）

CS 在 Dashboard 把客户状态从 A2 拖到 A3 → `PUT /api/crm/customers/status` 被调用 → 在同一事务内：upsert `crm_customers.status = A3`，并在 `crm_customer_status_history` 插入一行 `old_status='A2', new_status='A3', changed_at=now()` → 事务提交 → API 返回 `{ success: true, status: 'A3' }` → 历史表可查到该变化记录。

## Invariant 约束

1. **原子性**：`crm_customers` upsert 与 `crm_customer_status_history` insert 必须在同一 DB 事务内，任一失败整体回滚，历史表不残留孤立记录。
2. **幂等性**：migration 的回填 INSERT 使用 `ON CONFLICT DO NOTHING`（或等效 WHERE NOT EXISTS），重跑不重复插入。
3. **无副作用写入**：status 未变化（`old_status = new_status`）时，历史表不新增记录；仅在新客户（`old_status IS NULL`）或状态真实变化时才写入。
4. **历史只追加**：`crm_customer_status_history` 无 UPDATE/DELETE 路径，只 INSERT。
5. **单一写入点**：`crm_customers.status` 的唯一写入点是 `PUT /api/crm/customers/status`，本 sprint 改造范围仅限此处。

## 累积 FR（功能需求）

| # | 需求 | 验收断言 |
|---|------|---------|
| FR-1 | 新建 migration `crm_customer_status_history` 表：字段含 `id UUID PK`、`tenant_id UUID`、`cs_wechat_id TEXT`、`contact TEXT`、`old_status TEXT NULL`（新客户为 NULL）、`new_status TEXT NOT NULL`、`changed_at TIMESTAMPTZ DEFAULT now()`；索引 `(tenant_id, cs_wechat_id, contact)`；同时回填现存 `crm_customers` 记录（每行插一条 `old_status=NULL, new_status=当前status`），回填幂等 | migration 脚本重跑后历史表行数不增加 |
| FR-2 | `PUT /api/crm/customers/status` 包事务：先 SELECT `crm_customers.status`（取旧值），再 upsert，再按条件写历史表 | 事务失败时历史表无残留，`BEGIN/COMMIT/ROLLBACK` 可观测 |
| FR-3 | 新客户首次写 status → 历史表出现一条 `old_status=NULL, new_status=<st>` 记录 | integration test 验证 |
| FR-4 | 已有客户 status 变化（`old != new`）→ 历史表新增一条记录，`old_status=旧值, new_status=新值` | integration test 验证 |
| FR-5 | 重复提交相同 status（`old = new`）→ 历史表不新增记录 | integration test 验证（行数不变） |
| FR-6 | upsert 失败（模拟 DB 错误）时历史表不残留记录（事务回滚） | integration test 验证 |

## NFR（非功能需求）

- **延迟**：单次 `PUT /api/crm/customers/status` 响应时间增量 ≤ 5ms（同一 DB 连接，事务开销极小）
- **存储**：历史表行数 ≈ crm_customers 行数 × 平均状态变化次数，预估初期 < 10K 行，无分区需求
- **可观测性**：历史表可直接 SQL 查询，无额外 API 端点（读路径留给后续子项目）
- **迁移安全**：migration 含 `CREATE TABLE IF NOT EXISTS` + 回填 `ON CONFLICT DO NOTHING`，对生产无破坏性

## Response Schema

```json
// PUT /api/crm/customers/status — 响应结构不变
{ "success": true, "status": "A3" }
// 错误时：{ "success": false, "error": "..." }
```

## 边界情况

- `old_status = new_status` 时历史表静默跳过（不写入），API 仍返回 `{ success: true }`
- `old_status IS NULL`（新客户）视为变化，必须写入历史
- migration 回填只写当前 `crm_customers` 里有 status 值的行，NULL status 跳过（目前业务不应存在但防御）
- 历史表 FK 不指向 `crm_customers`（避免 RESTRICT 级联风险），用 `(tenant_id, cs_wechat_id, contact)` 软关联

## 范围限定

**在范围内**：
- `apps/api/db/migrations/20260708_xxxxxx_crm_customer_status_history.sql`：建表 + 索引 + 回填
- `apps/api/src/routes/crm.ts`：`PUT /api/crm/customers/status` 路由包事务、写历史逻辑
- `apps/api/src/routes/__tests__/crm-status-history.test.ts`：integration tests（FR-3 到 FR-6）
- `.github/workflows/scripts/smoke/crm-status-history-smoke.sh`：smoke test（curl 调 API 验证历史记录写入）

**不在范围内**：
- 历史数据查询 API（timeline 端点等，后续子项目）
- Dashboard 前端展示历史
- 其他 crm_customers 写入点（目前只有 status 这一个，POST /api/crm/customers 不写 status 初始值）
- A/B 测试分析 pipeline（本 sprint 只建数据基础，不跑分析）

## 假设

- [ASSUMPTION: `pool.query` 支持事务（`BEGIN`/`COMMIT`/`ROLLBACK` 直接用 pool 发）；若需 `pool.connect()` + client 模式，实现时确认]
- [ASSUMPTION: `crm_customers` 表有 `(tenant_id, cs_wechat_id, contact)` 唯一约束，migration 软关联安全]
- [ASSUMPTION: 迁移时间戳格式与现有 migration 一致：`20260708_HHMMSS_<name>.sql`]
- [ASSUMPTION: 现有 `crm_customers.status` 字段值全部是 A1-A5 或 NULL，不存在脏数据]

## 预期受影响文件

- `apps/api/db/migrations/20260708_??????_crm_customer_status_history.sql`：新建
- `apps/api/src/routes/crm.ts`：改造 `PUT /api/crm/customers/status`（约 +20 行，包事务）
- `apps/api/src/routes/__tests__/crm-status-history.test.ts`：新建 integration tests
- `.github/workflows/scripts/smoke/crm-status-history-smoke.sh`：新建 smoke test

## E2E 验收

```bash
# crm-status-history-smoke.sh
# 前置：API 已启动，DB 连通

BASE="http://localhost:3000"
WECHAT_ID="smoke_cs_001"
CONTACT="smoke_customer_001"

# 1. 新客户首次写 status → 历史表出现 old_status=NULL 记录
curl -sf -X PUT "$BASE/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"$WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A1\"}"
COUNT=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history \
   WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT' AND old_status IS NULL AND new_status='A1'")
[ "$COUNT" -eq 1 ] || { echo "FAIL: 新客户历史记录未写入"; exit 1; }

# 2. 状态变化 → 历史表新增记录
curl -sf -X PUT "$BASE/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"$WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A3\"}"
COUNT2=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history \
   WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT' AND old_status='A1' AND new_status='A3'")
[ "$COUNT2" -eq 1 ] || { echo "FAIL: 状态变化历史未写入"; exit 1; }

# 3. 重复提交相同 status → 历史表不增加
BEFORE=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT'")
curl -sf -X PUT "$BASE/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"$WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A3\"}"
AFTER=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT'")
[ "$BEFORE" -eq "$AFTER" ] || { echo "FAIL: 重复 status 不应新增历史记录"; exit 1; }

echo "✅ crm-status-history smoke 全部通过"
```

## journey_type: local_api
## journey_type_reason: 纯后端 API + DB migration 改动，运行在本地 API 服务，无需浏览器/Windows 环境
## target_environment: local_api
## target_environment_reason: integration tests 直连本地 PostgreSQL + API server（localhost:3000），smoke test 同环境
