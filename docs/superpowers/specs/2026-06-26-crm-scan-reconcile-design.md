# 设计：微信客服 CRM 采集对账 + 清存量

> Journey：ZenithJoy 客户管理（Line 04）。纯 `apps/api` 改动（migration + `crm.ts`），不动 agent、不碰版本闸。
> 接 PrepPRD `sprints/06261439-crm-scan-reconcile/prep-prd.md`（lead 2026-06-26 已确认默认值）。

## 背景与问题

`real-wheel` 全扫已稳（PR#897-903，rog 真机验过 18 真客户）。但 `POST /api/crm/friend-scan/ingest`
是**纯 upsert、只增不删**：修复前没判群时扫进的 ~64 个旧群条目永久残留在册。名册需要对账收敛。

对账是破坏性逻辑，必须带三道护栏：**软删（可恢复）+ 连续 K 次未扫到才删 + 默认干跑（只日志不删）**。

## 数据模型变更

新 migration `apps/api/db/migrations/20260626_xxxxxx_crm_customers_add_reconcile.sql`，给
`zenithjoy.crm_customers` 加两列（`ADD COLUMN IF NOT EXISTS`，幂等可重入）：

| 列 | 类型 | 含义 |
|---|---|---|
| `deleted_at` | `timestamptz`（可空，默认 NULL） | 软删时间戳；NULL=在册，非 NULL=已对账软删 |
| `scan_miss_count` | `int NOT NULL DEFAULT 0` | 连续未被扫到次数；扫到即归零 |

不动 PK / UNIQUE / 外键，无数据迁移。

## 对账逻辑（ingest 事务内，纯 SQL）

事务顺序：`BEGIN` → 逐 contact upsert → **对账 UPDATE** → onboarding upsert → `COMMIT`。

### 1. 入参预处理（upsert 之前）
- **self 跳过**：新增可选入参 `self_name`（string）。规范化后，名字等于 `self_name` 的 contact 整条**不入册**
  （从 `rows` 剔除）。agent 不传 → 无影响（向前兼容）。
- **ClawBot 默认黑名单**：常量 `DEFAULT_BLACKLIST_NAMES = new Set(['微信ClawBot'])`。这些名字
  **INSERT 时 identity='blacklist'**；`ON CONFLICT` **不覆盖** 已有 identity（保护人工已设）。

### 2. 扫到的 contact → 复活 + 归零（扩现有 upsert）
现有 `INSERT ... ON CONFLICT DO UPDATE` 扩两处：
- INSERT 列加 `identity`（值 = 名字∈黑名单常量 ? 'blacklist' : 'customer'）。
- `ON CONFLICT DO UPDATE SET` 追加 `scan_miss_count = 0, deleted_at = NULL`（扫到即复活归零；identity 不动）。

### 3. 没扫到的 source='scan' 行 → 累计 / 软删（一条 UPDATE）
**前置安全闸**：仅当本次 `rows.length > 0` 才执行对账。空扫描（agent 扫一半失败返回 0 人）
**整体跳过对账**——否则连续 3 次失败会误删全部。空扫描时 `scanned_count=0`，现有逻辑已记
`step_o2_scanned='fail'`，不动名册。

非空扫描时执行（K=3 常量）：

```sql
UPDATE zenithjoy.crm_customers
   SET scan_miss_count = scan_miss_count + 1,
       deleted_at = CASE
         WHEN $dryrun THEN deleted_at                                  -- 干跑：永不写 deleted_at
         WHEN scan_miss_count + 1 >= $K THEN now()                     -- 真模式：满 K 软删
         ELSE deleted_at END
 WHERE tenant_id = $tid::uuid AND cs_wechat_id = $cs
   AND source = 'scan' AND deleted_at IS NULL
   AND contact <> ALL($presentNames::text[])
 RETURNING contact, scan_miss_count, deleted_at;
```

- **干跑模式**（`CRM_RECONCILE_DRYRUN !== 'false'`，默认 true）：只累计 `scan_miss_count`，
  `deleted_at` 永不写；从 RETURNING 里挑 `scan_miss_count >= K` 的行打 `console.warn` 日志
  「[reconcile-dryrun] 本应软删 contact=X (miss=N)」，便于观测收敛。
- **真模式**（`CRM_RECONCILE_DRYRUN === 'false'`）：满 K 真写 `deleted_at=now()`；
  对 RETURNING 里 `deleted_at` 非空的行打 info 日志记录软删。
- `manual`/`message` 源行永不参与对账（`WHERE source='scan'` 已隔离）。

干跑开关只认环境变量字面 `'false'` 才进真模式，其它一切值（含未设）= 干跑，最大化安全。

## GET /api/crm/customers 变更
客户名册查询的 `WHERE` 追加 `AND deleted_at IS NULL`（软删行从名册消失）。
现有 `identity <> 'internal'` 排除保留。

## 清 64 旧群（一次性，不进 migration）
旧群是 staging `zenithjoy_test` 的**数据**、非 schema，不入 migration。提供
`sprints/06261439-crm-scan-reconcile/cleanup-stale-groups.sql`，在 staging 执行把已知旧群条目
软删（`UPDATE ... SET deleted_at=now() WHERE source='scan' AND <群名模式>`），可恢复。
验证时手动跑，不进 CI。

## 测试（vitest，先 failing 再实现）
文件 `apps/api/tests/routes/crm-friend-scan-reconcile.test.ts`，复用现有 mock-pool 模式
（`mockQuery`/`mockConnect`/clientQuery 序列断言 SQL 文本）：

1. **扫到复活归零**：upsert 的 ON CONFLICT SQL 含 `scan_miss_count = 0` 且含 `deleted_at = NULL`。
2. **未扫到累计**（干跑）：对账 UPDATE 跑了，SQL 含 `scan_miss_count + 1`，且 `deleted_at` 分支受 `$dryrun` 保护（断言传了 dryrun=true、SQL 不无条件写 now()）。
3. **满 K 软删**（真模式）：`CRM_RECONCILE_DRYRUN='false'` 时对账 UPDATE 含 `scan_miss_count + 1 >= ` 与 `now()`。
4. **空扫描跳过对账**：`contacts: []` → 不出现对账 UPDATE（clientQuery 里无 `scan_miss_count` 调用），onboarding 仍记 fail。
5. **ClawBot 默认黑名单**：contact='微信ClawBot' → INSERT 带 identity='blacklist'；ON CONFLICT 不含 identity 覆盖。
6. **self_name 跳过**：body 带 `self_name` 且与某 contact 同名 → 该 contact 不进 upsert（ingested 不计它）。
7. **GET /customers 排除软删**：roster 查询 SQL 含 `deleted_at IS NULL`（在 customer-roster 或 crm.test 覆盖）。

DB 真写端到端由现有 `line04-crm-*-smoke.sh` + staging 手验覆盖（dryrun=false 跑 force-scan）。

## 影响范围
- 纯 `apps/api`（1 migration + `crm.ts`），无 agent 改动、无版本面同步。
- GET /customers 多一个 WHERE 条件；manual 客户完全不受对账影响。
- 向前兼容：旧 agent（不传 self_name）行为不变，只多了「只增不删→对账」这一行为差异（且默认干跑，零破坏）。

## 验收
- [ ] vitest 全绿（上述 7 项）+ CI 全绿
- [ ] staging 设 `CRM_RECONCILE_DRYRUN=false` 跑一次 force-scan：旧群软删、18 真客户留存、ClawBot 标黑、名册干净
