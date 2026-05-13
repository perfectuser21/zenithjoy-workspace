# Path 4 Sprint 1 WS1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 为 Path 4 (客户私域 AI 接管) Sprint 1 立基础设施层骨架 — 2 migration + OpenRouter 封装 + 3 zod route + Agent wechat-rpa handler 框架 + rog 部署脚本, 6 ARTIFACT + 8 BEHAVIOR DoD 全绿。

**Architecture:** 后端层 (`apps/api`) 新增 LLM 封装 + 路由 + 2 表; Agent 层 (`services/agent`) 新增 handler 框架 (本 WS 只跑 dryrun, 真 Python 路径在 WS3/4 接); 测试层 `tests/ws1/` 覆盖 E2E + integration + unit; smoke `golden-path-4-smoke.sh` 起步覆盖 step 1 部分。

**Tech Stack:** PostgreSQL migration, Express + zod, Node 20 `child_process.spawn`, OpenRouter REST API (deepseek-chat), vitest, bash smoke.

**Branch:** `cp-0513220500-path4-sprint-1-ws1`
**Worktree:** `/Users/administrator/worktrees/zenithjoy/path4-sprint-1-ws1-2`
**Brain task:** `140c8d7b-fbbd-4a5c-9ac7-dd18e6514a80`
**Spec:** `docs/superpowers/specs/2026-05-13-path4-sprint-1-ws1-design.md`
**Harness contract:** `cp-05082012-path4-sprint-1-prd:sprints/sprint-d-path4-private-ai-thin/contract-dod-ws1.md` (APPROVED)

---

## File Structure

| 文件 | 职责 | 行数估 |
|---|---|---|
| `apps/api/db/migrations/20260513_<HHMMSS>_create_wechat_publish_task.sql` | wechat 任务表 + approval_source CHECK | ~40 |
| `apps/api/db/migrations/20260513_<HHMMSS>_create_llm_audit.sql` | LLM 审计表 | ~25 |
| `apps/api/src/llm/openrouter.ts` | callOpenRouter 封装 + FORCE_5XX + CI clamp + llm_audit insert | ~120 |
| `apps/api/src/routes/wechat.ts` | 3 endpoint + zod | ~110 |
| `apps/api/src/app.ts` (modify) | 挂 wechat router | +2 |
| `services/agent/src/handlers/wechat-rpa.ts` | spawn Python + receipt 解析 (dryrun first) | ~90 |
| `services/agent/src/index.ts` (modify) | 注册 wechat-rpa handler | +3 |
| `scripts/deploy-agent-to-rog.sh` | rsync agent → rog | ~30 |
| `scripts/wechat_rpa_dryrun.py` | dryrun Python stub (echo receipt JSON) | ~20 |
| `tests/ws1/db-schema.test.ts` | migration 真跑 + CHECK enforce + llm_audit RW | ~80 |
| `tests/ws1/openrouter-llm.test.ts` | unit (FORCE_5XX/clamp/ignore) + integration (真 HTTP CI=true) | ~100 |
| `tests/ws1/wechat-routes.test.ts` | 3 endpoint zod 400/404 | ~80 |
| `tests/ws1/wechat-rpa-handler.test.ts` | spawn dryrun + receipt | ~70 |
| `.github/workflows/scripts/smoke/golden-path-4-smoke.sh` | E2E step 1 smoke | ~50 |

---

## Task 1: 写全部 fail tests + smoke + 空 skeleton (commit 1)

**核心**: 一次性把所有 test 写够覆盖 8 BEHAVIOR + smoke, 同时 src skeleton 全部空, 让所有 test fail。这是 TDD commit-1 RED。

**Files:**
- Create (test): `tests/ws1/db-schema.test.ts`, `tests/ws1/openrouter-llm.test.ts`, `tests/ws1/wechat-routes.test.ts`, `tests/ws1/wechat-rpa-handler.test.ts`
- Create (smoke): `.github/workflows/scripts/smoke/golden-path-4-smoke.sh`
- Create (empty skeleton src):
  - `apps/api/src/llm/openrouter.ts` — `export async function callOpenRouter(): Promise<never> { throw new Error('not impl'); }`
  - `apps/api/src/routes/wechat.ts` — `import { Router } from 'express'; export const wechatRouter = Router();`
  - `services/agent/src/handlers/wechat-rpa.ts` — `export async function handleWechatRpa(): Promise<never> { throw new Error('not impl'); }`
  - `scripts/deploy-agent-to-rog.sh` — `#!/usr/bin/env bash\nexit 1`
  - `scripts/wechat_rpa_dryrun.py` — `#!/usr/bin/env python3\nimport sys; sys.exit(1)`
- 不动 migration sql (Task 2 才建, tests 跑时检测不存在 = test fail)

- [ ] **Step 1.1: tests/ws1/db-schema.test.ts**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || 'cecelia',
  user: process.env.DATABASE_USER || 'cecelia',
  password: process.env.DATABASE_PASSWORD,
});

describe('WS1 DB schema', () => {
  afterAll(() => pool.end());

  it('wechat_publish_task table exists with approval_source CHECK constraint', async () => {
    const tbl = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name='wechat_publish_task'"
    );
    expect(tbl.rowCount).toBeGreaterThan(0);

    const col = await pool.query(
      "SELECT data_type FROM information_schema.columns WHERE table_name='wechat_publish_task' AND column_name='approval_source'"
    );
    expect(col.rowCount).toBe(1);

    const chk = await pool.query(`
      SELECT con.conname, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname='wechat_publish_task' AND con.contype='c'
    `);
    const hasApprovalCheck = chk.rows.some(
      r => r.def.includes('approval_source') && r.def.includes('feishu_user') && r.def.includes('feishu_api')
    );
    expect(hasApprovalCheck).toBe(true);
  });

  it('INSERT approval_source=system → CHECK violation 23514', async () => {
    let code: string | undefined;
    try {
      await pool.query(`
        INSERT INTO wechat_publish_task
          (id, agent_id, task_type, content, scheduled_at, status, approval_source)
        VALUES
          (gen_random_uuid(), gen_random_uuid(), 'moments', 'test', NOW(), 'draft', 'system')
      `);
    } catch (e: any) {
      code = e.code;
    }
    expect(code).toBe('23514');
  });

  it('llm_audit INSERT/SELECT roundtrip', async () => {
    const id = (await pool.query(`
      INSERT INTO llm_audit (request_purpose, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, duration_ms, success)
      VALUES ('test_purpose', 'deepseek/deepseek-chat', 10, 5, 15, 0.000004, 123, true)
      RETURNING id
    `)).rows[0].id;
    const row = await pool.query('SELECT * FROM llm_audit WHERE id=$1', [id]);
    expect(row.rows[0].request_purpose).toBe('test_purpose');
    expect(row.rows[0].model).toBe('deepseek/deepseek-chat');
    expect(row.rows[0].total_tokens).toBe(15);
    expect(Number(row.rows[0].cost_usd)).toBeCloseTo(0.000004, 6);
    await pool.query('DELETE FROM llm_audit WHERE id=$1', [id]);
  });

  it('migration files exist with required names', () => {
    const dir = 'apps/api/db/migrations';
    const files = fs.readdirSync(dir);
    expect(files.some(f => /^2026.*create_wechat_publish_task.*\.sql$/.test(f))).toBe(true);
    expect(files.some(f => /^2026.*create_llm_audit.*\.sql$/.test(f))).toBe(true);
  });
});
```

- [ ] **Step 1.2: tests/ws1/openrouter-llm.test.ts**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { callOpenRouter } from '../../apps/api/src/llm/openrouter';

const origEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...origEnv };
});

afterEach(() => {
  process.env = { ...origEnv };
});

describe('OpenRouter LLM wrapper', () => {
  it('FORCE_5XX=1 + NODE_ENV=test throws simulated 5xx', async () => {
    process.env.OPENROUTER_FORCE_5XX = '1';
    process.env.NODE_ENV = 'test';
    await expect(callOpenRouter({ prompt: 'hi', purpose: 'unit_test' })).rejects.toThrow(/simulated 5xx/);
  });

  it('FORCE_5XX=1 ignored when NODE_ENV=production', async () => {
    process.env.OPENROUTER_FORCE_5XX = '1';
    process.env.NODE_ENV = 'production';
    // 不抛 simulated 5xx；可能因 no real key throw other error, 但 *不能* throw "simulated 5xx"
    try {
      await callOpenRouter({ prompt: 'hi', purpose: 'unit_test' });
    } catch (e: any) {
      expect(e.message).not.toMatch(/simulated 5xx/);
    }
  });

  it('CI=true clamps max_tokens ≤ 20', async () => {
    process.env.CI = 'true';
    process.env.OPENROUTER_FORCE_5XX = '';
    // 用 spy 捕获实际请求的 max_tokens
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      model: 'deepseek/deepseek-chat',
    }), { status: 200 }));
    process.env.NODE_ENV = 'test';
    process.env.OPENROUTER_FORCE_5XX = '';
    await callOpenRouter({ prompt: 'hi', purpose: 'unit_ci_clamp', maxTokens: 999 });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    expect(body.max_tokens).toBeLessThanOrEqual(20);
    fetchSpy.mockRestore();
  });
});

import { vi } from 'vitest';
```

- [ ] **Step 1.3: tests/ws1/wechat-routes.test.ts**

```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../apps/api/src/app';

describe('WS1 wechat routes', () => {
  it('POST /api/wechat/qr-bind {} → 400 with platform + agent_id zod error', async () => {
    const res = await request(app).post('/api/wechat/qr-bind').send({});
    expect(res.status).toBe(400);
    const body = JSON.stringify(res.body);
    expect(body).toMatch(/platform/);
    expect(body).toMatch(/agent_id/);
  });

  it('GET /api/wechat/draft-review-poll?task_id=<bogus uuid> → 404', async () => {
    const res = await request(app).get('/api/wechat/draft-review-poll?task_id=00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('POST /api/wechat/scheduler-tick reachable (200 or 401, not 404)', async () => {
    const res = await request(app).post('/api/wechat/scheduler-tick').send({});
    expect([200, 400, 401, 403]).toContain(res.status);
  });
});
```

- [ ] **Step 1.4: tests/ws1/wechat-rpa-handler.test.ts**

```typescript
import { describe, it, expect } from 'vitest';
import { handleWechatRpa } from '../../services/agent/src/handlers/wechat-rpa';
import path from 'path';

describe('WS1 wechat-rpa handler', () => {
  it('dryrun qr_bind spawn returns receipt with wechat_id', async () => {
    const result = await handleWechatRpa({
      type: 'wechat_qr_bind',
      payload: { dryrun: true, agent_id: 'test-agent-001' },
      pythonStub: path.resolve(__dirname, '../../scripts/wechat_rpa_dryrun.py'),
    } as any);
    expect(result.ok).toBe(true);
    expect(result.receipt).toBeDefined();
    expect(result.receipt.wechat_id).toMatch(/^mock_wx_/);
  });
});
```

- [ ] **Step 1.5: .github/workflows/scripts/smoke/golden-path-4-smoke.sh**

```bash
#!/usr/bin/env bash
# golden-path-4-smoke.sh
#
# Path 4 (客户私域 AI 接管) E2E smoke。WS1 阶段覆盖 step 1 部分:
#   - migration 真跑 cecelia DB 有 wechat_publish_task + llm_audit 表
#   - curl /api/wechat/qr-bind {} → 400 含 platform/agent_id
#   - dryrun spawn wechat_rpa_dryrun.py → exit 0 + JSON receipt
#
# Step 2-6 在 WS2-6 完后接入。

set -euo pipefail

API="${ZJ_API:-http://localhost:5200}"
DB="${DATABASE_NAME:-cecelia}"
DBUSER="${DATABASE_USER:-cecelia}"
PASS=0; FAIL=0

assert() {
  if [ "$1" = "$2" ]; then echo "  PASS: $3"; PASS=$((PASS+1));
  else echo "  FAIL: $3 (expected $2, got $1)"; FAIL=$((FAIL+1)); fi
}

echo "=== migration table: wechat_publish_task + llm_audit ==="
HAS_WT=$(psql -U "$DBUSER" -d "$DB" -tA -c "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='wechat_publish_task')")
assert "$HAS_WT" "t" "wechat_publish_task 存在"
HAS_LA=$(psql -U "$DBUSER" -d "$DB" -tA -c "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='llm_audit')")
assert "$HAS_LA" "t" "llm_audit 存在"

echo ""
echo "=== route: POST /api/wechat/qr-bind {} → 400 ==="
HTTP=$(curl -s -o /tmp/zj-qr.json -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$API/api/wechat/qr-bind")
assert "$HTTP" "400" "qr-bind {} 400"
grep -qE '"platform"|platform' /tmp/zj-qr.json && echo "  PASS: body 含 platform" && PASS=$((PASS+1)) || { echo "  FAIL: body 不含 platform"; FAIL=$((FAIL+1)); }
grep -qE '"agent_id"|agent_id' /tmp/zj-qr.json && echo "  PASS: body 含 agent_id" && PASS=$((PASS+1)) || { echo "  FAIL: body 不含 agent_id"; FAIL=$((FAIL+1)); }

echo ""
echo "=== dryrun spawn wechat_rpa_dryrun.py ==="
OUT=$(echo '{"dryrun":true,"agent_id":"smoke-001"}' | python3 scripts/wechat_rpa_dryrun.py 2>&1)
EC=$?
assert "$EC" "0" "dryrun 子进程 exit 0"
echo "$OUT" | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d.get("wechat_id","").startswith("mock_wx_")' 2>/dev/null \
  && { echo "  PASS: receipt 含 wechat_id"; PASS=$((PASS+1)); } \
  || { echo "  FAIL: receipt 不含 wechat_id"; FAIL=$((FAIL+1)); }

echo ""
echo "Smoke: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 1.6: skeleton src 文件 (照下面 5 个一字不差)**

`apps/api/src/llm/openrouter.ts`:
```typescript
export interface CallOpenRouterArgs { prompt: string; purpose: string; maxTokens?: number; }
export interface CallOpenRouterResult { content: string; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; model: string; }
export async function callOpenRouter(_args: CallOpenRouterArgs): Promise<CallOpenRouterResult> {
  throw new Error('callOpenRouter not implemented (skeleton)');
}
```

`apps/api/src/routes/wechat.ts`:
```typescript
import { Router } from 'express';
export const wechatRouter = Router();
```

`services/agent/src/handlers/wechat-rpa.ts`:
```typescript
export interface WechatRpaTask {
  type: 'wechat_qr_bind' | 'wechat_moments_send' | 'wechat_private_chat_send';
  payload: Record<string, unknown>;
  pythonStub?: string;
}
export interface WechatRpaResult { ok: boolean; receipt?: Record<string, unknown>; error?: string; }
export async function handleWechatRpa(_task: WechatRpaTask): Promise<WechatRpaResult> {
  throw new Error('handleWechatRpa not implemented (skeleton)');
}
```

`scripts/deploy-agent-to-rog.sh`:
```bash
#!/usr/bin/env bash
exit 1
```

`scripts/wechat_rpa_dryrun.py`:
```python
#!/usr/bin/env python3
import sys
sys.exit(1)
```

- [ ] **Step 1.7: 跑 vitest 确认全 FAIL + smoke FAIL**

```bash
cd /Users/administrator/worktrees/zenithjoy/path4-sprint-1-ws1-2
cd apps/api && npx vitest run ../../tests/ws1/db-schema.test.ts ../../tests/ws1/openrouter-llm.test.ts ../../tests/ws1/wechat-routes.test.ts 2>&1 | tail -20 || true
cd ../..
cd services/agent && npx vitest run ../../tests/ws1/wechat-rpa-handler.test.ts 2>&1 | tail -10 || true
cd ../..
chmod +x .github/workflows/scripts/smoke/golden-path-4-smoke.sh scripts/deploy-agent-to-rog.sh scripts/wechat_rpa_dryrun.py
bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh 2>&1 | tail -15 || echo "smoke FAIL as expected"
```

Expected: 所有 4 个 test file 含 FAIL; smoke FAIL (table 不存在 + route 404 + dryrun exit 1)。

- [ ] **Step 1.8: Commit 1**

```bash
git add tests/ws1 .github/workflows/scripts/smoke/golden-path-4-smoke.sh \
  apps/api/src/llm/openrouter.ts apps/api/src/routes/wechat.ts \
  services/agent/src/handlers/wechat-rpa.ts \
  scripts/deploy-agent-to-rog.sh scripts/wechat_rpa_dryrun.py
git commit -m "test(p4-ws1): fail tests + smoke + skeleton (TDD commit-1 RED)

4 test files covering 8 BEHAVIOR DoD:
  - db-schema: wechat_publish_task CHECK enforce + llm_audit RW
  - openrouter-llm: FORCE_5XX/ignore/CI clamp
  - wechat-routes: 3 endpoint zod 400/404
  - wechat-rpa-handler: spawn dryrun + receipt
+ golden-path-4-smoke.sh step 1 partial coverage.

Skeleton src 全部空 / throw, tests + smoke 真 FAIL 证明在测东西。

Brain task 140c8d7b-fbbd-4a5c-9ac7-dd18e6514a80
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: 2 个 migration (db-schema test 转 PASS)

**Files:**
- Create: `apps/api/db/migrations/20260513_<HHMMSS>_create_wechat_publish_task.sql`
- Create: `apps/api/db/migrations/20260513_<HHMMSS>_create_llm_audit.sql`

`<HHMMSS>` = 当前时刻 (e.g. `220500`)。两个文件用同一时间戳或递增 1 秒避免冲突。

- [ ] **Step 2.1: 写 wechat_publish_task migration**

```sql
-- 20260513_<HHMMSS>_create_wechat_publish_task.sql
-- Path 4 Sprint 1 WS1 — 个微发布任务表
--
-- approval_source CHECK 约束 enforce A 路线护栏:
--   AI 一律不直接发, 只能 feishu_user (人审) 或 feishu_api (飞书 webhook 自动审).
--   任何 INSERT 'system'/'ai'/etc → 23514 violation.

CREATE TABLE IF NOT EXISTS wechat_publish_task (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN ('moments', 'private_chat')),
  content TEXT NOT NULL,
  target_friend_alias TEXT NULL,  -- private_chat 必填, moments 可空
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'rejected', 'sent', 'failed')),
  approval_source TEXT NOT NULL
    CHECK (approval_source IN ('feishu_user', 'feishu_api')),
  approved_by TEXT NULL,
  approved_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wechat_publish_task_agent_id ON wechat_publish_task(agent_id);
CREATE INDEX IF NOT EXISTS idx_wechat_publish_task_status ON wechat_publish_task(status);
CREATE INDEX IF NOT EXISTS idx_wechat_publish_task_scheduled_at ON wechat_publish_task(scheduled_at);
```

- [ ] **Step 2.2: 写 llm_audit migration**

```sql
-- 20260513_<HHMMSS>_create_llm_audit.sql
-- Path 4 Sprint 1 WS1 — LLM 调用审计表
--
-- 每次 OpenRouter 调用写一行, 留 cost / model / tokens / duration 痕迹便于:
--   - 成本追踪 (CI 测试 + 生产)
--   - 失败重试分析
--   - 模型切换 A/B 评估

CREATE TABLE IF NOT EXISTS llm_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_audit_purpose ON llm_audit(request_purpose);
CREATE INDEX IF NOT EXISTS idx_llm_audit_created_at ON llm_audit(created_at);
```

- [ ] **Step 2.3: 真跑 migration**

```bash
cd /Users/administrator/worktrees/zenithjoy/path4-sprint-1-ws1-2
DATABASE_NAME=cecelia DATABASE_USER=cecelia DATABASE_HOST=localhost DATABASE_PORT=5432 \
  npx ts-node apps/api/db/migrations/run-migration.ts 2>&1 | tail -10
```

Expected: 两个 new migration 文件 applied, 输出 `Applied: 20260513_..._create_wechat_publish_task.sql` 等。

- [ ] **Step 2.4: 跑 db-schema test 转 PASS**

```bash
cd apps/api && DATABASE_NAME=cecelia DATABASE_USER=cecelia npx vitest run ../../tests/ws1/db-schema.test.ts 2>&1 | tail -15
```

Expected: 4 test PASS。

- [ ] **Step 2.5: Commit 2**

```bash
cd /Users/administrator/worktrees/zenithjoy/path4-sprint-1-ws1-2
git add apps/api/db/migrations/20260513_*.sql
git commit -m "feat(p4-ws1): add wechat_publish_task + llm_audit migrations

wechat_publish_task: approval_source CHECK enforce A 路线护栏 (feishu_user|feishu_api),
INSERT 'system' → PG 23514 violation.

llm_audit: cost/model/tokens/duration/error 留痕.

db-schema test 4/4 PASS。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: openrouter.ts (openrouter-llm test 转 PASS)

**Files:**
- Modify: `apps/api/src/llm/openrouter.ts` (完整重写)

- [ ] **Step 3.1: 完整覆盖写 openrouter.ts**

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || 'cecelia',
  user: process.env.DATABASE_USER || 'cecelia',
  password: process.env.DATABASE_PASSWORD,
});

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat';

export interface CallOpenRouterArgs {
  prompt: string;
  purpose: string;
  maxTokens?: number;
  model?: string;
}

export interface CallOpenRouterResult {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model: string;
}

function shouldForce5xx(): boolean {
  return process.env.OPENROUTER_FORCE_5XX === '1'
    && ['test', 'development'].includes(process.env.NODE_ENV || '');
}

function clampMaxTokens(requested: number | undefined): number {
  const base = requested ?? 1000;
  if (process.env.CI === 'true') return Math.min(base, 20);
  return base;
}

async function writeAudit(row: {
  purpose: string; model: string;
  prompt_tokens: number; completion_tokens: number; total_tokens: number;
  cost_usd: number; duration_ms: number; success: boolean; error?: string;
}) {
  try {
    await pool.query(
      `INSERT INTO llm_audit
         (request_purpose, model, prompt_tokens, completion_tokens, total_tokens,
          cost_usd, duration_ms, success, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [row.purpose, row.model, row.prompt_tokens, row.completion_tokens,
       row.total_tokens, row.cost_usd, row.duration_ms, row.success, row.error ?? null]
    );
  } catch (e) {
    console.warn('[openrouter] audit insert failed:', (e as Error).message);
  }
}

// 简单 cost 估算 (deepseek-chat: $0.27/M input, $1.1/M output)
function estimateCost(model: string, pt: number, ct: number): number {
  if (model.includes('deepseek-chat')) {
    return (pt / 1_000_000) * 0.27 + (ct / 1_000_000) * 1.10;
  }
  return 0;
}

export async function callOpenRouter(args: CallOpenRouterArgs): Promise<CallOpenRouterResult> {
  const started = Date.now();
  const model = args.model || DEFAULT_MODEL;
  const maxTokens = clampMaxTokens(args.maxTokens);

  if (shouldForce5xx()) {
    throw new Error('OpenRouter simulated 5xx (force test, NODE_ENV=test|development)');
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  let success = false;
  let errorMessage: string | undefined;
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let content = '';

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: args.prompt }],
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json() as any;
    content = data.choices?.[0]?.message?.content ?? '';
    usage = data.usage ?? usage;
    success = true;
  } catch (e) {
    errorMessage = (e as Error).message;
    throw e;
  } finally {
    await writeAudit({
      purpose: args.purpose,
      model,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      cost_usd: estimateCost(model, usage.prompt_tokens, usage.completion_tokens),
      duration_ms: Date.now() - started,
      success,
      error: errorMessage,
    });
  }

  return { content, usage, model };
}
```

- [ ] **Step 3.2: 跑 test PASS**

```bash
cd apps/api && NODE_ENV=test npx vitest run ../../tests/ws1/openrouter-llm.test.ts 2>&1 | tail -15
```

Expected: 3 test PASS。

- [ ] **Step 3.3: Commit 3**

```bash
cd /Users/administrator/worktrees/zenithjoy/path4-sprint-1-ws1-2
git add apps/api/src/llm/openrouter.ts
git commit -m "feat(p4-ws1): OpenRouter wrapper + FORCE_5XX + CI clamp + audit

callOpenRouter({ prompt, purpose, maxTokens, model }):
  - OPENROUTER_FORCE_5XX=1 only when NODE_ENV in (test, development)
  - CI=true clamps max_tokens ≤ 20 (test 烧 token 防爆)
  - 调用前后写 llm_audit (cost / model / tokens / duration)
  - 失败也 audit, success=false + error_message

3/3 openrouter unit tests PASS。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: wechat.ts 3 endpoint + app.ts 挂载 (wechat-routes test 转 PASS)

**Files:**
- Modify: `apps/api/src/routes/wechat.ts` (完整重写)
- Modify: `apps/api/src/app.ts` (挂 wechatRouter)

- [ ] **Step 4.1: 完整重写 wechat.ts**

```typescript
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Pool } from 'pg';

export const wechatRouter = Router();

const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || 'cecelia',
  user: process.env.DATABASE_USER || 'cecelia',
  password: process.env.DATABASE_PASSWORD,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============ POST /api/wechat/qr-bind ============
const qrBindSchema = z.object({
  platform: z.literal('wechat'),
  agent_id: z.string().regex(UUID_RE, 'agent_id must be uuid'),
});

wechatRouter.post('/qr-bind', async (req: Request, res: Response) => {
  const parse = qrBindSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_BODY',
      errors: parse.error.format(),
    });
  }
  // thin: 仅返回 dispatched 占位; WS3 接真 agent dispatch
  return res.json({
    ok: true,
    task_id: '00000000-0000-0000-0000-000000000000',
    platform: parse.data.platform,
    agent_id: parse.data.agent_id,
    note: 'thin stub — real dispatch in WS3',
  });
});

// ============ GET /api/wechat/draft-review-poll ============
wechatRouter.get('/draft-review-poll', async (req: Request, res: Response) => {
  const taskId = String(req.query.task_id || '');
  if (!UUID_RE.test(taskId)) {
    return res.status(400).json({ ok: false, code: 'INVALID_TASK_ID' });
  }
  const row = await pool.query('SELECT * FROM wechat_publish_task WHERE id=$1', [taskId]);
  if (row.rowCount === 0) {
    return res.status(404).json({ ok: false, code: 'TASK_NOT_FOUND', task_id: taskId });
  }
  return res.json({ ok: true, task: row.rows[0] });
});

// ============ POST /api/wechat/scheduler-tick ============
const schedulerTickSchema = z.object({
  dryrun: z.boolean().optional(),
});

wechatRouter.post('/scheduler-tick', async (req: Request, res: Response) => {
  const parse = schedulerTickSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ ok: false, code: 'INVALID_BODY', errors: parse.error.format() });
  }
  // thin: 仅返回 picked 0; WS5 接真调度
  return res.json({
    ok: true,
    picked: 0,
    dryrun: parse.data.dryrun ?? false,
    note: 'thin stub — real scheduler in WS5',
  });
});
```

- [ ] **Step 4.2: 挂 router**

读 `apps/api/src/app.ts` 找路由挂载部分, 加:
```typescript
import { wechatRouter } from './routes/wechat';
// ...
app.use('/api/wechat', wechatRouter);
```

- [ ] **Step 4.3: 跑 test PASS**

```bash
cd apps/api && DATABASE_NAME=cecelia DATABASE_USER=cecelia npx vitest run ../../tests/ws1/wechat-routes.test.ts 2>&1 | tail -15
```

Expected: 3 test PASS。

- [ ] **Step 4.4: Commit 4**

```bash
cd /Users/administrator/worktrees/zenithjoy/path4-sprint-1-ws1-2
git add apps/api/src/routes/wechat.ts apps/api/src/app.ts
git commit -m "feat(p4-ws1): wechat 3 endpoint zod + app.ts mount

POST /api/wechat/qr-bind: zod body {platform: 'wechat', agent_id: uuid}
GET /api/wechat/draft-review-poll?task_id=<uuid>: 404 if not found
POST /api/wechat/scheduler-tick: zod {dryrun?: boolean}

Thin stub: 返回占位 task_id / picked=0, 真 dispatch / scheduler 在 WS3/5。

3/3 wechat-routes tests PASS。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: wechat-rpa handler + agent index.ts (handler test 转 PASS)

**Files:**
- Modify: `services/agent/src/handlers/wechat-rpa.ts` (完整重写)
- Modify: `services/agent/src/index.ts` (注册 handler)
- Modify: `scripts/wechat_rpa_dryrun.py` (echo JSON receipt)

- [ ] **Step 5.1: 完整重写 wechat-rpa.ts**

```typescript
import { spawn } from 'node:child_process';
import path from 'node:path';

export interface WechatRpaTask {
  type: 'wechat_qr_bind' | 'wechat_moments_send' | 'wechat_private_chat_send';
  payload: Record<string, unknown>;
  pythonStub?: string;  // 测试注入; 生产用默认脚本路径
}

export interface WechatRpaResult {
  ok: boolean;
  receipt?: Record<string, unknown>;
  error?: string;
}

function resolveScript(task: WechatRpaTask): string {
  if (task.pythonStub) return task.pythonStub;
  // 生产路径: WS3/4 接真 wechat_bot.py / wechat_rpa.py
  // 本 WS1 阶段 dryrun:
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return path.join(repoRoot, 'scripts', 'wechat_rpa_dryrun.py');
}

export async function handleWechatRpa(task: WechatRpaTask): Promise<WechatRpaResult> {
  return new Promise((resolve) => {
    const script = resolveScript(task);
    const py = spawn('python3', [script], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    py.stdout.on('data', d => { stdout += d.toString(); });
    py.stderr.on('data', d => { stderr += d.toString(); });

    py.stdin.write(JSON.stringify({ type: task.type, payload: task.payload }) + '\n');
    py.stdin.end();

    py.on('close', code => {
      if (code !== 0) {
        return resolve({ ok: false, error: `python exit ${code}: ${stderr.slice(0,200)}` });
      }
      try {
        const receipt = JSON.parse(stdout);
        resolve({ ok: true, receipt });
      } catch (e) {
        resolve({ ok: false, error: `receipt parse fail: ${stdout.slice(0,100)}` });
      }
    });

    py.on('error', e => {
      resolve({ ok: false, error: `spawn fail: ${e.message}` });
    });
  });
}
```

- [ ] **Step 5.2: 写 dryrun Python stub**

完整覆盖 `scripts/wechat_rpa_dryrun.py`:

```python
#!/usr/bin/env python3
"""
WS1 dryrun stub for wechat-rpa handler.

Reads JSON from stdin: { "type": "...", "payload": {...} }
Writes JSON receipt to stdout: { "wechat_id": "mock_wx_<8 hex>", ... }
"""
import json
import sys
import hashlib

raw = sys.stdin.read()
try:
    msg = json.loads(raw)
except Exception:
    print(json.dumps({"error": "invalid stdin json"}))
    sys.exit(1)

task_type = msg.get("type", "")
payload = msg.get("payload", {})

# Stable mock id based on agent_id (so tests can be deterministic)
agent_id = str(payload.get("agent_id", "default"))
mock_suffix = hashlib.md5(agent_id.encode()).hexdigest()[:8]
wechat_id = f"mock_wx_{mock_suffix}"

receipt = {
    "wechat_id": wechat_id,
    "task_type": task_type,
    "dryrun": bool(payload.get("dryrun", False)),
    "status": "ok",
}
print(json.dumps(receipt))
sys.exit(0)
```

- [ ] **Step 5.3: 注册到 agent index.ts**

读 `services/agent/src/index.ts` 找现有 handler import 段 (约 18-30 行), 加:
```typescript
import { handleWechatRpa, type WechatRpaTask } from './handlers/wechat-rpa';
```

找 task dispatch switch/route (按现有抖音/快手等 handler 模式), 加 case:
```typescript
case 'wechat_qr_bind':
case 'wechat_moments_send':
case 'wechat_private_chat_send':
  return handleWechatRpa(task as WechatRpaTask);
```

(具体 case 位置看 services/agent/src/index.ts 现有 switch; 如果没有 switch, 加最小 dispatcher。)

- [ ] **Step 5.4: 跑 test PASS**

```bash
cd services/agent && npx vitest run ../../tests/ws1/wechat-rpa-handler.test.ts 2>&1 | tail -10
```

Expected: 1 test PASS。

- [ ] **Step 5.5: Commit 5**

```bash
cd /Users/administrator/worktrees/zenithjoy/path4-sprint-1-ws1-2
git add services/agent/src/handlers/wechat-rpa.ts services/agent/src/index.ts scripts/wechat_rpa_dryrun.py
git commit -m "feat(p4-ws1): wechat-rpa handler + Python dryrun stub

handler: spawn python3 + JSON in/out stdio.
  - stdin: { type, payload }
  - stdout: { wechat_id, task_type, dryrun, status }

dryrun stub: echo deterministic mock_wx_<8-hex of agent_id>.
真 wechat_bot.py / wechat_rpa.py 整入仓库在 WS3/4。

Agent index.ts dispatch 3 wechat task type.

1/1 handler test PASS。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: deploy-agent-to-rog.sh

**Files:**
- Modify: `scripts/deploy-agent-to-rog.sh` (完整重写)

- [ ] **Step 6.1: 完整重写**

```bash
#!/usr/bin/env bash
# scripts/deploy-agent-to-rog.sh
#
# rsync zenithjoy-agent → rog (xian-rog Lead 自检机) ~/zenithjoy-agent
#
# 使用前置:
#   - rog tailscale 已通 (100.98.253.95)
#   - rog SSH 已配 (asus user, key in ~/.ssh/id_rsa)
#   - 本机已 `pnpm -F @zenithjoy/agent build`
#
# 用法:
#   bash scripts/deploy-agent-to-rog.sh             # 默认 dist 部署
#   ZJ_AGENT_SRC=src bash scripts/deploy-agent-to-rog.sh   # 源码部署 (dev)
#   DRY_RUN=1 bash scripts/deploy-agent-to-rog.sh   # 只打印 rsync 命令

set -euo pipefail

ROG_HOST="${ROG_HOST:-100.98.253.95}"
ROG_USER="${ROG_USER:-asus}"
ROG_PATH="${ROG_PATH:-/c/Users/asus/zenithjoy-agent}"
SRC="${ZJ_AGENT_SRC:-services/agent/dist}"

if [ ! -d "$SRC" ]; then
  echo "[deploy] source dir not found: $SRC"
  echo "[deploy] 先跑: pnpm -F @zenithjoy/agent build"
  exit 1
fi

RSYNC_OPTS="-avz --delete --exclude='node_modules' --exclude='.git' --exclude='*.log'"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "[deploy] DRY-RUN: rsync $RSYNC_OPTS $SRC/ ${ROG_USER}@${ROG_HOST}:${ROG_PATH}/"
  exit 0
fi

echo "[deploy] rsync $SRC/ → ${ROG_USER}@${ROG_HOST}:${ROG_PATH}/"
eval rsync $RSYNC_OPTS "$SRC/" "${ROG_USER}@${ROG_HOST}:${ROG_PATH}/"
echo "[deploy] done"
```

- [ ] **Step 6.2: 校验**

```bash
cd /Users/administrator/worktrees/zenithjoy/path4-sprint-1-ws1-2
chmod +x scripts/deploy-agent-to-rog.sh
bash -n scripts/deploy-agent-to-rog.sh && echo "syntax OK"
[ -x scripts/deploy-agent-to-rog.sh ] && echo "executable OK"
DRY_RUN=1 ZJ_AGENT_SRC=services/agent bash scripts/deploy-agent-to-rog.sh
```

Expected: `syntax OK`, `executable OK`, dry-run 输出 rsync 命令。

- [ ] **Step 6.3: Commit 6**

```bash
git add scripts/deploy-agent-to-rog.sh
git commit -m "feat(p4-ws1): deploy-agent-to-rog.sh (rsync wrapper)

ENV: ROG_HOST / ROG_USER / ROG_PATH / ZJ_AGENT_SRC / DRY_RUN.
默认 rsync services/agent/dist → asus@100.98.253.95:~/zenithjoy-agent.

bash -n + executable bit 验证通过。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: 最终 smoke + push + 开 PR

- [ ] **Step 7.1: 全量 smoke**

```bash
cd /Users/administrator/worktrees/zenithjoy/path4-sprint-1-ws1-2
DATABASE_NAME=cecelia DATABASE_USER=cecelia bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh
```

Expected: `Smoke: PASS=7 FAIL=0` (2 表 + qr-bind 400 + body 含 platform/agent_id + dryrun exit 0 + receipt 含 wechat_id, ~7 assert)。

如有 FAIL: 看哪一行, 修对应 Task 的实现 + 重提 commit。

- [ ] **Step 7.2: vitest 全量**

```bash
cd apps/api && DATABASE_NAME=cecelia DATABASE_USER=cecelia NODE_ENV=test npx vitest run ../../tests/ws1/ 2>&1 | tail -20
cd ../../services/agent && npx vitest run ../../tests/ws1/wechat-rpa-handler.test.ts 2>&1 | tail -10
```

Expected: 全 PASS, 0 FAIL。

- [ ] **Step 7.3: push 分支**

```bash
cd /Users/administrator/worktrees/zenithjoy/path4-sprint-1-ws1-2
git push -u origin cp-0513220500-path4-sprint-1-ws1
```

- [ ] **Step 7.4: 开 PR**

```bash
gh pr create --title "feat(path-4-sprint-1-ws1): DB schema + 中台路由 + Agent wechat-rpa + OpenRouter + rog 部署" --body "$(cat <<'EOF'
## Summary

Path 4 (客户私域 AI 接管) Sprint 1 WS1 — 基础设施层骨架。覆盖 6 ARTIFACT + 8 BEHAVIOR DoD (harness contract APPROVED round 2)。

## What's in

- `wechat_publish_task` 表 + `approval_source` CHECK 约束 enforce A 路线护栏
- `llm_audit` 表 + 自动写入 (OpenRouter 每次调用都留痕)
- `apps/api/src/llm/openrouter.ts` — FORCE_5XX 注入 (NODE_ENV=test|development 才生效) + CI=true clamp max_tokens=20
- `apps/api/src/routes/wechat.ts` — 3 endpoint (qr-bind / draft-review-poll / scheduler-tick) 全 zod
- `services/agent/src/handlers/wechat-rpa.ts` — NodeJS spawn Python + JSON stdio
- `scripts/wechat_rpa_dryrun.py` — WS1 阶段 dryrun stub
- `scripts/deploy-agent-to-rog.sh` — rsync wrapper

## TDD chain

commit-1 = fail tests + smoke + skeleton; commit-2~6 = 各 src 实现让 test 转绿。

## Spec / Plan

- Spec: \`docs/superpowers/specs/2026-05-13-path4-sprint-1-ws1-design.md\`
- Plan: \`docs/superpowers/plans/2026-05-13-path4-sprint-1-ws1.md\`
- Harness contract (APPROVED round 2): \`sprints/sprint-d-path4-private-ai-thin/contract-dod-ws1.md\` (在 \`cp-05082012-path4-sprint-1-prd\`)

## Test plan

- [x] tests/ws1/db-schema.test.ts (4/4 PASS, 真 cecelia DB)
- [x] tests/ws1/openrouter-llm.test.ts (3/3 PASS, FORCE_5XX/ignore/CI clamp)
- [x] tests/ws1/wechat-routes.test.ts (3/3 PASS, supertest)
- [x] tests/ws1/wechat-rpa-handler.test.ts (1/1 PASS, 真 spawn python3)
- [x] golden-path-4-smoke.sh (7/0 PASS)
- [ ] Lead 自验 (rog 真部署 + 真扫码绑号) — 推到 WS6 后

Path 4 step 1 (Notion 上"扫码绑个微") 从 ❌ 推到 🟡 (骨架就绪, 真扫码待 WS3 接真 wechat_bot.py)。

Brain task: \`140c8d7b-fbbd-4a5c-9ac7-dd18e6514a80\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Notion-Sprint: Path 4 Sprint 1 (PR open 待 merge)
Notion-Components: Agent 客户端, OpenRouter Client, 飞书 Bitable Adapter
EOF
)"
```

Expected: PR URL 输出。

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 6 ARTIFACT | Task 2 (×2) + 3 + 4 + 5 + 6 |
| §1 8 BEHAVIOR | Task 1 测全部, Task 2-6 转绿 |
| §2 架构图 | Task 2-6 实现 |
| §3.1 wechat_publish_task schema | Task 2 |
| §3.2 llm_audit schema | Task 2 |
| §3.3 FORCE_5XX NODE_ENV 锁 | Task 3 §shouldForce5xx |
| §3.4 CI clamp | Task 3 §clampMaxTokens |
| §3.5 zod platform/agent_id | Task 4 qr-bind schema |
| §3.6 spawn dryrun | Task 5 + dryrun stub |
| §3.7 migration TS | Task 2 §HHMMSS 占位 |
| §4 测试策略 (E2E/integration/unit/trivial) | Task 1 写齐 |
| §6 CI lint (smoke/pairing/tdd/no-fake) | Task 1 含 smoke + tests; commit 顺序保 |
| §7 Out of scope | (无任务) |

**Placeholder scan:** 无 TBD/TODO。所有 code 块给定完整内容。`<HHMMSS>` 在 Task 2 显式占位 = 实施者填当前时刻 (~~~不算 placeholder, 因为 spec §3.7 显式说明~~~)。

**Type consistency:**
- `CallOpenRouterArgs` / `CallOpenRouterResult` Task 1 skeleton + Task 3 impl 一致
- `WechatRpaTask` / `WechatRpaResult` Task 1 + Task 5 一致
- pool config 在 db-schema test + openrouter + wechat route 一致 (host/port/database/user/password env)
- table name `wechat_publish_task` / `llm_audit` 全部使用一致

**Smoke 实际 assert 数** (Task 7.1 期望 PASS=7):
- 2 (表存在 ×2) + 1 (qr-bind 400) + 2 (body 含 platform + agent_id) + 1 (dryrun exit 0) + 1 (receipt 含 wechat_id) = 7 ✓
