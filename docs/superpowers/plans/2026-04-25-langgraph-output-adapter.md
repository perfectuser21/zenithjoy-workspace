# LangGraph Output Adapter — pending 状态不 404 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 纯 LangGraph 任务访问 `/api/pipeline/:id/output` 和 `/stages` 在事件未写入时返回 200 pending（而非 404），通过查 `tasks` 表确认任务存在。

**Architecture:** 在 `langgraph-adapter.ts` 新增 `existsLangGraphTask(id)` 主键查 `tasks` 表；在 `pipeline.controller.ts` 的 `getOutput` / `getStages` 中替换原 `if (!row) 404` 逻辑：`row` 缺 + `ceceliaTaskId` 有 + events 空 → 调 `existsLangGraphTask`，存在返 pending，不存在 404。

**Tech Stack:** TypeScript, Express, pg, vitest, supertest。工作目录：`/Users/administrator/worktrees/zenithjoy/langgraph-output-adapter-2`。

**Spec:** `docs/superpowers/specs/2026-04-25-langgraph-output-adapter-design.md`

---

## File Structure

| 文件 | 作用 | 本 plan 改动 |
|------|------|-----|
| `apps/api/src/services/langgraph-adapter.ts` | LangGraph → zenithjoy 数据映射工具箱 | 新增 `existsLangGraphTask` |
| `apps/api/src/controllers/pipeline.controller.ts` | pipeline 路由 handler | `getOutput` + `getStages` 的 404 分支改造 |
| `apps/api/src/services/__tests__/langgraph-adapter.test.ts` | adapter 单测 | 新增 `existsLangGraphTask` 单测 describe |
| `apps/api/tests/pipeline.test.ts` | controller 集成测试 | 改 2 条老 404 测试 + 加 2 条新 pending 测试 |

全部在现有文件里追加 / 修改，不创建新文件。

---

### Task 1: `existsLangGraphTask` 单测（Red）

**Files:**
- Modify: `apps/api/src/services/__tests__/langgraph-adapter.test.ts`（文件末尾追加 describe）

- [ ] **Step 1: Write the failing test**

在 `apps/api/src/services/__tests__/langgraph-adapter.test.ts` 末尾追加：

```ts
import { vi } from 'vitest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../../db/connection';
import { existsLangGraphTask } from '../langgraph-adapter';

const mockQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('existsLangGraphTask', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns true when tasks 表有匹配行', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const ok = await existsLangGraphTask('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(ok).toBe(true);
    const call = mockQuery.mock.calls[0];
    expect(call[0]).toContain('tasks');
    expect(call[0]).toContain("task_type = 'content-pipeline'");
    expect(call[1]).toEqual(['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']);
  });

  it('returns false when tasks 表无匹配行', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const ok = await existsLangGraphTask('00000000-0000-0000-0000-000000000000');
    expect(ok).toBe(false);
  });
});
```

注意：文件顶部已有 `import { describe, it, expect } from 'vitest'`，不要重复；只追加需要的 `beforeEach`（在 `import { describe, it, expect, beforeEach } from 'vitest'` 里加 `beforeEach`）和 `vi`。如果顶部 import 里没有 `beforeEach`，把现有的 import 补成：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
```

并把 `vi.mock`、`pool`、`existsLangGraphTask` 的 import 放在顶部 import 块之后。

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/administrator/worktrees/zenithjoy/langgraph-output-adapter-2/apps/api && npx vitest run src/services/__tests__/langgraph-adapter.test.ts
```

Expected: FAIL，错误类似 `existsLangGraphTask is not a function` 或 `Cannot find module` 或 `does not export 'existsLangGraphTask'`。

- [ ] **Step 3: 暂不 commit**，进下一 Task 实现。

---

### Task 2: 实现 `existsLangGraphTask`（Green）

**Files:**
- Modify: `apps/api/src/services/langgraph-adapter.ts`（在 `fetchLangGraphEvents` 函数之后追加）

- [ ] **Step 1: 在 `langgraph-adapter.ts` 的 `fetchLangGraphEvents` 函数（~line 67-76）之后追加**

```ts
/**
 * 任务存在性探针：查 tasks 表确认 :id 是已派发的 content-pipeline 任务。
 * 用于 /output /stages 区分"LangGraph 任务刚触发无事件"（→ pending）
 * 与"任意 UUID 乱输"（→ 404）。
 */
export async function existsLangGraphTask(taskId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM tasks WHERE id = $1 AND task_type = 'content-pipeline' LIMIT 1`,
    [taskId]
  );
  return rows.length > 0;
}
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd /Users/administrator/worktrees/zenithjoy/langgraph-output-adapter-2/apps/api && npx vitest run src/services/__tests__/langgraph-adapter.test.ts
```

Expected: PASS 全绿（含原有 describe + 新 2 条）。

- [ ] **Step 3: Commit**

```bash
cd /Users/administrator/worktrees/zenithjoy/langgraph-output-adapter-2 && \
git add apps/api/src/services/langgraph-adapter.ts apps/api/src/services/__tests__/langgraph-adapter.test.ts && \
git commit -m "$(cat <<'EOF'
feat(adapter): existsLangGraphTask 查 tasks 表探测任务存在性

给 /output /stages 区分"任务已派发未出事件"（pending）和
"任意 UUID 乱输"（404）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `/output` 新行为测试（Red）

**Files:**
- Modify: `apps/api/tests/pipeline.test.ts:301-309`（替换原"404 when pipeline_run does not exist"为两条）

- [ ] **Step 1: 替换现有测试**

把 `apps/api/tests/pipeline.test.ts:301-309` 的 `it('should return 404 when pipeline_run does not exist', ...)` 整块替换为：

```ts
    it('should return pending when LangGraph task exists but no events yet', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })                              // pipeline_runs miss
        .mockResolvedValueOnce({ rows: [] })                              // cecelia_events empty
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });            // tasks exists

      const taskId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const response = await request(app).get(`/api/pipeline/${taskId}/output`);

      expect(response.status).toBe(200);
      expect(response.body.output.pipeline_id).toBe(taskId);
      expect(response.body.output.status).toBe('pending');
      expect(response.body.output.article_text).toBeNull();
      expect(response.body.output.cards_text).toBeNull();
      expect(response.body.output.image_urls).toEqual([]);
      expect(response.body.output.export_path).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return 404 when LangGraph task does not exist', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })                              // pipeline_runs miss
        .mockResolvedValueOnce({ rows: [] })                              // cecelia_events empty
        .mockResolvedValueOnce({ rows: [] });                             // tasks miss

      const response = await request(app).get(
        '/api/pipeline/00000000-0000-0000-0000-000000000000/output'
      );

      expect(response.status).toBe(404);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/administrator/worktrees/zenithjoy/langgraph-output-adapter-2/apps/api && npx vitest run tests/pipeline.test.ts -t "pending when LangGraph task exists"
```

Expected: FAIL，status 返回 404 而非 200（因为 controller 还没改）。

- [ ] **Step 3: 暂不 commit**。

---

### Task 4: `getOutput` 改造（Green）

**Files:**
- Modify: `apps/api/src/controllers/pipeline.controller.ts:254` 所在分支

- [ ] **Step 1: 确认 import**

在 `pipeline.controller.ts` 顶部 import `langgraph-adapter` 的那一行（找 `from '../services/langgraph-adapter'`），把 `existsLangGraphTask` 加入 named imports。例如：

```ts
import {
  fetchLangGraphEvents,
  buildOutputFromEvents,
  buildStagesFromEvents,
  overallStatusFromEvents,
  existsLangGraphTask,        // 新增
  isUuid,
} from '../services/langgraph-adapter';
```

（具体其它 symbol 以文件现有 import 为准，只加 `existsLangGraphTask`。）

- [ ] **Step 2: 改 `getOutput` 的 404 分支**

定位 `pipeline.controller.ts:254`：

```ts
      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
```

替换为：

```ts
      if (!row) {
        if (ceceliaTaskId && (await existsLangGraphTask(ceceliaTaskId))) {
          res.json({
            output: {
              pipeline_id: ceceliaTaskId,
              keyword: '',
              status: 'pending',
              article_text: null,
              cards_text: null,
              image_urls: [],
              export_path: null,
              images: null,
            },
          });
          return;
        }
        res.status(404).json({ error: 'Not found' });
        return;
      }
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
cd /Users/administrator/worktrees/zenithjoy/langgraph-output-adapter-2/apps/api && npx vitest run tests/pipeline.test.ts -t "output"
```

Expected: PASS，含新加的两条 + 原有 `/output` 组测试全绿。

- [ ] **Step 4: Commit**

```bash
cd /Users/administrator/worktrees/zenithjoy/langgraph-output-adapter-2 && \
git add apps/api/src/controllers/pipeline.controller.ts apps/api/tests/pipeline.test.ts && \
git commit -m "$(cat <<'EOF'
fix(pipeline): /output 无 pipeline_run 时查 tasks 表决定 pending 或 404

LangGraph 任务刚触发、cecelia_events 还没写入的瞬间，
用户访问 /output 应该看到 pending 而非 404。
tasks 表没匹配才 404。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `/stages` 新行为测试（Red）

**Files:**
- Modify: `apps/api/tests/pipeline.test.ts:349-357`（替换原"404 when pipeline_run does not exist"stages 版为两条）

- [ ] **Step 1: 替换现有测试**

把 `apps/api/tests/pipeline.test.ts:349-357` 的 `it('should return 404 when pipeline_run does not exist', ...)`（`/stages` describe 内的那条）整块替换为：

```ts
    it('should return pending when LangGraph task exists but no events yet', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })                              // pipeline_runs miss
        .mockResolvedValueOnce({ rows: [] })                              // cecelia_events empty
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });            // tasks exists

      const taskId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const response = await request(app).get(`/api/pipeline/${taskId}/stages`);

      expect(response.status).toBe(200);
      expect(response.body.stages).toEqual({});
      expect(response.body.overall_status).toBe('pending');
      expect(response.body.events).toEqual([]);
    });

    it('should return 404 when LangGraph task does not exist', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })                              // pipeline_runs miss
        .mockResolvedValueOnce({ rows: [] })                              // cecelia_events empty
        .mockResolvedValueOnce({ rows: [] });                             // tasks miss

      const response = await request(app).get(
        '/api/pipeline/00000000-0000-0000-0000-000000000000/stages'
      );

      expect(response.status).toBe(404);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/administrator/worktrees/zenithjoy/langgraph-output-adapter-2/apps/api && npx vitest run tests/pipeline.test.ts -t "stages"
```

Expected: FAIL，新加"pending when LangGraph task exists"返 404 而非 200（因为 `getStages` 还没改）。

- [ ] **Step 3: 暂不 commit**。

---

### Task 6: `getStages` 改造（Green）

**Files:**
- Modify: `apps/api/src/controllers/pipeline.controller.ts:337` 所在分支

- [ ] **Step 1: 改 `getStages` 的 404 分支**

定位 `pipeline.controller.ts:337`：

```ts
      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
```

替换为：

```ts
      if (!row) {
        if (ceceliaTaskId && (await existsLangGraphTask(ceceliaTaskId))) {
          res.json({ stages: {}, overall_status: 'pending', events: [] });
          return;
        }
        res.status(404).json({ error: 'Not found' });
        return;
      }
```

（`existsLangGraphTask` 已在 Task 4 Step 1 加进 import，此处无需再改 import。）

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd /Users/administrator/worktrees/zenithjoy/langgraph-output-adapter-2/apps/api && npx vitest run tests/pipeline.test.ts -t "stages"
```

Expected: PASS，含新加两条 + 原有 `/stages` 组测试全绿。

- [ ] **Step 3: Commit**

```bash
cd /Users/administrator/worktrees/zenithjoy/langgraph-output-adapter-2 && \
git add apps/api/src/controllers/pipeline.controller.ts apps/api/tests/pipeline.test.ts && \
git commit -m "$(cat <<'EOF'
fix(pipeline): /stages 无 pipeline_run 时查 tasks 表决定 pending 或 404

对齐 /output 的修复：LangGraph 任务刚触发、无事件时
返回 { stages: {}, overall_status: 'pending', events: [] }。
tasks 表没匹配才 404。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 全量验证 + 类型检查

**Files:** 无改动。

- [ ] **Step 1: 跑全量 api 测试**

```bash
cd /Users/administrator/worktrees/zenithjoy/langgraph-output-adapter-2/apps/api && npm test
```

Expected: 全绿。无任何 FAIL。

- [ ] **Step 2: 类型检查**

```bash
cd /Users/administrator/worktrees/zenithjoy/langgraph-output-adapter-2/apps/api && npm run typecheck
```

Expected: 无输出、exit 0。

- [ ] **Step 3: Lint**

```bash
cd /Users/administrator/worktrees/zenithjoy/langgraph-output-adapter-2/apps/api && npm run lint
```

Expected: 无 error（warning 可接受）。有 error 则修复后重跑。

- [ ] **Step 4: 检查 git log 干净**

```bash
cd /Users/administrator/worktrees/zenithjoy/langgraph-output-adapter-2 && git log --oneline main..HEAD
```

Expected: 4 个 commit（spec + existsLangGraphTask + /output 修复 + /stages 修复）。

---

## Self-Review 已跑

- **Spec coverage**：
  - Spec §"新增 `existsLangGraphTask`" → Task 1 + 2 ✓
  - Spec §"`getOutput` 404 分支改造" → Task 3 + 4 ✓
  - Spec §"`getStages` 404 分支改造" → Task 5 + 6 ✓
  - Spec §"测试" → Task 1 (adapter 单测) + Task 3/5 (controller 集成测试) ✓
  - Spec §"pending pipeline_id 用 ceceliaTaskId" → Task 4 Step 2 代码体现 ✓
- **Placeholder scan**：无 TBD/TODO/"similar to"。所有步骤含完整代码块或命令。
- **Type consistency**：
  - 函数名统一 `existsLangGraphTask`（所有 Task）
  - 参数类型 `string`，返回 `Promise<boolean>`
  - pending output 结构在 Task 3/4 一致：`{pipeline_id, keyword: '', status: 'pending', article_text: null, cards_text: null, image_urls: [], export_path: null, images: null}`
  - pending stages 结构在 Task 5/6 一致：`{stages: {}, overall_status: 'pending', events: []}`
- **mock 次序一致**：所有 404 测试都 mock 3 次 query（pipeline_runs → cecelia_events → tasks）。
