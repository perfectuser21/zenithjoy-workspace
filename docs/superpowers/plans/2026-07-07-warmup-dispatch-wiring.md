# Line02 warmup 中台调度接线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把已真机跑通的养号验活能力接成"中台每天自动下发→agent逐号养号→结果回传写库→dashboard看活/掉线"。

**Architecture:** 照抄 dm_outreach 往返模板：中台 INSERT publish_tasks(task_type='warmup') 经心跳下发；agent 用 `task.payload["task_type"]=="warmup"` 判别（避开 getQueuedTasks 无 task_type 列的既有断链），调已就绪的 dispatchWarmupTask；结果广播→AgentService POST /api/agent/burner/warmup-result；中台设备级按真实昵称 upsert agent_warmup_liveness；dashboard 标红掉线号。

**Tech Stack:** Kotlin(agent-android) / TypeScript Express(apps/api, vitest) / PostgreSQL(zenithjoy schema) / React TSX(apps/dashboard) / bash smoke。

## Global Constraints
- 判别符走 payload：agent 判 `task.payload["task_type"]=="warmup"`；**不改** walking-skeleton.ts 心跳 type 映射，不碰现有 publish/dm 行为。
- 落库粒度=设备级按真实昵称（绕开 account_label↔昵称无映射）。
- tenant 服务端按 agent_id/task_id 反查，**不信设备上报**（铁律）。
- 幂等：warmup-result 按 task_id，publish_tasks 已 done/failed → 短路。
- error_code 非空（MUTEX_BUSY/超时/profile_unreadable）→ 不 upsert liveness（保留各号上次状态，不误判掉线）。
- per-account 失败隔离（能力层已实现，勿改 DeviceAccountScanService/WarmupPass/Model）。
- 提交只用 `git -C <worktree>`；worktree=/Users/administrator/worktrees/zenithjoy/warmup-dispatch-wiring；分支 push 前时间戳改 8 位。
- feat PR 必须有 smoke.sh 且接进 CI（[CONFIG] 标题改 .yml）。

---

### Task 1: Smoke test（先红，定义"完成"）+ CI 接线

**Files:**
- Create: `.github/workflows/scripts/smoke/warmup-dispatch-smoke.sh`
- Modify: 对应 smoke CI workflow .yml（点名新脚本，[CONFIG] 标题）

**Interfaces:**
- Produces: 端到端验收脚本，断言下发→心跳拉取→回传写库→幂等全链。此时所有端点/表都不存在 → 脚本必失败（定义 done）。

- [ ] **Step 1: 写 smoke.sh**（≥5 行真链路，curl+psql）

```bash
#!/usr/bin/env bash
# warmup 中台调度接线 E2E smoke：下发→心跳→回传→写库→幂等
set -euo pipefail
API="${API_BASE:-http://localhost:5201}"
PSQL="${PSQL:-psql "${DATABASE_URL:-postgres://localhost/zenithjoy_test}"}"
LIC="${SMOKE_LICENSE:-smoke-warmup-lic}"

# 0) 造 tenant/license/android burner agent + 一个 active burner session（幂等 upsert）
$PSQL -v ON_ERROR_STOP=1 <<SQL
INSERT INTO zenithjoy.tenants(id,name) VALUES('t-warmup','warmup smoke') ON CONFLICT DO NOTHING;
INSERT INTO zenithjoy.licenses(id,key,tenant_id) VALUES('l-warmup','${LIC}','t-warmup') ON CONFLICT (key) DO NOTHING;
INSERT INTO zenithjoy.agents(id,tenant_id,agent_id,hostname,status,last_heartbeat_at,capabilities)
  VALUES('a-warmup','t-warmup','a-warmup','honor-smoke','online',now(),'{"device_platform":"android"}')
  ON CONFLICT (id) DO UPDATE SET last_heartbeat_at=now(),status='online';
INSERT INTO zenithjoy.agent_platform_sessions(agent_id,platform,account_label,role,status,bound_at)
  VALUES('a-warmup','douyin','burner1','burner','active',now()) ON CONFLICT DO NOTHING;
DELETE FROM zenithjoy.publish_tasks WHERE agent_id='a-warmup' AND task_type='warmup';
DELETE FROM zenithjoy.agent_warmup_liveness WHERE agent_id='a-warmup';
SQL

# 1) 下发：手动触发 enqueue
curl -fsS -X POST "$API/api/acquisition/warmup/run" -H 'content-type: application/json' \
  -H "x-test-tenant-id: t-warmup" -d '{}' | grep -q '"enqueued"'
# 断言 publish_tasks 出现 task_type='warmup' queued 行
$PSQL -tAc "SELECT count(*) FROM zenithjoy.publish_tasks WHERE agent_id='a-warmup' AND task_type='warmup' AND status='queued'" | grep -q '^1$'
TASK_ID=$($PSQL -tAc "SELECT id FROM zenithjoy.publish_tasks WHERE agent_id='a-warmup' AND task_type='warmup' ORDER BY created_at DESC LIMIT 1")

# 2) 心跳拉取：断言 queued_tasks 含该任务且 payload.task_type='warmup'
curl -fsS -X POST "$API/api/agent/heartbeat" -H "authorization: Bearer ${LIC}" \
  -H 'content-type: application/json' -d '{"agent_id":"a-warmup","hostname":"honor-smoke","version":"1.0.0-android"}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);qs=d['queued_tasks'];assert any(t.get('payload',{}).get('task_type')=='warmup' for t in qs),'no warmup task in heartbeat'"

# 3) 回传：2 号样本(1活1掉线)
curl -fsS -X POST "$API/api/agent/burner/warmup-result" -H 'content-type: application/json' \
  -d "{\"task_id\":\"$TASK_ID\",\"agent_id\":\"a-warmup\",\"device_id\":\"dev-smoke\",\"total\":2,\"alive\":1,\"offline\":1,\"results\":[{\"nickname\":\"大湖成长\",\"alive\":true,\"followers\":1196,\"reason\":\"ok\"},{\"nickname\":\"秦军\",\"alive\":false,\"followers\":null,\"reason\":\"profile_unreadable\"}],\"error_code\":\"\"}" | grep -q '"success":true'
# 断言 agent_warmup_liveness 2 行 + 字段
$PSQL -tAc "SELECT count(*) FROM zenithjoy.agent_warmup_liveness WHERE agent_id='a-warmup'" | grep -q '^2$'
$PSQL -tAc "SELECT followers FROM zenithjoy.agent_warmup_liveness WHERE agent_id='a-warmup' AND nickname='大湖成长'" | grep -q '^1196$'
$PSQL -tAc "SELECT alive FROM zenithjoy.agent_warmup_liveness WHERE agent_id='a-warmup' AND nickname='秦军'" | grep -q '^f$'
$PSQL -tAc "SELECT status FROM zenithjoy.publish_tasks WHERE id='$TASK_ID'" | grep -q '^done$'

# 4) 幂等：重复同 task_id 不新增行
curl -fsS -X POST "$API/api/agent/burner/warmup-result" -H 'content-type: application/json' \
  -d "{\"task_id\":\"$TASK_ID\",\"agent_id\":\"a-warmup\",\"total\":2,\"alive\":1,\"offline\":1,\"results\":[],\"error_code\":\"\"}" >/dev/null
$PSQL -tAc "SELECT count(*) FROM zenithjoy.agent_warmup_liveness WHERE agent_id='a-warmup'" | grep -q '^2$'
echo "✅ warmup-dispatch smoke PASS"
```

- [ ] **Step 2: 接进 CI** — 在跑 smoke 的 workflow .yml 里点名 `warmup-dispatch-smoke.sh`（标题加 `[CONFIG]`）。找现有 `*-smoke.sh` 的调用块照抄一行。
- [ ] **Step 3: 本地跑一次确认失败**（端点/表未建）：`bash .github/workflows/scripts/smoke/warmup-dispatch-smoke.sh` → 预期 FAIL（404 / relation 不存在）。这就是"红"。
- [ ] **Step 4: Commit**（这是 PR 的 commit-1，满足 E2E-first）

```bash
git -C <WT> add .github/workflows/scripts/smoke/warmup-dispatch-smoke.sh .github/workflows/<file>.yml
git -C <WT> commit -m "test(line02): warmup 中台调度接线 E2E smoke（先红）+ CI 接线"
```

---

### Task 2: Migration — agent_warmup_liveness 表

**Files:**
- Create: `apps/api/db/migrations/20260707_120000_agent_warmup_liveness.sql`

**Interfaces:**
- Produces: 表 `zenithjoy.agent_warmup_liveness(id,agent_id,device_id,nickname,alive,followers,reason,checked_at)` UNIQUE(agent_id,nickname)。供 Task 3/6 upsert/查询。

- [ ] **Step 1: 写 migration**

```sql
-- Line02 warmup 验活：设备级按真实昵称落库（account_label↔昵称无映射，故按 nickname）
CREATE TABLE IF NOT EXISTS zenithjoy.agent_warmup_liveness (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   uuid NOT NULL REFERENCES zenithjoy.agents(id),
  device_id  text,
  nickname   text NOT NULL,
  alive      boolean NOT NULL,
  followers  integer,
  reason     text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, nickname)
);
CREATE INDEX IF NOT EXISTS idx_agent_warmup_liveness_agent
  ON zenithjoy.agent_warmup_liveness(agent_id);
COMMENT ON TABLE zenithjoy.agent_warmup_liveness IS
  'Line02 每日养号验活结果，设备级按真实抖音昵称 upsert，每号留最新一次';
```

- [ ] **Step 2: 应用到本地/staging test DB 验证**

Run: `psql "$DATABASE_URL" -f apps/api/db/migrations/20260707_120000_agent_warmup_liveness.sql && psql "$DATABASE_URL" -tAc "\d zenithjoy.agent_warmup_liveness"`
Expected: 表存在，列齐全。

- [ ] **Step 3: Commit**

```bash
git -C <WT> add apps/api/db/migrations/20260707_120000_agent_warmup_liveness.sql
git -C <WT> commit -m "feat(line02): agent_warmup_liveness 表——设备级按真实昵称落验活"
```

---

### Task 3: 中台回传端点 warmup-result + GET warmup-liveness

**Files:**
- Modify: `apps/api/src/routes/agent-burner.ts`（加两个 router 方法，照 dm-outreach-result:470 模式）
- Test: `apps/api/src/routes/agent-burner-warmup.test.ts`

**Interfaces:**
- Consumes: 表 agent_warmup_liveness（Task 2）；pool、ERR/OK helper（同文件）。
- Produces: `POST /api/agent/burner/warmup-result`（body `{task_id,agent_id,device_id,total,alive,offline,results:[{nickname,alive,followers,reason}],error_code}`）；`GET /api/agent/burner/warmup-liveness?agent_id=`（→ `{liveness:[{nickname,alive,followers,reason,checked_at}]}`）。

- [ ] **Step 1: 写失败测试**（mock pool，照 agent-burner.test.ts 范式）

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../db/connection', () => ({ default: { query: vi.fn() } }));
vi.mock('../middleware/tenant-context', () => ({
  tenantContextOptional: (req: any, _r: any, n: any) => { const t=req.headers['x-test-tenant-id']||req.body?.tenant_id; if(t) req.tenantId=t; n(); },
  tenantContext: (req: any, _r: any, n: any) => { const t=req.headers['x-test-tenant-id']; if(t) req.tenantId=t; n(); },
}));
vi.mock('../middleware/agent-context', () => ({ agentContext: (req:any,_r:any,n:any)=>n() }));
import pool from '../db/connection';
import router from './agent-burner';
const app = express(); app.use(express.json()); app.use('/api/agent/burner', router);
const q = pool.query as any;
beforeEach(()=>{ q.mockReset(); });

describe('POST /warmup-result', () => {
  it('error_code 空 → publish_tasks done + 每号 upsert liveness', async () => {
    // 1) SELECT tenant_id,status by task_id  2) UPDATE publish_tasks  3+) upsert liveness×2
    q.mockResolvedValueOnce({ rows: [{ tenant_id: 't1', status: 'queued' }] });
    q.mockResolvedValue({ rows: [], rowCount: 1 });
    const r = await request(app).post('/api/agent/burner/warmup-result').send({
      task_id:'tk1', agent_id:'a1', device_id:'d1', total:2, alive:1, offline:1,
      results:[{nickname:'A',alive:true,followers:1196,reason:'ok'},{nickname:'B',alive:false,followers:null,reason:'x'}],
      error_code:'',
    });
    expect(r.status).toBe(200);
    const sqls = q.mock.calls.map((c:any)=>String(c[0]));
    expect(sqls.some((s:string)=>/INSERT INTO zenithjoy\.agent_warmup_liveness/.test(s))).toBe(true);
    expect(sqls.some((s:string)=>/UPDATE zenithjoy\.publish_tasks/.test(s))).toBe(true);
  });
  it('error_code 非空 → 不 upsert liveness', async () => {
    q.mockResolvedValueOnce({ rows: [{ tenant_id:'t1', status:'queued' }] });
    q.mockResolvedValue({ rows: [], rowCount: 1 });
    const r = await request(app).post('/api/agent/burner/warmup-result').send({
      task_id:'tk1', agent_id:'a1', total:0, alive:0, offline:0, results:[], error_code:'MUTEX_BUSY' });
    expect(r.status).toBe(200);
    const sqls = q.mock.calls.map((c:any)=>String(c[0]));
    expect(sqls.some((s:string)=>/agent_warmup_liveness/.test(s))).toBe(false);
  });
  it('幂等：publish_tasks 已 done → 短路不写', async () => {
    q.mockResolvedValueOnce({ rows: [{ tenant_id:'t1', status:'done' }] });
    const r = await request(app).post('/api/agent/burner/warmup-result').send({ task_id:'tk1', results:[], error_code:'' });
    expect(r.status).toBe(200);
    expect(q.mock.calls.length).toBe(1); // 只有那次 SELECT
  });
  it('task_id 缺失 → 400', async () => {
    const r = await request(app).post('/api/agent/burner/warmup-result').send({});
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run src/routes/agent-burner-warmup.test.ts`
Expected: FAIL（路由未实现）。

- [ ] **Step 3: 实现两个端点**（加在 agent-burner.ts router 里，照 dm-outreach-result 模式）

```ts
// ── warmup 验活结果回传（Line02 每日养号）——tenant 服务端按 task_id 反查，幂等按 publish_tasks 状态 ──
router.post('/warmup-result', async (req: Request, res: Response) => {
  const { task_id, device_id, total, alive, offline, results, error_code } = req.body || {};
  if (!task_id) return res.status(400).json(ERR('MISSING_TASK_ID', 'task_id 必填'));
  const t = await pool.query(`SELECT tenant_id, status FROM zenithjoy.publish_tasks WHERE id=$1`, [task_id]);
  if (t.rows.length === 0) return res.status(404).json(ERR('TASK_NOT_FOUND', 'task_id 未找到'));
  const agentRow = await pool.query(`SELECT agent_id FROM zenithjoy.publish_tasks WHERE id=$1`, [task_id]);
  const agentId = agentRow.rows[0]?.agent_id;
  const curStatus: string = t.rows[0].status;
  // 幂等：已终态 → 短路
  if (curStatus === 'done' || curStatus === 'failed') return res.json(OK({ idempotent: true }));

  const errCode: string = typeof error_code === 'string' ? error_code : '';
  const report = { total, alive, offline, results, error_code: errCode };
  const taskStatus = errCode ? 'failed' : 'done';
  await pool.query(
    `UPDATE zenithjoy.publish_tasks SET status=$2, response=$3::jsonb, updated_at=NOW() WHERE id=$1`,
    [task_id, taskStatus, JSON.stringify(report)],
  );
  // error_code 非空 → 保留各号上次状态，不 upsert（不误判掉线）
  if (!errCode && Array.isArray(results)) {
    for (const r of results) {
      if (!r || typeof r.nickname !== 'string' || !r.nickname) continue;
      await pool.query(
        `INSERT INTO zenithjoy.agent_warmup_liveness (agent_id, device_id, nickname, alive, followers, reason, checked_at)
         VALUES ($1,$2,$3,$4,$5,$6, now())
         ON CONFLICT (agent_id, nickname) DO UPDATE
           SET alive=EXCLUDED.alive, followers=EXCLUDED.followers, reason=EXCLUDED.reason,
               device_id=EXCLUDED.device_id, checked_at=now()`,
        [agentId, device_id ?? null, r.nickname, !!r.alive,
         (r.followers ?? null), (typeof r.reason === 'string' ? r.reason : null)],
      );
    }
  }
  return res.json(OK({ task_status: taskStatus, written: errCode ? 0 : (Array.isArray(results) ? results.length : 0) }));
});

// ── warmup 验活状态查询（dashboard）——最近每号 ──
router.get('/warmup-liveness', async (req: Request, res: Response) => {
  const agentId = String(req.query.agent_id || '');
  if (!agentId) return res.status(400).json(ERR('MISSING_AGENT_ID', 'agent_id 必填'));
  const r = await pool.query(
    `SELECT nickname, alive, followers, reason, checked_at
       FROM zenithjoy.agent_warmup_liveness WHERE agent_id=$1 ORDER BY checked_at DESC`, [agentId]);
  return res.json(OK({ liveness: r.rows }));
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run src/routes/agent-burner-warmup.test.ts`
Expected: PASS（4 测试）。

- [ ] **Step 5: Commit**

```bash
git -C <WT> add apps/api/src/routes/agent-burner.ts apps/api/src/routes/agent-burner-warmup.test.ts
git -C <WT> commit -m "feat(line02): warmup-result 回传端点+warmup-liveness 查询——设备级按真实昵称写库"
```

---

### Task 4: 中台下发 — enqueueWarmupTasks + POST /warmup/run + 每日 cron

**Files:**
- Create: `apps/api/src/services/warmup-dispatch.ts`
- Modify: `apps/api/src/routes/acquisition-dispatch.ts`（加 `POST /warmup/run`）
- Modify: `apps/api/src/services/scheduler.ts`（加每日 warmup tick）
- Test: `apps/api/src/services/warmup-dispatch.test.ts`

**Interfaces:**
- Consumes: publish_tasks / agents / agent_platform_sessions。
- Produces: `enqueueWarmupTasks(): Promise<{enqueued:number}>`；`POST /api/acquisition/warmup/run` → `{enqueued}`。

- [ ] **Step 1: 写失败测试**（mock pool）

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../db/connection', () => ({ default: { query: vi.fn() } }));
import pool from '../db/connection';
import { enqueueWarmupTasks } from './warmup-dispatch';
const q = pool.query as any;
beforeEach(()=>q.mockReset());

describe('enqueueWarmupTasks', () => {
  it('在线 android burner agent 无 pending warmup → INSERT 一条', async () => {
    q.mockResolvedValueOnce({ rows: [{ agent_id:'a1', tenant_id:'t1', operator_nickname:'秦军' }] }); // 候选 agent
    q.mockResolvedValueOnce({ rows: [{ n: 0 }] }); // 24h 去重检查 = 0
    q.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT
    const r = await enqueueWarmupTasks();
    expect(r.enqueued).toBe(1);
    const insert = q.mock.calls.map((c:any)=>String(c[0])).find((s:string)=>/INSERT INTO zenithjoy\.publish_tasks/.test(s));
    expect(insert).toMatch(/'warmup'/);
  });
  it('已有 pending/24h warmup → 跳过', async () => {
    q.mockResolvedValueOnce({ rows: [{ agent_id:'a1', tenant_id:'t1', operator_nickname:'秦军' }] });
    q.mockResolvedValueOnce({ rows: [{ n: 1 }] }); // 已有
    const r = await enqueueWarmupTasks();
    expect(r.enqueued).toBe(0);
  });
});
```

- [ ] **Step 2: 跑确认失败** — `cd apps/api && npx vitest run src/services/warmup-dispatch.test.ts` → FAIL。

- [ ] **Step 3: 实现 warmup-dispatch.ts**

```ts
import pool from '../db/connection';

// 候选：有 ≥1 active douyin burner session 且在线(心跳<2min)的 android agent；
// operator_nickname = 该 agent role='main' douyin session 最近 account_nickname（无则空）。
const CANDIDATE_SQL = `
  SELECT DISTINCT a.id AS agent_id, a.tenant_id,
    COALESCE((SELECT pt.response->>'account_nickname' FROM zenithjoy.publish_tasks pt
       JOIN zenithjoy.agent_platform_sessions ms ON ms.agent_id=a.id AND ms.role='main' AND ms.platform='douyin'
       WHERE pt.agent_id=a.id AND pt.task_type='qr_bind/douyin_burner'
       ORDER BY pt.created_at DESC LIMIT 1), '') AS operator_nickname
  FROM zenithjoy.agents a
  JOIN zenithjoy.agent_platform_sessions s
    ON s.agent_id=a.id AND s.role='burner' AND s.platform='douyin' AND s.status='active'
  WHERE a.last_heartbeat_at > now() - interval '2 minutes'
    AND a.capabilities->>'device_platform' = 'android'`;

export async function enqueueWarmupTasks(): Promise<{ enqueued: number }> {
  const cands = await pool.query(CANDIDATE_SQL);
  let enqueued = 0;
  for (const c of cands.rows) {
    const dup = await pool.query(
      `SELECT count(*)::int AS n FROM zenithjoy.publish_tasks
        WHERE agent_id=$1 AND task_type='warmup'
          AND (status IN ('pending','queued','dispatched') OR updated_at > now() - interval '24 hours')`,
      [c.agent_id]);
    if ((dup.rows[0]?.n ?? 0) > 0) continue;
    await pool.query(
      `INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status, task_type, payload, tenant_id, created_at, updated_at)
       VALUES ($1, 'douyin', 'queued', 'warmup', $2::jsonb, $3, now(), now())`,
      [c.agent_id, JSON.stringify({ task_type: 'warmup', operator_nickname: c.operator_nickname || '' }), c.tenant_id]);
    enqueued += 1;
  }
  return { enqueued };
}
```

- [ ] **Step 4: 加路由**（acquisition-dispatch.ts，照 `/dispatch/run` 模式）

```ts
import { enqueueWarmupTasks } from '../services/warmup-dispatch';
// ...
router.post('/warmup/run', async (_req, res) => {
  try { const r = await enqueueWarmupTasks(); return res.json({ success: true, data: r }); }
  catch (e) { return res.status(500).json({ success: false, error: { code: 'WARMUP_ENQUEUE_FAILED', message: e instanceof Error ? e.message : 'x' } }); }
});
```

- [ ] **Step 5: 加每日 cron**（scheduler.ts：加一个北京时间 10:00 tick 调 enqueueWarmupTasks；照现有 09:00/23:55 tick 的 beijingNowParts 判定 + lastFired 防抖）。在 SchedulerHandle 加 `lastWarmupYmd`，loop 里判 `hour===10 && minute===0 && lastWarmupYmd!==ymd` → `await enqueueWarmupTasks(); handle.lastWarmupYmd=ymd`。

- [ ] **Step 6: 跑测试确认通过** — `cd apps/api && npx vitest run src/services/warmup-dispatch.test.ts` → PASS。

- [ ] **Step 7: Commit**

```bash
git -C <WT> add apps/api/src/services/warmup-dispatch.ts apps/api/src/services/warmup-dispatch.test.ts apps/api/src/routes/acquisition-dispatch.ts apps/api/src/services/scheduler.ts
git -C <WT> commit -m "feat(line02): warmup 每日下发——enqueueWarmupTasks+/warmup/run+cron，24h 去重"
```

---

### Task 5: Agent — warmup 任务接收 + 结果回传

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AgentServiceWarmupTest.kt`

**Interfaces:**
- Consumes: `DeviceAccountScanService.dispatchWarmupTask/ACTION_ACCOUNT_WARMUP_RESULT/EXTRA_*`（已就绪）。
- Produces: onTask payload.task_type=='warmup' → dispatchWarmupTask；warmupResultReceiver → POST /api/agent/burner/warmup-result。

- [ ] **Step 1: 写失败测试**（纯 JVM，照 AgentServiceDispatchGuardTest 模式——测判别函数，不起 Android）。抽一个纯函数 `AgentService.parseWarmupResultBody(requestId, deviceId, agentId, total, alive, offline, resultsJson, errorCode): String` 返回 POST body JSON，单测断言字段。以及一个 `shouldRouteWarmup(payloadTaskType): Boolean`。

```kotlin
package com.zenithjoy.agent
import org.junit.Assert.*
import org.junit.Test
class AgentServiceWarmupTest {
  @Test fun routes_on_payload_task_type_warmup() {
    assertTrue(AgentService.shouldRouteWarmup("warmup"))
    assertFalse(AgentService.shouldRouteWarmup("dm_outreach"))
    assertFalse(AgentService.shouldRouteWarmup(null))
  }
  @Test fun builds_warmup_result_body() {
    val body = AgentService.parseWarmupResultBody("r1","dev1","a1",2,1,1,
      "[{\"nickname\":\"A\",\"alive\":true,\"followers\":1196,\"reason\":\"ok\"}]","")
    assertTrue(body.contains("\"task_id\":\"r1\""))
    assertTrue(body.contains("\"agent_id\":\"a1\""))
    assertTrue(body.contains("\"total\":2"))
    assertTrue(body.contains("\"nickname\":\"A\""))
  }
}
```

- [ ] **Step 2: 跑确认失败** — `cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*AgentServiceWarmupTest*"` → FAIL（函数未定义）。

- [ ] **Step 3: 实现**：
  - Companion 加纯函数 `shouldRouteWarmup(payloadTaskType: String?) = payloadTaskType == "warmup"` 和 `parseWarmupResultBody(...)`（用 org.json 组 body：task_id/agent_id/device_id/total/alive/offline/results(原样嵌入 resultsJson 数组)/error_code）。
  - onTask 里最前加：`val ptt = task.payload["task_type"] as? String; if (shouldRouteWarmup(ptt)) { val op = task.payload["operator_nickname"] as? String ?: ""; DeviceAccountScanService.dispatchWarmupTask(this@AgentService, task.task_id, config.machineId, op); return@... }`（放在 platform=="android_douyin" 分支之前；warmup INSERT platform='douyin' 不撞 keyword 分支，但显式前置更稳）。
  - 加 `warmupResultReceiver`（照 accountScanResultReceiver）：收 `ACTION_ACCOUNT_WARMUP_RESULT` → 取 EXTRA_REQUEST_ID/EXTRA_DEVICE_ID/EXTRA_WARMUP_TOTAL/ALIVE/OFFLINE/RESULTS/ERROR → `scope.launch { reportWarmupResult(...) }`。onCreate register / onDestroy unregister。
  - `reportWarmupResult(...)`：POST `${config.deriveHttpBase()}/api/agent/burner/warmup-result`，body=parseWarmupResultBody(...)（含 config.agentId）。照 reportDmOutreachResult 的 OkHttp 写法。

- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 命令 → PASS。

- [ ] **Step 5: bump agent 版本**（改 Agent 源码必须同步 bump，见铁律）：AgentConfig.AGENT_VERSION 或对应 build.gradle versionCode/Name +1。

- [ ] **Step 6: Commit**

```bash
git -C <WT> add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AgentServiceWarmupTest.kt services/agent-android/app/build.gradle.kts
git -C <WT> commit -m "feat(line02): agent 接收 warmup 任务(payload判别)+结果回传中台"
```

---

### Task 6: Dashboard — warmup 验活展示 + 掉线标红

**Files:**
- Modify: `apps/dashboard/src/api/machines.api.ts`（加 `fetchWarmupLiveness(agentId)`）
- Modify: `apps/dashboard/src/pages/AcquisitionAccountsPage.tsx`（加验活区）
- Test: `apps/dashboard/src/pages/AcquisitionAccountsPage.warmup.test.tsx`（或 e2e spec）

**Interfaces:**
- Consumes: `GET /api/agent/burner/warmup-liveness?agent_id=`。
- Produces: 每 agent 一个"验活状态"面板，按真实昵称列 alive/followers/checked_at，掉线 alive=false 标红。

- [ ] **Step 1: 写失败测试**（组件渲染，vitest + @testing-library/react；mock fetch 返回 1 活 1 掉线 → 断言掉线行有红色 class / "掉线" 文案，粉丝数展示）。

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import WarmupLivenessPanel from './AcquisitionAccountsPage'; // 或抽出的子组件
// mock fetch → { data:{ liveness:[{nickname:'大湖',alive:true,followers:1196,...},{nickname:'秦军',alive:false,followers:null,reason:'x'}] } }
it('掉线号标红 + 粉丝展示', async () => {
  // ...render WarmupLivenessPanel agentId="a1"
  await waitFor(()=>expect(screen.getByText('大湖')).toBeInTheDocument());
  expect(screen.getByText('1196')).toBeInTheDocument();
  const offline = screen.getByText('秦军').closest('[data-alive]');
  expect(offline?.getAttribute('data-alive')).toBe('false');
});
```

- [ ] **Step 2: 跑确认失败** — `cd apps/dashboard && npx vitest run src/pages/AcquisitionAccountsPage.warmup.test.tsx` → FAIL。

- [ ] **Step 3: 实现**：machines.api.ts 加 `fetchWarmupLiveness`；抽一个 `WarmupLivenessPanel({agentId})` 子组件 fetch + 渲染每号（`data-alive` 属性 + alive=false 用红色 class/"🔴 掉线"，alive=true "✅ 在线"，followers 与 checked_at 展示）；在 AcquisitionAccountsPage 每个绑定机器/agent 下挂该面板。

- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 → PASS。

- [ ] **Step 5: Commit**

```bash
git -C <WT> add apps/dashboard/src/api/machines.api.ts apps/dashboard/src/pages/AcquisitionAccountsPage.tsx apps/dashboard/src/pages/AcquisitionAccountsPage.warmup.test.tsx
git -C <WT> commit -m "feat(line02): dashboard 验活状态展示——每号活/掉线标红+粉丝+验活时间"
```

---

### Task 7: 全链验证 + smoke 转绿

- [ ] **Step 1:** 本地起 api(:5201, zenithjoy_test) → `bash .github/workflows/scripts/smoke/warmup-dispatch-smoke.sh` → 预期 PASS。
- [ ] **Step 2:** `cd apps/api && npx vitest run`（全绿）；`cd apps/dashboard && npx vitest run`；`cd services/agent-android && ./gradlew :app:testDebugUnitTest`。
- [ ] **Step 3:** lint/typecheck（各 workspace）。
- [ ] **Step 4:** 进 code-review-gate（/dev Stage 2）。真机端到端 staging 为 PR 后发版验收（见设计文档"真机端到端"）。

## Self-Review
- **Spec 覆盖**：下发(Task4)/接收触发(Task5)/回传(Task5)/写库(Task2+3)/展示(Task6)/smoke(Task1)/真机(Task7 note) 全覆盖。
- **判别符**：全程 payload.task_type=='warmup'，与 Global Constraints 一致。
- **类型一致**：enqueueWarmupTasks→{enqueued}；warmup-result body 字段 task_id/agent_id/device_id/total/alive/offline/results/error_code 在 Task1/3/5 一致；agent_warmup_liveness 列在 Task2/3/6 一致。
- **落库粒度**：agent_warmup_liveness 按 nickname，全 Task 一致。
