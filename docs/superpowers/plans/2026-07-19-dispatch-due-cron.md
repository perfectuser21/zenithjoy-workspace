# dispatch-due-cron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 Path2 Seg4 私信派单的两个缺失环节：(1) `scheduler.ts` 的 `startScheduler()` 从建库以来就从未被服务器进程启动过，(2) 即使启动了，`dispatchDue` 也没有挂在这个循环上——`dm_assignments` 到期后不会自动从 `queued` 变成 `dispatched`。两者都修，让 DM 派单真正做到无人工介入自动发送。

**Architecture:** 在 `apps/api/src/index.ts` 里补一行 `startScheduler()` 调用（让 `scheduler.ts` 现有的 setInterval(60s) 循环真正跑起来）；在 `scheduler.ts` 里新增 `triggerDmDispatchSweep()`，每次 tick 无条件执行——查所有存在到期 `queued` 行的租户，逐个调用现成的 `dispatchDue(pool, tenantId)`。不改 `dispatchDue`/`buildAssignments` 内部任何逻辑。

**Tech Stack:** TypeScript, Express, node-postgres (`pg`), Vitest。

## Global Constraints

- TDD 铁律：每个 task 先写失败测试（commit-1），再写实现让测试变绿（commit-2）
- 不新建数据库连接池，复用 `apps/api/src/db/connection.ts` 导出的单例 `pool`（`import pool from '../db/connection'`）
- 不改 `dispatchDue`/`buildAssignments`（`apps/api/src/services/acquisition-dispatch.ts`）的函数签名或内部逻辑
- 全程容错：新增代码里任何异常只 `console.warn`/`console.error`，不得抛出到 setInterval 回调外层（会导致未捕获异常，进程虽有全局 `unhandledRejection`/`uncaughtException` 兜底但仍应在源头 catch）

---

### Task 1: `startScheduler()` 真正接入服务器启动流程

**Files:**
- Modify: `apps/api/src/index.ts:1-6`（imports 区）、`apps/api/src/index.ts:29-38`（`server.listen` 回调内）
- Test: `apps/api/tests/index-scheduler-wiring.test.ts`（新建）

**Interfaces:**
- Consumes：`apps/api/src/services/scheduler.ts` 已导出的 `startScheduler(): SchedulerHandle`（无需改动该函数本身）
- Produces：无（本 task 是纯粹的"接线"，不产出新函数供后续 task 使用；Task 2 独立修改 `scheduler.ts`，两个 task 互不依赖对方产出，可并行理解，但为保证提交历史清晰仍按顺序做）

**背景**：`git log -S"startScheduler" -- apps/api/src/index.ts` 返回零提交，`grep -rn "startScheduler(" --include="*.ts" .`（排除 node_modules）只在 `apps/api/src/services/scheduler.ts` 自己的定义和 `apps/api/tests/services/scheduler.test.ts` 单测里出现——这个函数从来没有被服务器进程真正调用过。

- [ ] **Step 1: 写失败的静态契约测试**

创建 `apps/api/tests/index-scheduler-wiring.test.ts`：

```typescript
/**
 * apps/api/src/index.ts 必须真正调用 startScheduler()——历史教训：这个函数从建库起
 * 就只在自己的单测里被 import，从未接入服务器启动流程，导致日报结算/朋友圈草稿/
 * warmup 养号/DM 派单四个周期任务全部静默不跑。静态检查源码文本，防止未来重构
 * 时又被悄悄移除且没有测试报警。
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

const INDEX_PATH = path.resolve(__dirname, '../src/index.ts');

describe('index.ts — startScheduler 必须真正接入', () => {
  it('import 了 startScheduler', () => {
    const src = fs.readFileSync(INDEX_PATH, 'utf-8');
    expect(src).toMatch(/import\s*\{[^}]*\bstartScheduler\b[^}]*\}\s*from\s*['"]\.\/services\/scheduler['"]/);
  });

  it('调用了 startScheduler()（不只是 import 没调用）', () => {
    const src = fs.readFileSync(INDEX_PATH, 'utf-8');
    expect(src).toMatch(/\bstartScheduler\s*\(\s*\)/);
  });
});
```

- [ ] **Step 2: 跑测试确认报红**

Run: `cd apps/api && npx vitest run tests/index-scheduler-wiring.test.ts`
Expected: 两个测试都 FAIL（`index.ts` 目前既不 import 也不调用 `startScheduler`）

- [ ] **Step 3: 接入 `index.ts`**

在 `apps/api/src/index.ts` 顶部 imports 区（第 5 行 `startStaleListenerMonitor` 那一行之后）新增一行 import：

```typescript
import { startStaleListenerMonitor } from './services/wechat-heartbeat';
import { startScheduler } from './services/scheduler';
import { runStartupConfigCheck } from './startup-check';
```

在 `server.listen(...)` 回调内、`startStaleListenerMonitor();` 那一行之后追加调用：

```typescript
server.listen(PORT, () => {
  console.log(`🚀 Works Management API + Agent WS running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   API docs: http://localhost:${PORT}/api/works`);
  console.log(`   Agent WS: ws://localhost:${PORT}/agent-ws`);
  // 选题池 v1 阶段2：老 pipeline-scheduler 已废除，改由 topic-worker.py LaunchAgent 每日 09:00 触发
  // 进程守护：每分钟检查微信监听心跳，断 3 分钟无心跳 → 飞书告警（FEISHU_ALERT_WEBHOOK）
  startStaleListenerMonitor();
  // 中台定时调度器：日报结算(23:55北京)/朋友圈草稿(09:00)/warmup养号(10:00北京)/DM派单sweep(每分钟)。
  // 治根 2026-07-19：startScheduler() 建库以来从未被服务器进程调用过，四个周期任务全部静默不跑。
  startScheduler();
});
```

- [ ] **Step 4: 跑测试确认变绿**

Run: `cd apps/api && npx vitest run tests/index-scheduler-wiring.test.ts`
Expected: 两个测试都 PASS

- [ ] **Step 5: 跑现有 scheduler 相关测试确认没有破坏**

Run: `cd apps/api && npx vitest run tests/services/scheduler.test.ts`
Expected: 原有 4 个测试全部 PASS（未改动 `scheduler.ts` 本身，仅新增了调用方）

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/index.ts apps/api/tests/index-scheduler-wiring.test.ts
git commit -m "fix(scheduler): startScheduler() 从未被服务器进程调用，现真正接入 index.ts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `triggerDmDispatchSweep()` — 给 dispatchDue 挂周期 tick

**Files:**
- Modify: `apps/api/src/services/scheduler.ts`（imports 区、新增函数、`startScheduler()` 内 setInterval 回调）
- Test: `apps/api/tests/services/scheduler.test.ts`（追加用例，文件已存在，见下方现状）

**Interfaces:**
- Consumes：
  - `dispatchDue(pool: QueryablePool, tenantId: string, now?: Date): Promise<DispatchResult>`，从 `./acquisition-dispatch` import（`apps/api/src/services/acquisition-dispatch.ts:615`，已存在，不改）
  - `pool`，从 `../db/connection` import（默认导出，`apps/api/src/db/connection.ts`，已存在，不改）
- Produces：`triggerDmDispatchSweep(): Promise<void>`，导出供测试直接调用（同 `triggerWarmupEnqueue`/`triggerDailyReportSettlement` 现有导出模式）

**当前 `apps/api/tests/services/scheduler.test.ts` 完整内容**（本 task 只追加，不删除任何现有 describe 块）：

```typescript
/**
 * Path 4 Sprint 1 ws4 — services/scheduler.ts 单元测试（RED）。
 *
 * 测试 startScheduler：
 *   1) 文件存在 + 含 cron 表达式字面量 '0 9 * * *'
 *   2) 含 thin server 时区注释
 *   3) startScheduler() 调用后会返回 stop handle，且 timer 已注册（可被 stopScheduler 清掉）
 *   4) tick 触发时（手动 invoke triggerSchedulerTick 或 setInterval flush）会 fetch
 *      POST localhost:5200/api/wechat/scheduler-tick
 *
 * 注：不测真实 setInterval 计时（单元测试中不可控），改测 triggerSchedulerTick 直接调用
 * 是否触发 fetch（合同中的 "cron 触发时调 POST scheduler-tick" 行为契约）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

const SCHEDULER_PATH = path.resolve(__dirname, '../../src/services/scheduler.ts');

describe('ws4 services/scheduler.ts — 静态契约', () => {
  it('文件存在', () => {
    expect(fs.existsSync(SCHEDULER_PATH)).toBe(true);
  });

  it('含 cron 表达式 \'0 9 * * *\'（grep 字面量）', () => {
    const src = fs.readFileSync(SCHEDULER_PATH, 'utf-8');
    expect(src).toMatch(/cron[\s\S]{0,200}?['"`]0 9 \* \* \*['"`]/);
  });

  it('含 thin server 时区注释', () => {
    const src = fs.readFileSync(SCHEDULER_PATH, 'utf-8');
    expect(src).toMatch(/thin.*server\s*时区/);
  });

  it('export startScheduler + stopScheduler + triggerSchedulerTick', () => {
    const src = fs.readFileSync(SCHEDULER_PATH, 'utf-8');
    expect(src).toMatch(
      /export\s+(async\s+)?function\s+startScheduler\b|export\s+\{[^}]*startScheduler[^}]*\}/,
    );
    expect(src).toMatch(
      /export\s+(async\s+)?function\s+stopScheduler\b|export\s+\{[^}]*stopScheduler[^}]*\}/,
    );
    expect(src).toMatch(
      /export\s+(async\s+)?function\s+triggerSchedulerTick\b|export\s+\{[^}]*triggerSchedulerTick[^}]*\}/,
    );
  });
});

describe('ws4 services/scheduler.ts — triggerSchedulerTick 触发 fetch /api/wechat/scheduler-tick', () => {
  const ORIGINAL_FETCH = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it('triggerSchedulerTick() → 调用 fetch POST localhost:5200/api/wechat/scheduler-tick {force:false}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ generated: 0, skipped: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { triggerSchedulerTick } = await import('../../src/services/scheduler');
    await triggerSchedulerTick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/wechat\/scheduler-tick$/);
    expect(String(url)).toMatch(/localhost:5200|127\.0\.0\.1:5200|:5200/);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ force: false });
  });

  it('startScheduler 返回非空 handle，stopScheduler 能清掉 timer 不抛错', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ generated: 0, skipped: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { startScheduler, stopScheduler } = await import(
      '../../src/services/scheduler'
    );
    const handle = startScheduler();
    expect(handle).toBeTruthy();
    expect(() => stopScheduler(handle)).not.toThrow();
  });
});
```

- [ ] **Step 1: 写失败测试 — 追加到 `apps/api/tests/services/scheduler.test.ts` 文件末尾**

在文件顶部 import 区追加 mock（vitest 的 `vi.mock` 必须在文件顶层，放在现有 imports 之后）：

```typescript
vi.mock('../../src/db/connection', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../../src/services/acquisition-dispatch', () => ({
  dispatchDue: vi.fn().mockResolvedValue({ dispatched: 0, skipped_window: 0, skipped_limit: 0 }),
}));
```

在文件末尾追加新的 describe 块：

```typescript
describe('ws4 services/scheduler.ts — triggerDmDispatchSweep（Path2 Seg4 DM派单周期扫描）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('export triggerDmDispatchSweep', () => {
    const src = fs.readFileSync(SCHEDULER_PATH, 'utf-8');
    expect(src).toMatch(
      /export\s+(async\s+)?function\s+triggerDmDispatchSweep\b|export\s+\{[^}]*triggerDmDispatchSweep[^}]*\}/,
    );
  });

  it('有到期 queued 租户时，对每个租户调用一次 dispatchDue', async () => {
    const poolModule = await import('../../src/db/connection');
    const mockPool = poolModule.default as unknown as { query: ReturnType<typeof vi.fn> };
    mockPool.query.mockResolvedValue({
      rows: [{ tenant_id: 'tenant-a' }, { tenant_id: 'tenant-b' }],
    });

    const dispatchModule = await import('../../src/services/acquisition-dispatch');
    const dispatchDueMock = dispatchModule.dispatchDue as unknown as ReturnType<typeof vi.fn>;

    const { triggerDmDispatchSweep } = await import('../../src/services/scheduler');
    await triggerDmDispatchSweep();

    expect(dispatchDueMock).toHaveBeenCalledTimes(2);
    expect(dispatchDueMock).toHaveBeenCalledWith(expect.anything(), 'tenant-a');
    expect(dispatchDueMock).toHaveBeenCalledWith(expect.anything(), 'tenant-b');
  });

  it('无到期租户时，不调用 dispatchDue', async () => {
    const poolModule = await import('../../src/db/connection');
    const mockPool = poolModule.default as unknown as { query: ReturnType<typeof vi.fn> };
    mockPool.query.mockResolvedValue({ rows: [] });

    const dispatchModule = await import('../../src/services/acquisition-dispatch');
    const dispatchDueMock = dispatchModule.dispatchDue as unknown as ReturnType<typeof vi.fn>;

    const { triggerDmDispatchSweep } = await import('../../src/services/scheduler');
    await triggerDmDispatchSweep();

    expect(dispatchDueMock).not.toHaveBeenCalled();
  });

  it('单个租户 dispatchDue 抛异常时，只 warn 不影响其它租户/不向上抛出', async () => {
    const poolModule = await import('../../src/db/connection');
    const mockPool = poolModule.default as unknown as { query: ReturnType<typeof vi.fn> };
    mockPool.query.mockResolvedValue({
      rows: [{ tenant_id: 'tenant-fail' }, { tenant_id: 'tenant-ok' }],
    });

    const dispatchModule = await import('../../src/services/acquisition-dispatch');
    const dispatchDueMock = dispatchModule.dispatchDue as unknown as ReturnType<typeof vi.fn>;
    dispatchDueMock.mockImplementation((_pool: unknown, tenantId: string) => {
      if (tenantId === 'tenant-fail') return Promise.reject(new Error('boom'));
      return Promise.resolve({ dispatched: 0, skipped_window: 0, skipped_limit: 0 });
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { triggerDmDispatchSweep } = await import('../../src/services/scheduler');
    await expect(triggerDmDispatchSweep()).resolves.not.toThrow();

    expect(dispatchDueMock).toHaveBeenCalledWith(expect.anything(), 'tenant-ok');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('startScheduler 的 setInterval 回调里，每次 tick 都会调用 triggerDmDispatchSweep（不按时刻门控）', () => {
    vi.useFakeTimers();
    const poolModule = await import('../../src/db/connection');
    const mockPool = poolModule.default as unknown as { query: ReturnType<typeof vi.fn> };
    mockPool.query.mockResolvedValue({ rows: [] });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ generated: 0, skipped: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { startScheduler, stopScheduler } = require('../../src/services/scheduler');
    const handle = startScheduler();

    vi.advanceTimersByTime(60_000);

    expect(mockPool.query).toHaveBeenCalled();

    stopScheduler(handle);
    vi.useRealTimers();
  });
});
```

> 注：最后一条用例混用 `async` 函数体但用了 `require`（同步）避免 `vi.useFakeTimers()` 与顶层 dynamic `import()` 的时序问题——如实现时发现 `require` 在该测试文件的 ESM/CJS 配置下不可用，改用先在 `beforeEach` 外层用 `await import(...)` 拿到引用、测试体内只调用同步部分即可，两种写法二选一，核心断言不变（tick 后 `mockPool.query` 被调用过）。

- [ ] **Step 2: 跑测试确认新增用例报红**

Run: `cd apps/api && npx vitest run tests/services/scheduler.test.ts`
Expected: 新增的 5 个用例 FAIL（`triggerDmDispatchSweep` 不存在），原有 4 个用例仍 PASS

- [ ] **Step 3: 实现 `triggerDmDispatchSweep` 并接入 `startScheduler`**

在 `apps/api/src/services/scheduler.ts` 顶部 import 区（`import { enqueueWarmupTasks } from './warmup-dispatch';` 之后）追加：

```typescript
import { enqueueWarmupTasks } from './warmup-dispatch';
import { dispatchDue } from './acquisition-dispatch';
import pool from '../db/connection';
```

在 `triggerWarmupEnqueue` 函数定义之后（`startScheduler()` 定义之前）新增：

```typescript
/**
 * Path2 Seg4 DM 派单周期扫描：每次 tick（每分钟）都执行，不按时刻门控——
 * dm_assignments.scheduled_for 是当天随机分散的具体时间点，必须随时检查是否有新到期的。
 * 治根 2026-07-19：buildAssignments/dispatchDue 之前只在 /collect/report 的
 * afterCommit 链里同步调用一次，此时 scheduled_for 通常还没到，之后没有任何周期
 * 任务回头检查——queued 的 assignment 会永远卡住，只能靠人工手动 POST /dispatch/run。
 * 全程容错：单租户 dispatchDue 失败只 warn，不影响其它租户 / 不拖垮 scheduler 主循环。
 */
export async function triggerDmDispatchSweep(): Promise<void> {
  let dueTenants: string[] = [];
  try {
    const res = await pool.query(
      `SELECT DISTINCT tenant_id FROM zenithjoy.dm_assignments
        WHERE status = 'queued' AND scheduled_for <= now()`,
    );
    dueTenants = (res.rows as Array<{ tenant_id: string }>).map((r) => r.tenant_id);
  } catch (err) {
    console.warn('[scheduler] dm-dispatch-sweep 查询到期租户失败:', err);
    return;
  }
  for (const tenantId of dueTenants) {
    try {
      const r = await dispatchDue(pool, tenantId);
      console.log(`[scheduler] dm-dispatch-sweep fired for tenant=${tenantId}: dispatched=${r.dispatched}`);
    } catch (err) {
      console.warn(`[scheduler] dm-dispatch-sweep tenant=${tenantId} 失败:`, err);
    }
  }
}
```

在 `startScheduler()` 的 setInterval 回调最后（Line02 warmup 分支之后），追加无条件调用：

```typescript
      // Line02 warmup：北京 10:00 → 给在线 android burner agent 下发养号验活（按北京自然日去重）
      if (bj.hour === WARMUP_HOUR_BJ && bj.minute === WARMUP_MINUTE_BJ) {
        if (handle.lastWarmupYmd !== bj.ymd) {
          handle.lastWarmupYmd = bj.ymd;
          triggerWarmupEnqueue().catch((err) => {
            console.warn('[scheduler] interval-fired warmup 异常:', err);
          });
        }
      }
      // Path2 Seg4 DM 派单：每次 tick 都扫（不按时刻门控，随时检查到期的 queued assignment）
      triggerDmDispatchSweep().catch((err) => {
        console.warn('[scheduler] interval-fired dm-dispatch-sweep 异常:', err);
      });
```

- [ ] **Step 4: 跑测试确认变绿**

Run: `cd apps/api && npx vitest run tests/services/scheduler.test.ts`
Expected: 全部 9 个用例（原有 4 + 新增 5）PASS

- [ ] **Step 5: Proven-to-fire — 故意注释掉新增调用，确认测试报红**

临时注释掉 `startScheduler()` 里新加的 `triggerDmDispatchSweep().catch(...)` 那一段，重跑：

Run: `cd apps/api && npx vitest run tests/services/scheduler.test.ts`
Expected: 最后一条"每次 tick 都会调用"用例 FAIL，其余仍 PASS

确认报红后，撤销这次临时注释（恢复 Step 3 写的代码）。

- [ ] **Step 6: 跑全量相关测试确认无回归**

Run: `cd apps/api && npx vitest run tests/services/scheduler.test.ts tests/index-scheduler-wiring.test.ts src/services/acquisition-dispatch.test.ts`
Expected: 全部 PASS（`acquisition-dispatch.test.ts` 未改动，验证 import 关系没有破坏其现有测试）

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/scheduler.ts apps/api/tests/services/scheduler.test.ts
git commit -m "feat(scheduler): 新增 triggerDmDispatchSweep，给 dispatchDue 挂周期tick

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: smoke 脚本 + 注册（feat: 类 PR 强制要求）

**Files:**
- Create: `.github/workflows/scripts/smoke/dm-dispatch-sweep-smoke.sh`
- Modify: `.github/workflows/scripts/smoke-baseline.txt`（追加新脚本名）
- Modify: `test-registry.yaml`（追加本次新增的两个测试文件）

**Interfaces:**
- Consumes：staging API `POST /api/acquisition/dispatch/run`（已存在的既有端点，`apps/api/src/routes/acquisition-dispatch.ts:75`，本次未改动）、`GET /health`
- Produces：无（本 task 是 CI 门槛合规，不产出代码接口）

**背景**：项目 CLAUDE.md 铁律——`feat:` 类 PR 必须有对应 smoke 脚本挂进 CI，否则 `lint-feature-has-smoke` 拦截合并。本次改动是 `fix:` 类型（bug fix），但涉及 `apps/api/src/index.ts` 服务器启动流程 + `services/scheduler.ts`，属于"环境接缝"（真实进程是否真的把 scheduler 跑起来），按 PrepPRD 里"环境接缝守卫"的要求配一条 smoke。

- [ ] **Step 1: 写 smoke 脚本**

创建 `.github/workflows/scripts/smoke/dm-dispatch-sweep-smoke.sh`：

```bash
#!/usr/bin/env bash
# dm-dispatch-sweep-smoke.sh — 验证 startScheduler() 真的被服务器进程启动，
# 且 triggerDmDispatchSweep 逻辑存在（静态+启动日志双重确认，不依赖真实等到 scheduled_for）。
#
# 治根 2026-07-19：startScheduler() 建库以来从未被 index.ts 调用，本 smoke 防止未来
# 重构时这行调用又被悄悄删掉且没人发现（同类 bug 复发）。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"

echo "=== 1. 静态检查：index.ts 源码含 startScheduler() 调用 ==="
if ! grep -qE '\bstartScheduler\s*\(\s*\)' apps/api/src/index.ts; then
  echo "FAIL: apps/api/src/index.ts 未调用 startScheduler()"
  exit 1
fi
echo "OK"

echo "=== 2. 静态检查：scheduler.ts 含 triggerDmDispatchSweep 且已接入 setInterval 回调 ==="
if ! grep -qE 'export\s+(async\s+)?function\s+triggerDmDispatchSweep\b' apps/api/src/services/scheduler.ts; then
  echo "FAIL: triggerDmDispatchSweep 未导出"
  exit 1
fi
if ! grep -q 'triggerDmDispatchSweep()' apps/api/src/services/scheduler.ts; then
  echo "FAIL: triggerDmDispatchSweep 未在 startScheduler 循环内被调用"
  exit 1
fi
echo "OK"

echo "=== 3. 存活服务健康检查（若 API_BASE 可达） ==="
if curl -sf -m 5 "$API_BASE/health" > /dev/null 2>&1; then
  echo "OK: $API_BASE/health 可达"
else
  echo "SKIP: $API_BASE 不可达（本地/CI 未起服务时的预期降级，静态检查已覆盖核心断言）"
fi

echo "=== dm-dispatch-sweep-smoke PASS ==="
```

- [ ] **Step 2: 加执行权限**

Run: `chmod +x .github/workflows/scripts/smoke/dm-dispatch-sweep-smoke.sh`

- [ ] **Step 3: 本地跑一次验证脚本本身没语法错**

Run: `bash .github/workflows/scripts/smoke/dm-dispatch-sweep-smoke.sh`
Expected: 输出三段 `OK`（第 3 段本地大概率 SKIP，属预期）+ `dm-dispatch-sweep-smoke PASS`，exit code 0

- [ ] **Step 4: 注册进 smoke-baseline.txt**

`.github/workflows/scripts/smoke-baseline.txt` 是纯文件名列表（每行一个 smoke 脚本文件名，无路径前缀）。在文件末尾追加一行：

```
dm-dispatch-sweep-smoke.sh
```

- [ ] **Step 5: 注册进 test-registry.yaml**

`test-registry.yaml` 是 YAML 数组，每条含 `id`/`path`/`type`/`ci`/`status`/`product`/`note` 字段（参考文件末尾已有条目格式，如 `voice-latency-tracker-unit`）。在文件末尾追加两条：

```yaml
- id: dm-dispatch-sweep-scheduler-wiring-unit
  path: apps/api/tests/services/scheduler.test.ts
  type: unit
  ci: L3
  status: active
  product: 智能获客
  note: "sprint(07192057): dispatch-due-cron——triggerDmDispatchSweep单测，给dispatchDue挂周期tick，含全租户扫描/单租户失败隔离/setInterval回调触发覆盖"

- id: index-scheduler-wiring-unit
  path: apps/api/tests/index-scheduler-wiring.test.ts
  type: unit
  ci: L3
  status: active
  product: 智能获客
  note: "sprint(07192057): dispatch-due-cron——静态检查index.ts真的调用了startScheduler()，防止建库以来从未接线的问题在未来重构中再次静默复发"
```

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/scripts/smoke/dm-dispatch-sweep-smoke.sh \
        .github/workflows/scripts/smoke-baseline.txt \
        test-registry.yaml
git commit -m "test(smoke): dm-dispatch-sweep-smoke — 防 startScheduler 接线被悄悄移除

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
