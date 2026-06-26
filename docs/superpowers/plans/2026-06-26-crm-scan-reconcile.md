# CRM 采集对账 + 清存量 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 给微信客服 CRM 采集 ingest 加对账（软删+连续 K=3+默认干跑+空扫描跳过+ClawBot 默认黑名单+self_name 跳过），名册排除软删，并清 staging 存量旧群。

**Architecture:** 纯 `apps/api`。新 migration 给 `crm_customers` 加 `deleted_at`/`scan_miss_count` 两列。`crm.ts` 的 `POST /friend-scan/ingest` 在同一事务内加一条对账 UPDATE（放 onboarding 之后、COMMIT 之前，保现有测试不破）。`GET /customers` 加 `deleted_at IS NULL`。不动 agent。

**Tech Stack:** TypeScript / Express / node-pg / vitest（mock pool）。

---

## File Structure

- Create `apps/api/db/migrations/20260626_150000_crm_customers_add_reconcile.sql` — 加两列。
- Modify `apps/api/src/routes/crm.ts` — ingest 对账 + ClawBot/self_name + GET /customers 排除软删。
- Create `apps/api/tests/routes/crm-friend-scan-reconcile.test.ts` — 对账行为单测。
- Create `sprints/06261439-crm-scan-reconcile/cleanup-stale-groups.sql` — 一次性软删旧群（不进 CI）。

---

## Task 1: Migration — 加 deleted_at + scan_miss_count

**Files:**
- Create: `apps/api/db/migrations/20260626_150000_crm_customers_add_reconcile.sql`

- [ ] **Step 1: 写 migration**

```sql
-- Line04 CRM 采集对账 — crm_customers 加软删 + 连续未扫到计数两列
--
-- deleted_at       软删时间戳（可空，NULL=在册）。对账满 K 次未扫到 → now()；扫到即回 NULL 复活。
-- scan_miss_count  连续未被 friend-scan 扫到次数（NOT NULL DEFAULT 0）。扫到即归零。
--
-- 纯 ADD COLUMN IF NOT EXISTS，不动 PK/UNIQUE/外键，无数据迁移，幂等可重入。
ALTER TABLE zenithjoy.crm_customers
  ADD COLUMN IF NOT EXISTS deleted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS scan_miss_count int NOT NULL DEFAULT 0;

COMMENT ON COLUMN zenithjoy.crm_customers.deleted_at IS
  '软删时间戳（对账满 K 次未扫到→now()，扫到→NULL 复活）；GET /customers 排除非空行。';
COMMENT ON COLUMN zenithjoy.crm_customers.scan_miss_count IS
  '连续未被 friend-scan 扫到次数（扫到归零，满 K 触发软删）。';
```

- [ ] **Step 2: 提交**

```bash
git add apps/api/db/migrations/20260626_150000_crm_customers_add_reconcile.sql
git commit -m "feat(line04): migration 给 crm_customers 加 deleted_at+scan_miss_count"
```

---

## Task 2: 失败测试 — 对账 / ClawBot / self_name / 软删排除

**Files:**
- Create: `apps/api/tests/routes/crm-friend-scan-reconcile.test.ts`

- [ ] **Step 1: 写失败测试**（复用 trigger 测试的 mock-pool 模式）

```typescript
/**
 * crm friend-scan ingest 对账 + ClawBot 默认黑名单 + self_name 跳过 + GET 排除软删（mock pool）。
 * 端到端真删由 staging 手验（CRM_RECONCILE_DRYRUN=false 跑 force-scan）覆盖。
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockQuery, mockConnect, mockValidateLicense } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConnect: vi.fn(),
  mockValidateLicense: vi.fn(),
}));
vi.mock('../../src/db/connection', () => ({
  default: { query: mockQuery, connect: mockConnect, end: vi.fn() },
}));
vi.mock('../../src/services/walking-skeleton.service', () => ({
  validateLicense: mockValidateLicense,
}));

const TENANT_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const CS = 'wx_cs_unit';
const ADMIN_EMAIL = 'boss@unit.test';
let app: express.Application;
const OLD_TOKEN = process.env.ZENITHJOY_INTERNAL_TOKEN;
const OLD_EMAILS = process.env.ADMIN_EMAILS;
const OLD_DRYRUN = process.env.CRM_RECONCILE_DRYRUN;

beforeAll(async () => {
  delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  const { default: crmRouter } = await import('../../src/routes/crm');
  app = express();
  app.use(express.json());
  app.use('/api/crm', crmRouter);
});
afterAll(() => {
  if (OLD_TOKEN === undefined) delete process.env.ZENITHJOY_INTERNAL_TOKEN; else process.env.ZENITHJOY_INTERNAL_TOKEN = OLD_TOKEN;
  if (OLD_EMAILS === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = OLD_EMAILS;
  if (OLD_DRYRUN === undefined) delete process.env.CRM_RECONCILE_DRYRUN; else process.env.CRM_RECONCILE_DRYRUN = OLD_DRYRUN;
});
beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  mockValidateLicense.mockReset();
  delete process.env.CRM_RECONCILE_DRYRUN; // 默认干跑
});

/** 建一个事务 client：BEGIN / 每 contact upsert / 对账 UPDATE / onboarding / COMMIT。
 *  upsertCount = 本次 contact 行数；reconcileRows = 对账 UPDATE 的 RETURNING 行。 */
function mockTxClient(upsertCount: number, reconcileRows: Array<Record<string, unknown>> = []) {
  const clientQuery = vi.fn();
  clientQuery.mockResolvedValueOnce({}); // BEGIN
  for (let i = 0; i < upsertCount; i++) clientQuery.mockResolvedValueOnce({ rows: [{ inserted: true }], rowCount: 1 });
  clientQuery.mockResolvedValueOnce({}); // onboarding upsert
  clientQuery.mockResolvedValueOnce({ rows: reconcileRows, rowCount: reconcileRows.length }); // 对账 UPDATE（onboarding 之后）
  clientQuery.mockResolvedValueOnce({}); // COMMIT
  mockConnect.mockResolvedValueOnce({ query: clientQuery, release: vi.fn() });
  return clientQuery;
}
function ingest(body: unknown) {
  return request(app).post('/api/crm/friend-scan/ingest').set('X-User-Email', ADMIN_EMAIL).send(body as object);
}
function reconcileCall(clientQuery: ReturnType<typeof vi.fn>) {
  return clientQuery.mock.calls.find(
    (c) => typeof c[0] === 'string' && c[0].includes('scan_miss_count = scan_miss_count + 1'),
  );
}

describe('ingest 对账', () => {
  it('非空扫描 → 跑对账 UPDATE，带 present 名单/dryrun/K 参数', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 }); // resolve tenant
    const cq = mockTxClient(1, []);
    const res = await ingest({ cs_wechat_id: CS, contacts: [{ name: '甲' }] });
    expect(res.status).toBe(200);
    const call = reconcileCall(cq);
    expect(call).toBeDefined();
    expect(call?.[0]).toContain("source = 'scan'");
    expect(call?.[0]).toContain('deleted_at IS NULL');
    expect(call?.[0]).toContain('contact <> ALL');
    // 参数：present 名单含 '甲'，dryrun=true（默认），K=3
    const params = call?.[1] as unknown[];
    expect(params).toContain(true); // dryrun
    expect(params).toContain(3); // K
    expect(JSON.stringify(params)).toContain('甲');
  });

  it('空扫描 contacts:[] → 不跑对账（避免误删全部）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });
    const cq = mockTxClient(0, []);
    const res = await ingest({ cs_wechat_id: CS, contacts: [] });
    expect(res.status).toBe(200);
    expect(res.body.scanned_count).toBe(0);
    expect(reconcileCall(cq)).toBeUndefined();
  });

  it('真模式 CRM_RECONCILE_DRYRUN=false → 对账 SQL 含 now() 满 K 软删，参数 dryrun=false', async () => {
    process.env.CRM_RECONCILE_DRYRUN = 'false';
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });
    const cq = mockTxClient(1, [{ contact: '旧群', scan_miss_count: 3, deleted_at: '2026-06-26T00:00:00Z' }]);
    const res = await ingest({ cs_wechat_id: CS, contacts: [{ name: '甲' }] });
    expect(res.status).toBe(200);
    const call = reconcileCall(cq);
    expect(call?.[0]).toContain('now()');
    expect(call?.[0]).toContain('>=');
    expect((call?.[1] as unknown[])).toContain(false); // dryrun=false
  });
});

describe('ClawBot 默认黑名单 + self_name 跳过', () => {
  it('contact=微信ClawBot → INSERT 带 identity，值为 blacklist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });
    const cq = mockTxClient(1, []);
    await ingest({ cs_wechat_id: CS, contacts: [{ name: '微信ClawBot' }] });
    const upsert = cq.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO zenithjoy.crm_customers'));
    expect(upsert?.[0]).toContain('identity');
    expect(upsert?.[1] as unknown[]).toContain('blacklist');
  });

  it('普通 contact → INSERT identity 参数为 customer', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });
    const cq = mockTxClient(1, []);
    await ingest({ cs_wechat_id: CS, contacts: [{ name: '甲' }] });
    const upsert = cq.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO zenithjoy.crm_customers'));
    expect(upsert?.[1] as unknown[]).toContain('customer');
  });

  it('self_name 与某 contact 同名 → 该 contact 不入册（ingested 不计它）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });
    const cq = mockTxClient(1, []); // 只剩 1 个真 contact 被 upsert
    const res = await ingest({ cs_wechat_id: CS, self_name: '徐先生企业自媒体-Ai助力', contacts: [{ name: '甲' }, { name: '徐先生企业自媒体-Ai助力' }] });
    expect(res.status).toBe(200);
    expect(res.body.ingested).toBe(1);
    // 只有 '甲' 进了 upsert
    const upserts = cq.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO zenithjoy.crm_customers'));
    expect(upserts.length).toBe(1);
    expect(JSON.stringify(upserts[0]?.[1])).toContain('甲');
    expect(JSON.stringify(upserts[0]?.[1])).not.toContain('Ai助力');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run tests/routes/crm-friend-scan-reconcile.test.ts`
Expected: FAIL（对账 UPDATE 不存在 / identity 未带 / self_name 未跳过）

- [ ] **Step 3: 提交失败测试**

```bash
git add apps/api/tests/routes/crm-friend-scan-reconcile.test.ts
git commit -m "test(line04): CRM 采集对账+ClawBot+self_name 失败测试（先红）"
```

---

## Task 3: 实现 — ingest 对账 + ClawBot + self_name + GET 排除软删

**Files:**
- Modify: `apps/api/src/routes/crm.ts`

- [ ] **Step 1: 顶部加常量**（紧跟 `const VALID_IDENTITY = ...` 那一行之后）

```typescript
// 对账参数：连续 K 次没扫到才软删；默认干跑（只日志不写 deleted_at），仅 env 字面 'false' 进真模式。
const RECONCILE_K = 3;
// 已知非客户系统/机器人会话，扫到默认标黑名单（不覆盖人工已设 identity）。
const DEFAULT_BLACKLIST_NAMES = new Set(['微信ClawBot']);
```

- [ ] **Step 2: ingest 预处理加 self 跳过 + 入参**

在 `const csWechatId = (body.cs_wechat_id ?? '').trim();` 之后加：
```typescript
const selfName = typeof (body as { self_name?: unknown }).self_name === 'string'
  ? ((body as { self_name?: string }).self_name ?? '').trim() : '';
```
并在 body 类型里加 `self_name?: string;`（与 cs_wechat_id 同级）。

去重循环里，`if (!name || seen.has(name)) continue;` 改成：
```typescript
if (!name || seen.has(name)) continue;
if (selfName && name === selfName) continue; // self 跳过：运营本人会话不入册
```

- [ ] **Step 3: upsert 加 identity 列（ClawBot 默认黑名单）+ 复活归零**

把现有 upsert（`INSERT INTO zenithjoy.crm_customers ... RETURNING (xmax = 0) AS inserted`）替换为：
```typescript
      const identityVal = DEFAULT_BLACKLIST_NAMES.has(r.name) ? 'blacklist' : 'customer';
      const up = await client.query(
        `INSERT INTO zenithjoy.crm_customers
           (tenant_id, cs_wechat_id, contact, source, last_message, last_seen_at, wechat_id, add_friend_time, identity, updated_at)
         VALUES ($1::uuid, $2, $3, 'scan', $4, $5, $6, $7, $8, now())
         ON CONFLICT (tenant_id, cs_wechat_id, contact) DO UPDATE
           SET last_message = COALESCE(EXCLUDED.last_message, zenithjoy.crm_customers.last_message),
               last_seen_at = COALESCE(EXCLUDED.last_seen_at, zenithjoy.crm_customers.last_seen_at),
               wechat_id = COALESCE(EXCLUDED.wechat_id, zenithjoy.crm_customers.wechat_id),
               add_friend_time = COALESCE(EXCLUDED.add_friend_time, zenithjoy.crm_customers.add_friend_time),
               scan_miss_count = 0,
               deleted_at = NULL,
               updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [tenantId, csWechatId, r.name, r.last_message, r.last_seen, r.wechat_id, r.add_friend_time, identityVal],
      );
```
> 注：ON CONFLICT 不动 identity（保护人工已设）；扫到即 `scan_miss_count=0 + deleted_at=NULL` 复活归零。

- [ ] **Step 4: onboarding upsert 之后、COMMIT 之前加对账 UPDATE**

在 onboarding 的 `await client.query(...)`（写 crm_onboarding_state 那段）之后、`await client.query('COMMIT');` 之前插入：
```typescript
    // 对账：本次没扫到的 source='scan' 行累计 miss；满 K 软删。
    // 放 onboarding 之后、COMMIT 之前（同事务原子）。空扫描（rows.length===0）整体跳过——
    // agent 扫一半失败返回 0 人时绝不把全部 scan 行记 miss（连续失败会误删全部）。
    const reconcileDryRun = process.env.CRM_RECONCILE_DRYRUN !== 'false';
    if (rows.length > 0) {
      const presentNames = rows.map((r) => r.name);
      const rec = await client.query(
        `UPDATE zenithjoy.crm_customers
            SET scan_miss_count = scan_miss_count + 1,
                deleted_at = CASE
                  WHEN $4::boolean THEN deleted_at
                  WHEN scan_miss_count + 1 >= $5 THEN now()
                  ELSE deleted_at END
          WHERE tenant_id = $1::uuid AND cs_wechat_id = $2
            AND source = 'scan' AND deleted_at IS NULL
            AND contact <> ALL($3::text[])
          RETURNING contact, scan_miss_count, deleted_at`,
        [tenantId, csWechatId, presentNames, reconcileDryRun, RECONCILE_K],
      );
      for (const row of rec.rows ?? []) {
        const miss = Number(row.scan_miss_count);
        if (reconcileDryRun && miss >= RECONCILE_K) {
          console.warn(`[reconcile-dryrun] cs=${csWechatId} 本应软删 contact=${row.contact} (miss=${miss})`);
        } else if (!reconcileDryRun && row.deleted_at) {
          console.info(`[reconcile] cs=${csWechatId} 软删 contact=${row.contact} (miss=${miss})`);
        }
      }
    }
```

- [ ] **Step 5: GET /customers 排除软删**

把客户名册查询的 WHERE（`WHERE tenant_id = $1::uuid AND identity <> 'internal'${csWhere}`）改成：
```typescript
        WHERE tenant_id = $1::uuid AND identity <> 'internal' AND deleted_at IS NULL${csWhere}
```

- [ ] **Step 6: 跑新测试 + 全 crm 测试**

Run: `cd apps/api && npx vitest run tests/routes/crm-friend-scan-reconcile.test.ts tests/routes/crm-friend-scan-trigger.test.ts tests/routes/crm.test.ts tests/routes/crm-table-identity.test.ts src/services/crm/customer-roster.test.ts`
Expected: 全 PASS。若 customer-roster/crm 测试有断言 GET WHERE 文本 → 同步更新断言含 `deleted_at IS NULL`。

- [ ] **Step 7: 提交实现**

```bash
git add apps/api/src/routes/crm.ts
git commit -m "feat(line04): CRM ingest 对账（软删+连续K=3+默认干跑+空扫描跳过）+ClawBot默认黑名单+self_name跳过+GET排除软删"
```

---

## Task 4: 清存量 SQL（一次性，不进 CI）

**Files:**
- Create: `sprints/06261439-crm-scan-reconcile/cleanup-stale-groups.sql`

- [ ] **Step 1: 写软删 SQL**

```sql
-- 一次性：软删 staging zenithjoy_test 里修复前扫进的旧群条目（可恢复，不物理删）。
-- 旧群命名特征：客户名后缀「、徐先生企业自媒体-Ai助力」或「悦升云端群」等。
-- 执行前先 SELECT 核对命中行，确认无误再 UPDATE。
-- SELECT 核对：
--   SELECT contact FROM zenithjoy.crm_customers
--    WHERE source='scan' AND deleted_at IS NULL
--      AND (contact LIKE '%、%' OR contact LIKE '%群%');
UPDATE zenithjoy.crm_customers
   SET deleted_at = now(), updated_at = now()
 WHERE source = 'scan'
   AND deleted_at IS NULL
   AND (contact LIKE '%、徐先生企业自媒体-Ai助力%' OR contact LIKE '%悦升云端群%');
```

- [ ] **Step 2: 提交**

```bash
git add sprints/06261439-crm-scan-reconcile/cleanup-stale-groups.sql
git commit -m "chore(line04): 清 staging 存量旧群一次性软删 SQL"
```

> ⚠️ 此 SQL 不自动跑。staging 验证时手动核对命中行后执行；生产 promote 时由用户决定是否跑。

---

## Self-Review

- **Spec coverage**：migration（Task1）/ 对账软删+K+干跑+空扫描（Task3 Step4）/ ClawBot（Task3 Step3）/ self_name（Task3 Step2）/ GET 排除（Task3 Step5）/ 清 64 群（Task4）/ 测试（Task2）—— 全覆盖。
- **Placeholder**：无 TBD；所有 SQL/TS 为完整可粘贴代码。
- **类型一致**：`scan_miss_count`/`deleted_at`/`RECONCILE_K`/`DEFAULT_BLACKLIST_NAMES`/`reconcileDryRun`/`selfName` 命名前后一致；对账 UPDATE 标识串 `'scan_miss_count = scan_miss_count + 1'` 与测试 `reconcileCall` 匹配。
- **风险**：对账放 onboarding 之后保现有 trigger 测试不破（其事务 mock 序列 BEGIN/upsert/onboarding/COMMIT，多出的对账消费第 4 个 mock、`rec.rows ?? []` 兜底）。Task3 Step6 显式跑 trigger 测试验证不破。
