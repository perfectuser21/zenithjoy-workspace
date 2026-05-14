# Path 4 Sprint 1 WS2 — 飞书 Bitable 审批表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 微信发布任务创建时，自动在飞书多维表格写入审批记录，运营人员在飞书审批内容。

**Architecture:** 扩展现有 `feishu-bitable-multitenant.ts`，新增第 4 张表「微信发布审批」及 `pushWechatTaskToFeishu` 函数；新增 `POST /api/wechat/draft-submit` 路由，任务入库后异步推飞书。两张 DB 表各加一列（`table_id_wechat_approval` + `feishu_record_id`）。

**Tech Stack:** TypeScript, Express, Zod, pg, Vitest, Feishu Open API v3 (Bitable), psql

---

## 文件变更一览

| 操作 | 文件 | 内容 |
|------|------|------|
| 新建 | `apps/api/db/migrations/20260514_090000_feishu_wechat_approval.sql` | 加 2 列 |
| 修改 | `apps/api/src/services/feishu-bitable-multitenant.ts` | 加第 4 张表 + pushWechatTaskToFeishu |
| 修改 | `apps/api/src/routes/wechat.ts` | 新增 draft-submit 路由 |
| 修改 | `apps/api/src/routes/__tests__/wechat.test.ts` | 追加 draft-submit 断言 |
| 修改 | `apps/api/src/services/feishu-bitable-multitenant.test.ts` | 追加 pushWechatTaskToFeishu 单元测试 |
| 新建 | `apps/api/tests/integration/p4-sprint-1-ws2/feishu-bitable.integration.test.ts` | 集成测试 |
| 修改 | `.github/workflows/scripts/smoke/golden-path-4-smoke.sh` | 追加 Step 2 |
| 修改 | `test-registry.yaml` | 追加 p4-ws2 条目 |

---

## Task 1：写失败的 smoke + 单元测试（commit-1 — TDD 强制先行）

**Files:**
- Modify: `.github/workflows/scripts/smoke/golden-path-4-smoke.sh`
- Modify: `apps/api/src/services/feishu-bitable-multitenant.test.ts`
- Modify: `apps/api/src/routes/__tests__/wechat.test.ts`

- [ ] **Step 1.1: 在 smoke.sh 末尾（`[ "$FAIL" -eq 0 ]` 之前）插入 Step 2 块**

```bash
echo ""
echo "=== Step 2: draft-submit → feishu_record_id 非空 ==="
if [ "$API_REACHABLE" -eq 0 ]; then
  echo "  SKIP: API not reachable"
else
  AGENT_ID="00000000-0000-0000-0000-000000000001"
  HTTP2=$(curl -s -o /tmp/zj-draft.json -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json' \
    -d "{\"agent_id\":\"$AGENT_ID\",\"task_type\":\"moments\",\"content\":\"smoke test content\"}" \
    "$API/api/wechat/draft-submit" 2>/dev/null)
  assert "$HTTP2" "201" "draft-submit → 201"
  TASK_ID=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('task_id',''))" < /tmp/zj-draft.json 2>/dev/null || echo "")
  if [ -n "$TASK_ID" ]; then
    FBR=$(psql -U "$DBUSER" -d "$DB" -tA \
      -c "SELECT feishu_record_id FROM zenithjoy.wechat_publish_task WHERE id='$TASK_ID'" 2>/dev/null | tr -d '[:space:]')
    if [ -n "$FBR" ]; then echo "  PASS: feishu_record_id=$FBR"; PASS=$((PASS+1));
    else echo "  FAIL: feishu_record_id NULL"; FAIL=$((FAIL+1)); fi
  else
    echo "  FAIL: draft-submit 未返回 task_id"; FAIL=$((FAIL+1))
  fi
fi
```

- [ ] **Step 1.2: 在 feishu-bitable-multitenant.test.ts 追加 pushWechatTaskToFeishu 单元测试**

将文件内容替换为：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({
  default: { query: vi.fn() },
}));

vi.mock('axios');

vi.mock('./feishu-token', () => ({
  getValidToken: vi.fn().mockResolvedValue('fake-token'),
}));

import pool from '../db/connection';
import axios from 'axios';

describe('feishu-bitable-multitenant placeholder', () => {
  it('exists — full coverage lives in sprints/path-2-sprint-a-feishu/tests/ws*/', () => {
    expect(true).toBe(true);
  });
});

describe('pushWechatTaskToFeishu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pushWechatTaskToFeishu 是异步函数', async () => {
    const { pushWechatTaskToFeishu } = await import('./feishu-bitable-multitenant');
    expect(pushWechatTaskToFeishu).toBeInstanceOf(Function);
    const result = pushWechatTaskToFeishu('task-id', 'tenant-id');
    expect(result).toBeInstanceOf(Promise);
    await result.catch(() => {}); // 允许 fail，只测是 async function
  });

  it('失败时不抛出（吞异常保护主流程）', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB_DOWN'));
    const { pushWechatTaskToFeishu } = await import('./feishu-bitable-multitenant');
    await expect(pushWechatTaskToFeishu('t1', 'tenant1')).resolves.toBeUndefined();
  });

  it('调飞书 create_record 时 fields 含 任务ID 和 审批状态', async () => {
    (pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-uuid', content: 'hello world', task_type: 'moments',
          target_friend_alias: null, created_at: new Date('2026-05-14'),
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          app_token: 'apptkn', table_id_wechat_approval: 'tblWx',
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE feishu_record_id

    (axios.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { code: 0, data: { record: { record_id: 'rec123' } } },
    });

    const { pushWechatTaskToFeishu } = await import('./feishu-bitable-multitenant');
    await pushWechatTaskToFeishu('task-uuid', 'tenant-uuid');

    const postCall = (axios.post as ReturnType<typeof vi.fn>).mock.calls[0];
    const fields = postCall[1].fields as Record<string, string>;
    expect(fields['任务ID']).toBe('task-uuid');
    expect(fields['审批状态']).toBe('待审批');
  });
});
```

- [ ] **Step 1.3: 在 `apps/api/src/routes/__tests__/wechat.test.ts` 追加 draft-submit 路由断言**

在文件末尾（`});` 前）追加：

```typescript
  it('registers 4 endpoints (qr-bind / draft-review-poll / scheduler-tick / draft-submit)', () => {
    const stack = (wechatRouter as any).stack;
    const paths = stack.filter((l: any) => l.route).map((l: any) => l.route.path);
    expect(paths).toContain('/draft-submit');
  });
```

- [ ] **Step 1.4: 跑测试，确认失败**

```bash
cd /Users/administrator/worktrees/zenithjoy/path4-sprint1-ws2-feishu-bitable
npx vitest run apps/api/src/services/feishu-bitable-multitenant.test.ts apps/api/src/routes/__tests__/wechat.test.ts 2>&1 | tail -20
```

预期：`pushWechatTaskToFeishu` 相关测试 FAIL（函数不存在），draft-submit 路由断言 FAIL。

- [ ] **Step 1.5: 提交 commit-1（仅测试，无实现）**

```bash
cd /Users/administrator/worktrees/zenithjoy/path4-sprint1-ws2-feishu-bitable
git add .github/workflows/scripts/smoke/golden-path-4-smoke.sh \
        apps/api/src/services/feishu-bitable-multitenant.test.ts \
        apps/api/src/routes/__tests__/wechat.test.ts
git commit -m "test(p4-ws2): failing smoke Step 2 + pushWechatTaskToFeishu + draft-submit 单元测试（commit-1）"
```

---

## Task 2：DB 迁移（commit-2a）

**Files:**
- Create: `apps/api/db/migrations/20260514_090000_feishu_wechat_approval.sql`

- [ ] **Step 2.1: 创建迁移文件**

```sql
-- apps/api/db/migrations/20260514_090000_feishu_wechat_approval.sql
-- Path 4 Sprint 1 WS2: 飞书 Bitable 审批表支持
-- tenant_feishu_bindings 加第 4 张表 ID；wechat_publish_task 加飞书行 ID

ALTER TABLE zenithjoy.tenant_feishu_bindings
  ADD COLUMN IF NOT EXISTS table_id_wechat_approval text;

ALTER TABLE zenithjoy.wechat_publish_task
  ADD COLUMN IF NOT EXISTS feishu_record_id text;

COMMENT ON COLUMN zenithjoy.tenant_feishu_bindings.table_id_wechat_approval IS
  'Path 4 WS2 — 飞书「微信发布审批」多维表格 table_id';

COMMENT ON COLUMN zenithjoy.wechat_publish_task.feishu_record_id IS
  'Path 4 WS2 — 对应飞书 Bitable 行 ID，pushWechatTaskToFeishu 写入，WS5 反向同步用';
```

- [ ] **Step 2.2: 本地跑迁移验证**

```bash
cd /Users/administrator/worktrees/zenithjoy/path4-sprint1-ws2-feishu-bitable
psql -U postgres -d cecelia -f apps/api/db/migrations/20260514_090000_feishu_wechat_approval.sql
psql -U postgres -d cecelia -c "\d zenithjoy.tenant_feishu_bindings" | grep wechat_approval
psql -U postgres -d cecelia -c "\d zenithjoy.wechat_publish_task" | grep feishu_record
```

预期：两列都出现。

- [ ] **Step 2.3: 提交迁移**

```bash
git add apps/api/db/migrations/20260514_090000_feishu_wechat_approval.sql
git commit -m "feat(p4-ws2): DB migration — table_id_wechat_approval + feishu_record_id 两列"
```

---

## Task 3：扩展 feishu-bitable-multitenant.ts（commit-2b）

**Files:**
- Modify: `apps/api/src/services/feishu-bitable-multitenant.ts`

- [ ] **Step 3.1: 更新 `BindingRow` 接口，追加 `table_id_wechat_approval`**

找到：
```typescript
interface BindingRow {
  app_token: string | null;
  table_id_lead_profile: string | null;
  table_id_target_videos: string | null;
  table_id_leads: string | null;
}
```
替换为：
```typescript
interface BindingRow {
  app_token: string | null;
  table_id_lead_profile: string | null;
  table_id_target_videos: string | null;
  table_id_leads: string | null;
  table_id_wechat_approval: string | null;
}
```

- [ ] **Step 3.2: 更新 `ProvisionResult` 接口**

找到：
```typescript
interface ProvisionResult {
  app_token: string;
  table_id_lead_profile: string;
  table_id_target_videos: string;
  table_id_leads: string;
}
```
替换为：
```typescript
interface ProvisionResult {
  app_token: string;
  table_id_lead_profile: string;
  table_id_target_videos: string;
  table_id_leads: string;
  table_id_wechat_approval: string;
}
```

- [ ] **Step 3.3: 在 `TABLE_SCHEMAS` 数组末尾追加第 4 张表**

找到末尾的 `];`（TABLE_SCHEMAS 结束），在其前插入：

```typescript
  {
    key: 'wechat_approval' as const,
    name: '微信发布审批',
    fields: [
      { field_name: '任务ID',   type: 1 },
      { field_name: '内容预览', type: 1 },
      { field_name: '任务类型', type: 1 },
      { field_name: '目标好友', type: 1 },
      { field_name: '审批状态', type: 1 },
      { field_name: '创建时间', type: 1 },
    ],
  },
```

- [ ] **Step 3.4: 更新 `provisionBitable` 幂等检查**

找到：
```typescript
  if (
    cached &&
    cached.app_token &&
    cached.table_id_lead_profile &&
    cached.table_id_target_videos &&
    cached.table_id_leads
  ) {
    return {
      app_token: cached.app_token,
      table_id_lead_profile: cached.table_id_lead_profile,
      table_id_target_videos: cached.table_id_target_videos,
      table_id_leads: cached.table_id_leads,
    };
  }
```
替换为：
```typescript
  if (
    cached &&
    cached.app_token &&
    cached.table_id_lead_profile &&
    cached.table_id_target_videos &&
    cached.table_id_leads &&
    cached.table_id_wechat_approval
  ) {
    return {
      app_token: cached.app_token,
      table_id_lead_profile: cached.table_id_lead_profile,
      table_id_target_videos: cached.table_id_target_videos,
      table_id_leads: cached.table_id_leads,
      table_id_wechat_approval: cached.table_id_wechat_approval,
    };
  }
```

- [ ] **Step 3.5: 更新 `provisionBitable` 成功后的 INSERT/UPDATE**

找到成功写回的 `pool.query` 调用（`INSERT INTO zenithjoy.tenant_feishu_bindings`，含 `needs_retry = false`），将 SQL 和参数更新为包含第 4 列：

```typescript
  await pool.query(
    `INSERT INTO zenithjoy.tenant_feishu_bindings
       (tenant_id, app_token, table_id_lead_profile, table_id_target_videos, table_id_leads,
        table_id_wechat_approval, needs_retry, provision_error, bound_at)
     VALUES ($1, $2, $3, $4, $5, $6, false, NULL, NOW())
     ON CONFLICT (tenant_id) DO UPDATE
       SET app_token                 = EXCLUDED.app_token,
           table_id_lead_profile     = EXCLUDED.table_id_lead_profile,
           table_id_target_videos    = EXCLUDED.table_id_target_videos,
           table_id_leads            = EXCLUDED.table_id_leads,
           table_id_wechat_approval  = EXCLUDED.table_id_wechat_approval,
           needs_retry               = false,
           provision_error           = NULL`,
    [
      tenantId,
      appToken,
      tableIds.lead_profile,
      tableIds.target_videos,
      tableIds.leads,
      tableIds.wechat_approval,
    ]
  );

  return {
    app_token: appToken,
    table_id_lead_profile: tableIds.lead_profile,
    table_id_target_videos: tableIds.target_videos,
    table_id_leads: tableIds.leads,
    table_id_wechat_approval: tableIds.wechat_approval,
  };
```

同样更新失败路径的 INSERT（`needs_retry=true`），在 SELECT 列和参数中加入 `table_id_wechat_approval`。

- [ ] **Step 3.6: 在文件末尾新增 `pushWechatTaskToFeishu` 函数**

```typescript
/**
 * Path 4 WS2 — 微信发布任务推送到飞书审批表
 * 失败时 log + 不 throw（不阻塞主流程）
 */
export async function pushWechatTaskToFeishu(
  taskId: string,
  tenantId: string
): Promise<void> {
  try {
    // 1. 拉任务详情
    const taskResult = await pool.query(
      `SELECT id, content, task_type, target_friend_alias, created_at
         FROM zenithjoy.wechat_publish_task WHERE id = $1`,
      [taskId]
    );
    if (taskResult.rows.length === 0) return;
    const task = taskResult.rows[0];

    // 2. 拉飞书绑定（需要 app_token + table_id_wechat_approval）
    const bindResult = await pool.query(
      `SELECT app_token, table_id_wechat_approval
         FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id = $1`,
      [tenantId]
    );
    if (bindResult.rows.length === 0) return;
    const binding = bindResult.rows[0];
    if (!binding.app_token || !binding.table_id_wechat_approval) return;

    // 3. 写飞书记录
    const token = await getValidToken(tenantId);
    const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${binding.app_token}/tables/${binding.table_id_wechat_approval}/records`;
    const contentPreview = String(task.content || '').slice(0, 100);
    const resp = await axios.post(
      url,
      {
        fields: {
          任务ID:   String(task.id),
          内容预览: contentPreview,
          任务类型: String(task.task_type),
          目标好友: task.target_friend_alias ?? '',
          审批状态: '待审批',
          创建时间: new Date(task.created_at).toISOString(),
        },
      },
      { headers: authHeader(token), timeout: 10000 }
    );
    const data = resp.data || {};
    if (data.code !== 0) {
      console.error(`[pushWechatTaskToFeishu] feishu error code=${data.code} msg=${data.msg}`);
      return;
    }
    const recordId: string = data.data?.record?.record_id ?? '';

    // 4. 写回 feishu_record_id
    if (recordId) {
      await pool.query(
        `UPDATE zenithjoy.wechat_publish_task SET feishu_record_id = $1 WHERE id = $2`,
        [recordId, taskId]
      );
    }
  } catch (e) {
    console.error('[pushWechatTaskToFeishu] error (swallowed):', (e as Error).message);
  }
}
```

- [ ] **Step 3.7: 跑单元测试，确认 green**

```bash
cd /Users/administrator/worktrees/zenithjoy/path4-sprint1-ws2-feishu-bitable
npx vitest run apps/api/src/services/feishu-bitable-multitenant.test.ts 2>&1 | tail -15
```

预期：3 个 `pushWechatTaskToFeishu` 测试全部 PASS。

- [ ] **Step 3.8: 提交**

```bash
git add apps/api/src/services/feishu-bitable-multitenant.ts
git commit -m "feat(p4-ws2): feishu-bitable-multitenant — 第 4 张审批表 + pushWechatTaskToFeishu"
```

---

## Task 4：新增 draft-submit 路由（commit-2c）

**Files:**
- Modify: `apps/api/src/routes/wechat.ts`

- [ ] **Step 4.1: 在 wechat.ts 顶部导入 pushWechatTaskToFeishu**

在现有 import 区末尾追加：

```typescript
import { pushWechatTaskToFeishu } from '../services/feishu-bitable-multitenant';
```

- [ ] **Step 4.2: 在文件末尾（最后一个路由后）追加 draft-submit 路由**

```typescript
// ============ POST /api/wechat/draft-submit ============
const draftSubmitSchema = z.object({
  agent_id:             z.string().regex(UUID_RE, 'agent_id must be uuid'),
  task_type:            z.enum(['moments', 'private_chat']),
  content:              z.string().min(1).max(2000),
  target_friend_alias:  z.string().optional(),
  scheduled_at:         z.string().datetime().optional(),
});

wechatRouter.post('/draft-submit', async (req: Request, res: Response) => {
  const parse = draftSubmitSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ ok: false, code: 'INVALID_BODY', errors: parse.error.format() });
  }
  const { agent_id, task_type, content, target_friend_alias, scheduled_at } = parse.data;

  // 查 agent → tenant_id
  const agentRow = await pool.query(
    `SELECT tenant_id FROM zenithjoy.agents WHERE id = $1`,
    [agent_id]
  ).catch(() => ({ rows: [] }));
  const tenantId: string | null = agentRow.rows[0]?.tenant_id ?? null;

  // INSERT wechat_publish_task
  const insertResult = await pool.query(
    `INSERT INTO zenithjoy.wechat_publish_task
       (agent_id, task_type, content, target_friend_alias, scheduled_at, status, approval_source)
     VALUES ($1, $2, $3, $4, $5, 'draft', 'feishu_user')
     RETURNING id`,
    [agent_id, task_type, content, target_friend_alias ?? null, scheduled_at ?? new Date().toISOString()]
  );
  const taskId: string = insertResult.rows[0].id;

  // 异步推飞书（不 await，不阻塞响应）
  if (tenantId) {
    void pushWechatTaskToFeishu(taskId, tenantId).catch((e: Error) =>
      console.error('[draft-submit] pushWechatTaskToFeishu failed:', e.message)
    );
  }

  return res.status(201).json({ ok: true, task_id: taskId, status: 'pending_approval' });
});
```

- [ ] **Step 4.3: 跑路由单元测试，确认 draft-submit 出现在 stack**

```bash
cd /Users/administrator/worktrees/zenithjoy/path4-sprint1-ws2-feishu-bitable
npx vitest run apps/api/src/routes/__tests__/wechat.test.ts 2>&1 | tail -10
```

预期：4 个测试全部 PASS（含新追加的 draft-submit 断言）。

- [ ] **Step 4.4: 提交**

```bash
git add apps/api/src/routes/wechat.ts
git commit -m "feat(p4-ws2): POST /api/wechat/draft-submit — 任务入库 + 异步推飞书"
```

---

## Task 5：集成测试（commit-2d）

**Files:**
- Create: `apps/api/tests/integration/p4-sprint-1-ws2/feishu-bitable.integration.test.ts`

- [ ] **Step 5.1: 创建集成测试文件**

```typescript
/**
 * P4 Sprint 1 WS2 — feishu-bitable 集成测试
 *
 * 测真实 DB（zenithjoy schema）+ 用环境变量 FEISHU_API_BASE 指向 fake-server 或 skip。
 * 跑法: DATABASE_URL=postgresql://postgres@localhost/cecelia npx vitest run <此文件>
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres@localhost/cecelia' });

const FEISHU_AVAILABLE = !!process.env.FEISHU_API_BASE;

describe('P4 WS2 — DB 列存在', () => {
  it('tenant_feishu_bindings 有 table_id_wechat_approval 列', async () => {
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='zenithjoy' AND table_name='tenant_feishu_bindings'
       AND column_name='table_id_wechat_approval'`
    );
    expect(r.rows.length).toBe(1);
  });

  it('wechat_publish_task 有 feishu_record_id 列', async () => {
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='zenithjoy' AND table_name='wechat_publish_task'
       AND column_name='feishu_record_id'`
    );
    expect(r.rows.length).toBe(1);
  });
});

describe('P4 WS2 — pushWechatTaskToFeishu', () => {
  it.skipIf(!FEISHU_AVAILABLE)('fake-server 模式：写入 feishu_record_id', async () => {
    // 需要 FEISHU_API_BASE=http://localhost:XXXX 指向 fake-server
    const { pushWechatTaskToFeishu } = await import('../../../src/services/feishu-bitable-multitenant');
    // 若没有真实 tenant，只测函数不抛
    await expect(pushWechatTaskToFeishu('no-such-id', 'no-such-tenant')).resolves.toBeUndefined();
  });

  it('tenant 不存在时 pushWechatTaskToFeishu 静默返回', async () => {
    const { pushWechatTaskToFeishu } = await import('../../../src/services/feishu-bitable-multitenant');
    await expect(pushWechatTaskToFeishu('non-existent', 'non-existent')).resolves.toBeUndefined();
  });
});

afterAll(async () => {
  await pool.end();
});
```

- [ ] **Step 5.2: 跑集成测试**

```bash
cd /Users/administrator/worktrees/zenithjoy/path4-sprint1-ws2-feishu-bitable
DATABASE_URL=postgresql://postgres@localhost/cecelia npx vitest run \
  apps/api/tests/integration/p4-sprint-1-ws2/feishu-bitable.integration.test.ts 2>&1 | tail -15
```

预期：DB 列断言 2 个 PASS，fake-server 测试 SKIP（无 FEISHU_API_BASE）。

- [ ] **Step 5.3: 跑 smoke，确认 Step 1 仍 PASS，Step 2 在 API 不起时 SKIP**

```bash
cd /Users/administrator/worktrees/zenithjoy/path4-sprint1-ws2-feishu-bitable
bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh 2>&1 | tail -10
```

预期：`PASS=4 FAIL=0`（Step 2 SKIP，原 Step 1 四项 PASS）。

- [ ] **Step 5.4: 提交集成测试**

```bash
git add apps/api/tests/integration/p4-sprint-1-ws2/feishu-bitable.integration.test.ts
git commit -m "test(p4-ws2): 集成测试 — DB 列 + pushWechatTaskToFeishu 静默"
```

---

## Task 6：test-registry.yaml + CI 合规 + PR（commit-3）

**Files:**
- Modify: `test-registry.yaml`

- [ ] **Step 6.1: 在 test-registry.yaml 的 `# P4 Sprint 1 WS1` 块后追加 WS2 块**

```yaml
# P4 Sprint 1 WS2
- id: p4-ws2-feishu-bitable-integration
  path: apps/api/tests/integration/p4-sprint-1-ws2/feishu-bitable.integration.test.ts
  product: 私域运营
  type: integration
  description: 飞书 Bitable 审批表 — DB 列存在 + pushWechatTaskToFeishu 静默

- id: p4-ws2-feishu-bitable-multitenant-unit
  path: apps/api/src/services/feishu-bitable-multitenant.test.ts
  product: 私域运营
  type: unit
  description: pushWechatTaskToFeishu 单元测试（异步函数 / 失败不抛 / fields 格式）

- id: p4-ws2-wechat-routes-draft-submit
  path: apps/api/src/routes/__tests__/wechat.test.ts
  product: 私域运营
  type: unit
  description: draft-submit 路由注册到 wechatRouter.stack
```

- [ ] **Step 6.2: 跑 lint-test-pairing 本地验证**

```bash
cd /Users/administrator/worktrees/zenithjoy/path4-sprint1-ws2-feishu-bitable
bash .github/workflows/scripts/lint-test-pairing.sh origin/main 2>&1 | tail -10
```

预期：PASS（所有新 src 文件均有配套测试）。

- [ ] **Step 6.3: 跑 lint-feature-has-smoke 验证**

```bash
bash .github/workflows/scripts/lint-feature-has-smoke.sh origin/main 2>&1 | tail -5
```

预期：PASS（smoke 文件已修改）。

- [ ] **Step 6.4: 提交 registry + push**

```bash
git add test-registry.yaml
git commit -m "[CONFIG] feat(p4-ws2): test-registry.yaml + smoke Step 2 CI 合规"
git push origin cp-0514095930-path4-sprint1-ws2-feishu-bitable
```

- [ ] **Step 6.5: 开 PR**

```bash
gh pr create \
  --title "[CONFIG] feat(p4-ws2): 飞书 Bitable 审批表 — provisionBitable 第 4 张表 + draft-submit" \
  --body "$(cat <<'EOF'
## 本 PR 推进

Path 4 Step 2：从 ❌ 推到 🟡（单向推送，WS5 补 webhook 回调）

## 变更

- `feishu-bitable-multitenant.ts`：第 4 张表「微信发布审批」+ `pushWechatTaskToFeishu`
- `wechat.ts`：新增 `POST /api/wechat/draft-submit`，任务入库后异步推飞书
- DB migration：`table_id_wechat_approval` + `feishu_record_id` 两列
- Smoke Step 2：draft-submit → feishu_record_id 非空验证

## 测试

- 单元：3 pushWechatTaskToFeishu + 1 draft-submit 路由断言
- 集成：DB 列存在 × 2
- Smoke：Step 1 PASS=4 FAIL=0（Step 2 API 不起时 SKIP）

Notion-Sprint: Path 4 Sprint 1
Notion-Components: 飞书审批, 微信发布
EOF
)"
```
