# 素材视频在线预览 + 混剪历史记录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 素材库点开视频能直接播；批量混剪的每一次 run 都能在历史里找回来，接着选候选或回看成片。

**Architecture:** 后端加一个 `GET /api/mashup/runs` 租户级列表端点（四态 stage 在 SQL 取事实、应用层派生），其余恢复路径全部复用既有端点；前端在 `MashupPage` 的组件内状态机里加一个 `history` 步，素材页 `Lightbox` 的 video 分支接上早就存在但没人调的 `GET /materials/:id/preview`。不加表、不加迁移、不加路由。

**Tech Stack:** Express + pg（`apps/api`）、React + react-query + vitest/@testing-library（`apps/dashboard`）、bash smoke（`.github/workflows/scripts/smoke/`）

**设计文档：** `docs/superpowers/specs/2026-09-21-mashup-history-video-preview-design.md`

**GP-Anchor:** `line05/batch_mashup#step2`

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `apps/api/src/routes/mashup.ts` | 新增 `GET /runs` 列表端点（其余不动） | 修改 |
| `apps/api/src/routes/__tests__/mashup.test.ts` | 新端点契约：鉴权、租户隔离、四态 stage、分页夹取 | 修改 |
| `apps/dashboard/src/api/mashup.api.ts` | `MashupRunSummary` 类型 + `listRuns()` | 修改 |
| `apps/dashboard/src/api/__tests__/mashup.api.test.ts` | `listRuns` 带 token、解包 `data.data` | 修改 |
| `apps/dashboard/src/api/materials.api.ts` | `MaterialPreview` 类型 + `getMaterialPreview()` | 修改 |
| `apps/dashboard/src/api/__tests__/materials.api.test.ts` | `getMaterialPreview` 带 token、走 `/preview` | 修改 |
| `apps/dashboard/src/pages/MashupPage.tsx` | `Step` 加 `'history'`、`HistoryStep` 组件、两个恢复回调、顶部双入口 | 修改 |
| `apps/dashboard/src/pages/MashupPage.HistoryStep.test.tsx` | 列表四态渲染 + 两条恢复路径的点击行为 | 新建 |
| `apps/dashboard/src/pages/MaterialsPage.tsx` | `Lightbox` video 分支三态播放 | 修改 |
| `apps/dashboard/src/pages/MaterialsPage.Lightbox.test.tsx` | 视频弹窗渲染 `<video>`、失败降级 | 新建 |
| `.github/workflows/scripts/smoke/mashup-history-smoke.sh` | 真库真服务打 `GET /mashup/runs` | 新建 |
| `product-map/product-map.yaml` + `product-map/generated/product-map.json` | 新 smoke 登记进 `batch_mashup.smoke_files` | 修改 |
| `.github/workflows/scripts/smoke-baseline.txt` | 新 smoke 进必绿基线 | 修改 |

---

### Task 1: 后端 `GET /api/mashup/runs` — 鉴权与空列表

**Files:**
- Modify: `apps/api/src/routes/mashup.ts`（在 `router.get('/runs/:id', ...)` 之前插入，该行现为 `:146`）
- Test: `apps/api/src/routes/__tests__/mashup.test.ts`

- [ ] **Step 1: Write the failing test**

在 `apps/api/src/routes/__tests__/mashup.test.ts` 末尾追加：

```ts
describe('GET /api/mashup/runs — 历史列表', () => {
  it('没有凭据 → 401', async () => {
    const r = await request(makeApp()).get('/api/mashup/runs');
    expect(r.status).toBe(401);
  });

  it('本租户没有 run → 空列表，不是 404', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockResolvedValue({ rows: [] });

    const r = await request(makeApp()).get('/api/mashup/runs').set('X-Upload-Token', TOKEN_A);

    expect(r.status).toBe(200);
    expect(r.body.data.items).toEqual([]);
    expect(r.body.data.count).toBe(0);
    // 租户永远从凭据反查，SQL 必须按 tenant_id 过滤
    const sql = (pool.query as any).mock.calls[0][0] as string;
    expect(sql).toMatch(/tenant_id\s*=\s*\$1/);
    expect((pool.query as any).mock.calls[0][1][0]).toBe('tenant-a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/routes/__tests__/mashup.test.ts -t '历史列表'`
Expected: FAIL — 404（端点不存在），断言 `expect(r.status).toBe(401)` 收到 404

- [ ] **Step 3: Write minimal implementation**

在 `apps/api/src/routes/mashup.ts` 中 `router.get('/runs/:id', ...)` 这一行**之前**插入：

```ts
  // ── GET /runs：本租户混剪历史（GP line05/batch_mashup 横切）──────────────
  //
  // 客户跑完一轮候选生成（真 LLM + 向量检索）离开页面就全丢了——run/candidates
  // 全是前端组件内存态。这个端点让历史找得回来：列表一次带出 stage 判定所需的
  // 全部事实，点进去的恢复走既有端点，不重跑生成。
  router.get('/runs', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;

    const rawLimit = Number(req.query.limit);
    const rawOffset = Number(req.query.offset);
    // 越界夹取不报错，与 materials.ts 同口径
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 20;
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.trunc(rawOffset) : 0;

    const { rows } = await pool.query(
      `SELECT r.id, r.template_id, r.status, r.created_at, r.selected_candidate_id,
              (SELECT COUNT(*) FROM zenithjoy.mashup_candidates c WHERE c.run_id = r.id) AS candidate_count,
              (SELECT c.thumbnail_url FROM zenithjoy.mashup_candidates c
                WHERE c.run_id = r.id AND c.thumbnail_url IS NOT NULL
                ORDER BY c.score DESC LIMIT 1) AS thumbnail_url,
              EXISTS (SELECT 1 FROM zenithjoy.contents ct
                       WHERE ct.source_candidate_id = r.selected_candidate_id
                         AND ct.export_url IS NOT NULL) AS has_export
         FROM zenithjoy.mashup_runs r
        WHERE r.tenant_id = $1
        ORDER BY r.created_at DESC
        LIMIT $2 OFFSET $3`,
      [auth.tenantId, limit, offset],
    );

    const items = rows.map((r: {
      id: string; template_id: string; status: string; created_at: Date | string;
      selected_candidate_id: string | null; candidate_count: string | number;
      thumbnail_url: string | null; has_export: boolean;
    }) => {
      const candidateCount = Number(r.candidate_count);
      return {
        runId: r.id,
        templateId: r.template_id,
        status: r.status,
        stage: deriveStage(r.selected_candidate_id, r.has_export, candidateCount),
        createdAt: new Date(r.created_at).toISOString(),
        candidateCount,
        thumbnailUrl: r.thumbnail_url ?? null,
        selectedCandidateId: r.selected_candidate_id ?? null,
      };
    });

    ok(res, { items, limit, offset, count: items.length });
  });

```

并在 `createMashupRouter` **之外**（文件顶部工具函数区，紧跟 `function ok(...)` 之后）加入：

```ts
export type MashupRunStage = 'completed' | 'rendering' | 'candidates_pending' | 'assigned';

/**
 * 「已完成」以 contents.export_url 非空为准，不看 mashup_runs.status——status 列
 * 没有 CHECK 约束、由应用层写，而 export_url 是内容安全 Gate fail-closed 之后
 * 才写入的（20260919_030000_mashup_export_gate.sql）。用 status 判会把「渲染跑完
 * 但被 Gate 拦下」的 run 显示成已完成，客户点进去看不到片子。
 */
export function deriveStage(
  selectedCandidateId: string | null,
  hasExport: boolean,
  candidateCount: number,
): MashupRunStage {
  if (selectedCandidateId) return hasExport ? 'completed' : 'rendering';
  return candidateCount > 0 ? 'candidates_pending' : 'assigned';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/routes/__tests__/mashup.test.ts -t '历史列表'`
Expected: PASS（2 passed）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/mashup.ts apps/api/src/routes/__tests__/mashup.test.ts
git commit -m "feat(mashup): GET /runs 租户级混剪历史列表端点

GP-Anchor: line05/batch_mashup#step2"
```

---

### Task 2: 后端四态 stage 与租户隔离

**Files:**
- Modify: `apps/api/src/routes/mashup.ts`（本任务不改实现，只验证 Task 1 的 `deriveStage`）
- Test: `apps/api/src/routes/__tests__/mashup.test.ts`

- [ ] **Step 1: Write the failing test**

追加到上一个 `describe('GET /api/mashup/runs — 历史列表')` 块内：

```ts
  const runRow = (over: Record<string, unknown>) => ({
    id: 'run-1', template_id: 'tmpl-1', status: 'completed',
    created_at: '2026-09-20T10:00:00.000Z', selected_candidate_id: null,
    candidate_count: '0', thumbnail_url: null, has_export: false,
    ...over,
  });

  it.each([
    ['completed', { selected_candidate_id: 'cand-1', has_export: true, candidate_count: '3' }],
    ['rendering', { selected_candidate_id: 'cand-1', has_export: false, candidate_count: '3' }],
    ['candidates_pending', { selected_candidate_id: null, has_export: false, candidate_count: '3' }],
    ['assigned', { selected_candidate_id: null, has_export: false, candidate_count: '0' }],
  ])('stage 派生为 %s', async (expected, over) => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockResolvedValue({ rows: [runRow(over)] });

    const r = await request(makeApp()).get('/api/mashup/runs').set('X-Upload-Token', TOKEN_A);

    expect(r.status).toBe(200);
    expect(r.body.data.items[0].stage).toBe(expected);
  });

  it('渲染跑完但被安全 Gate 拦下（export_url 为空）不算已完成', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    // status 写着 completed，但 contents 没有 export_url ——以 export 为准
    (pool.query as any).mockResolvedValue({
      rows: [runRow({ status: 'completed', selected_candidate_id: 'cand-1', has_export: false })],
    });

    const r = await request(makeApp()).get('/api/mashup/runs').set('X-Upload-Token', TOKEN_A);

    expect(r.body.data.items[0].stage).toBe('rendering');
    expect(r.body.data.items[0].stage).not.toBe('completed');
  });

  it('不把成片地址塞进列表响应', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockResolvedValue({
      rows: [runRow({ selected_candidate_id: 'cand-1', has_export: true, candidate_count: '2' })],
    });

    const r = await request(makeApp()).get('/api/mashup/runs').set('X-Upload-Token', TOKEN_A);

    expect(JSON.stringify(r.body)).not.toMatch(/exportUrl|downloadUrl/);
  });

  it('limit 越界夹到 100，不报错', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockResolvedValue({ rows: [] });

    const r = await request(makeApp()).get('/api/mashup/runs?limit=9999').set('X-Upload-Token', TOKEN_A);

    expect(r.status).toBe(200);
    expect(r.body.data.limit).toBe(100);
    expect((pool.query as any).mock.calls[0][1][1]).toBe(100);
  });
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `cd apps/api && npx vitest run src/routes/__tests__/mashup.test.ts -t '历史列表'`
Expected: PASS —— Task 1 的实现已覆盖这些行为。**若任何一条失败，修 `deriveStage` 或端点实现，不要改测试。**

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/__tests__/mashup.test.ts
git commit -m "test(mashup): GET /runs 四态 stage + Gate 拦截不算完成 + 分页夹取

GP-Anchor: line05/batch_mashup#step2"
```

---

### Task 3: 前端 `listRuns()` API 封装

**Files:**
- Modify: `apps/dashboard/src/api/mashup.api.ts`
- Test: `apps/dashboard/src/api/__tests__/mashup.api.test.ts`

- [ ] **Step 1: Write the failing test**

在 `apps/dashboard/src/api/__tests__/mashup.api.test.ts` 的 import 块加入 `listRuns`，并在文件末尾追加：

```ts
describe('listRuns', () => {
  it('带 X-Upload-Token 调 GET /mashup/runs 并解包 data.data', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/account/me') return { data: { license: { license_key: 'ZJ-F-TESTKEY' } } };
      if (url === '/mashup/runs') {
        return {
          data: {
            data: {
              items: [{
                runId: 'run-1', templateId: 'tmpl-1', status: 'completed',
                stage: 'candidates_pending', createdAt: '2026-09-20T10:00:00.000Z',
                candidateCount: 3, thumbnailUrl: null, selectedCandidateId: null,
              }],
              limit: 20, offset: 0, count: 1,
            },
          },
        };
      }
      throw new Error('unexpected GET ' + url);
    });

    const result = await listRuns();

    expect(result.items[0].stage).toBe('candidates_pending');
    const call = get.mock.calls.find((c: unknown[]) => c[0] === '/mashup/runs');
    expect((call?.[1] as { headers: Record<string, string> }).headers['X-Upload-Token']).toBe('ZJ-F-TESTKEY');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && npx vitest run src/api/__tests__/mashup.api.test.ts -t listRuns`
Expected: FAIL — `listRuns is not a function` / import 解析失败

- [ ] **Step 3: Write minimal implementation**

在 `apps/dashboard/src/api/mashup.api.ts` 的类型区（紧跟 `export interface MashupRun {...}` 之后）加入：

```ts
/** 历史列表里一条 run 的摘要。stage 由服务端按库里事实派生，前端不再自己判。 */
export type MashupRunStage = 'completed' | 'rendering' | 'candidates_pending' | 'assigned';

export interface MashupRunSummary {
  runId: string;
  templateId: string;
  status: RunStatus;
  stage: MashupRunStage;
  createdAt: string;
  candidateCount: number;
  thumbnailUrl: string | null;
  selectedCandidateId: string | null;
}

export interface MashupRunListResult {
  items: MashupRunSummary[];
  limit: number;
  offset: number;
  count: number;
}
```

在请求区（紧跟 `export async function getRun(...)` 之后）加入：

```ts
/** 本租户的混剪历史，最新的在前。租户由服务端从凭据反查，前端传什么都不作数。 */
export async function listRuns(params: { limit?: number; offset?: number } = {}): Promise<MashupRunListResult> {
  const opts = await authHeaders();
  const { data } = await apiClient.get<{ data: MashupRunListResult }>('/mashup/runs', {
    ...opts,
    params: { limit: params.limit, offset: params.offset },
  });
  return data.data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && npx vitest run src/api/__tests__/mashup.api.test.ts`
Expected: PASS（全文件绿）

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/api/mashup.api.ts apps/dashboard/src/api/__tests__/mashup.api.test.ts
git commit -m "feat(mashup): 前端 listRuns 历史列表封装

GP-Anchor: line05/batch_mashup#step2"
```

---

### Task 4: `HistoryStep` 组件 — 列表渲染

**Files:**
- Modify: `apps/dashboard/src/pages/MashupPage.tsx`
- Test: `apps/dashboard/src/pages/MashupPage.HistoryStep.test.tsx`（新建）

- [ ] **Step 1: Write the failing test**

新建 `apps/dashboard/src/pages/MashupPage.HistoryStep.test.tsx`：

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { HistoryStep } from './MashupPage';
import type { MashupRunSummary } from '../api/mashup.api';

/**
 * 混剪历史记录 —— run 过去全是组件内存态，刷新即丢，客户跑完候选生成离开就得
 * 从头再来。本组件测试覆盖：四态徽章渲染、点击把 run 交回页面恢复。
 */
afterEach(() => {
  cleanup();
});

const run = (over: Partial<MashupRunSummary>): MashupRunSummary => ({
  runId: 'run-1', templateId: 'tmpl-1', status: 'completed',
  stage: 'candidates_pending', createdAt: '2026-09-20T10:00:00.000Z',
  candidateCount: 3, thumbnailUrl: null, selectedCandidateId: null,
  ...over,
});

describe('MashupPage HistoryStep — 混剪历史 [BEHAVIOR]', () => {
  it('没有历史时给出引导文案，不是空白页', () => {
    render(<HistoryStep runs={[]} loading={false} onOpen={vi.fn()} onNew={vi.fn()} />);
    expect(screen.getByText(/还没有混剪记录/)).toBeTruthy();
  });

  it('四种状态各自显示可读徽章', () => {
    render(
      <HistoryStep
        runs={[
          run({ runId: 'r-done', stage: 'completed', selectedCandidateId: 'c-1' }),
          run({ runId: 'r-render', stage: 'rendering', selectedCandidateId: 'c-2' }),
          run({ runId: 'r-pending', stage: 'candidates_pending' }),
          run({ runId: 'r-assigned', stage: 'assigned', candidateCount: 0 }),
        ]}
        loading={false}
        onOpen={vi.fn()}
        onNew={vi.fn()}
      />,
    );
    expect(screen.getByText('已完成')).toBeTruthy();
    expect(screen.getByText('渲染中')).toBeTruthy();
    expect(screen.getByText('候选待选定')).toBeTruthy();
    expect(screen.getByText('待生成候选')).toBeTruthy();
  });

  it('有缩略图就显示，没有则占位不渲染破图', () => {
    render(
      <HistoryStep
        runs={[
          run({ runId: 'r-1', thumbnailUrl: 'https://thumb.example/a.jpg' }),
          run({ runId: 'r-2', thumbnailUrl: null }),
        ]}
        loading={false}
        onOpen={vi.fn()}
        onNew={vi.fn()}
      />,
    );
    const imgs = document.querySelectorAll('img');
    expect(imgs.length).toBe(1);
    expect(imgs[0].getAttribute('src')).toBe('https://thumb.example/a.jpg');
  });

  it('点一条记录把整个 run 交回页面', () => {
    const onOpen = vi.fn();
    const target = run({ runId: 'r-pending', stage: 'candidates_pending' });
    render(<HistoryStep runs={[target]} loading={false} onOpen={onOpen} onNew={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /候选待选定/ }));

    expect(onOpen).toHaveBeenCalledWith(target);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && npx vitest run src/pages/MashupPage.HistoryStep.test.tsx`
Expected: FAIL — `HistoryStep` 不是 `./MashupPage` 的导出

- [ ] **Step 3: Write minimal implementation**

在 `apps/dashboard/src/pages/MashupPage.tsx` 末尾（`ResultStep` 之后）加入组件，并在文件顶部的 `import ... from '../api/mashup.api'` 里补上 `type MashupRunSummary`：

```tsx
const STAGE_LABEL: Record<MashupRunSummary['stage'], string> = {
  completed: '已完成',
  rendering: '渲染中',
  candidates_pending: '候选待选定',
  assigned: '待生成候选',
};

const STAGE_CLASS: Record<MashupRunSummary['stage'], string> = {
  completed: 'bg-green-100 text-green-700',
  rendering: 'bg-amber-100 text-amber-700',
  candidates_pending: 'bg-blue-100 text-blue-700',
  assigned: 'bg-gray-100 text-gray-600',
};

function formatRunTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function HistoryStep(props: {
  runs: MashupRunSummary[];
  loading: boolean;
  onOpen: (run: MashupRunSummary) => void;
  onNew: () => void;
}) {
  const { runs, loading, onOpen, onNew } = props;

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-400">加载中…</div>;
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center">
        <p className="text-sm text-gray-500">还没有混剪记录</p>
        <button
          type="button"
          onClick={onNew}
          className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          新建一次混剪
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {runs.map((r) => (
        <button
          key={r.runId}
          type="button"
          onClick={() => onOpen(r)}
          className="flex w-full items-center gap-3 rounded-lg border border-gray-200 p-3 text-left hover:border-blue-400 hover:bg-blue-50/40"
        >
          <div className="h-14 w-20 shrink-0 overflow-hidden rounded bg-gray-100">
            {r.thumbnailUrl ? (
              <img src={r.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-gray-300">
                <Layers className="h-5 w-5" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[11px] ${STAGE_CLASS[r.stage]}`}>
                {STAGE_LABEL[r.stage]}
              </span>
              <span className="text-xs text-gray-400">{formatRunTime(r.createdAt)}</span>
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {r.candidateCount > 0 ? `${r.candidateCount} 个候选方案` : '尚未生成候选'}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
```

`Layers` 图标从 `lucide-react` 导入——在文件顶部已有的 `import { ... } from 'lucide-react'` 里补上 `Layers`。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && npx vitest run src/pages/MashupPage.HistoryStep.test.tsx`
Expected: PASS（4 passed）

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/pages/MashupPage.tsx apps/dashboard/src/pages/MashupPage.HistoryStep.test.tsx
git commit -m "feat(mashup): HistoryStep 历史列表组件（四态徽章+缩略图占位）

GP-Anchor: line05/batch_mashup#step2"
```

---

### Task 5: 历史恢复接线 — 候选态不重跑生成

**Files:**
- Modify: `apps/dashboard/src/pages/MashupPage.tsx`（`MashupPage` 组件体，`:92-277`）
- Test: `apps/dashboard/src/pages/MashupPage.HistoryStep.test.tsx`

- [ ] **Step 1: Write the failing test**

追加到 `MashupPage.HistoryStep.test.tsx`。注意这里测的是导出的纯函数 `resolveHistoryTarget`，不是整页渲染——恢复逻辑是"调哪个接口、落哪一步"的判断，把它从组件里拎出来单独测，比挂载整页去 mock 四个 query 可靠得多：

```tsx
import { resolveHistoryTarget } from './MashupPage';

describe('resolveHistoryTarget — 历史恢复落点 [BEHAVIOR]', () => {
  it('候选待选定 → 走 listCandidates 恢复候选页，绝不调生成接口', async () => {
    const listCandidates = vi.fn().mockResolvedValue({ runId: 'r-1', candidates: [{ id: 'c-1' }] });
    const getRun = vi.fn().mockResolvedValue({ runId: 'r-1', templateId: 't-1', status: 'completed', assignments: [] });
    const generateCandidates = vi.fn();
    const getCandidateDetail = vi.fn();

    const target = await resolveHistoryTarget(
      run({ runId: 'r-1', stage: 'candidates_pending', candidateCount: 3 }),
      { getRun, listCandidates, getCandidateDetail, generateCandidates },
    );

    expect(target.step).toBe('candidates');
    expect(listCandidates).toHaveBeenCalledWith('r-1');
    expect(generateCandidates).not.toHaveBeenCalled();
  });

  it('已完成 → 取候选详情里的 content 落成片页', async () => {
    const content = { contentId: 'ct-1', safetyCheckStatus: 'passed', watermarkCheckStatus: 'passed', downloadUrl: 'https://cdn/a.mp4' };
    const getCandidateDetail = vi.fn().mockResolvedValue({ id: 'c-1', content });

    const target = await resolveHistoryTarget(
      run({ runId: 'r-1', stage: 'completed', selectedCandidateId: 'c-1' }),
      { getRun: vi.fn(), listCandidates: vi.fn(), getCandidateDetail, generateCandidates: vi.fn() },
    );

    expect(target.step).toBe('result');
    expect(getCandidateDetail).toHaveBeenCalledWith('c-1');
    expect(target.renderResult).toEqual(content);
  });

  it('渲染中但 contents 行还没写 → 按待复核呈现，不裸崩', async () => {
    const getCandidateDetail = vi.fn().mockResolvedValue({ id: 'c-1', content: null });

    const target = await resolveHistoryTarget(
      run({ runId: 'r-1', stage: 'rendering', selectedCandidateId: 'c-1' }),
      { getRun: vi.fn(), listCandidates: vi.fn(), getCandidateDetail, generateCandidates: vi.fn() },
    );

    expect(target.step).toBe('result');
    expect(target.renderResult?.safetyCheckStatus).toBe('failed_pending_review');
  });

  it('只分了槽位没候选 → 回到分配页，由客户自己点生成', async () => {
    const getRun = vi.fn().mockResolvedValue({ runId: 'r-1', templateId: 't-1', status: 'completed', assignments: [] });
    const listCandidates = vi.fn();

    const target = await resolveHistoryTarget(
      run({ runId: 'r-1', stage: 'assigned', candidateCount: 0 }),
      { getRun, listCandidates, getCandidateDetail: vi.fn(), generateCandidates: vi.fn() },
    );

    expect(target.step).toBe('assigned');
    expect(getRun).toHaveBeenCalledWith('r-1');
    expect(listCandidates).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && npx vitest run src/pages/MashupPage.HistoryStep.test.tsx -t resolveHistoryTarget`
Expected: FAIL — `resolveHistoryTarget` 不是 `./MashupPage` 的导出

- [ ] **Step 3: Write minimal implementation**

在 `apps/dashboard/src/pages/MashupPage.tsx` 的 `HistoryStep` 之前加入：

```tsx
/** 恢复历史 run 时要调的接口集合。显式传入而不是直接 import，便于单测锁"没调生成接口"。 */
export interface HistoryDeps {
  getRun: (runId: string) => Promise<MashupRun>;
  listCandidates: (runId: string) => Promise<CandidatesResult>;
  getCandidateDetail: (candidateId: string) => Promise<CandidateDetail>;
  generateCandidates: (runId: string, targetCount?: number) => Promise<CandidatesResult>;
}

export interface HistoryTarget {
  step: Step;
  run?: MashupRun;
  candidates?: CandidatesResult;
  renderResult?: RenderResult;
  selectedCandidateId?: string | null;
}

/**
 * 历史记录点进去落到哪一步。
 *
 * 要害在候选态走 listCandidates（GET）而不是 generateCandidates（POST）——客户
 * 等的就是不用重算向量、不用重拼缩略图。deps 显式传进来，测试才能断言
 * "生成接口一次都没被调用"。
 */
export async function resolveHistoryTarget(
  summary: MashupRunSummary,
  deps: HistoryDeps,
): Promise<HistoryTarget> {
  if (summary.selectedCandidateId) {
    const detail = await deps.getCandidateDetail(summary.selectedCandidateId);
    return {
      step: 'result',
      selectedCandidateId: summary.selectedCandidateId,
      // 落 render_failed 但还没写 contents 行——按未通过口径呈现，与
      // selectAndRenderMutation 同口径，不裸崩。
      renderResult: detail.content ?? {
        contentId: '',
        safetyCheckStatus: 'failed_pending_review',
        watermarkCheckStatus: 'failed_pending_review',
      },
    };
  }

  const run = await deps.getRun(summary.runId);
  if (summary.candidateCount > 0) {
    const candidates = await deps.listCandidates(summary.runId);
    return { step: 'candidates', run, candidates };
  }
  return { step: 'assigned', run };
}
```

在 `MashupPage` 组件体内（`resetAll` 函数之后）加入历史查询与打开回调：

```tsx
  const runsQuery = useQuery({
    queryKey: ['mashup', 'runs'],
    queryFn: () => listRuns({ limit: 50 }),
    enabled: step === 'history',
    staleTime: 30 * 1000,
  });

  const openHistoryMutation = useMutation({
    mutationFn: (summary: MashupRunSummary) =>
      resolveHistoryTarget(summary, { getRun, listCandidates, getCandidateDetail, generateCandidates }),
    onSuccess: (target) => {
      if (target.run) setRun(target.run);
      if (target.candidates) setCandidates(target.candidates);
      if (target.renderResult) setRenderResult(target.renderResult);
      if (target.selectedCandidateId !== undefined) setSelectedCandidateId(target.selectedCandidateId);
      setErrorMsg(null);
      setStep(target.step);
    },
    onError: (e) => setErrorMsg(extractErrorMessage(e, '打开历史记录失败')),
  });
```

在渲染区（`{step === 'pick' ? ... }` 之前）加入双入口与历史步渲染：

```tsx
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => { resetAll(); setStep('pick'); }}
          className={`rounded-md px-3 py-1.5 text-sm ${step === 'history' ? 'text-gray-600 hover:bg-gray-100' : 'bg-blue-600 text-white'}`}
        >
          新建
        </button>
        <button
          type="button"
          onClick={() => setStep('history')}
          className={`rounded-md px-3 py-1.5 text-sm ${step === 'history' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          历史记录
        </button>
      </div>

      {step === 'history' ? (
        <HistoryStep
          runs={runsQuery.data?.items ?? []}
          loading={runsQuery.isLoading || openHistoryMutation.isPending}
          onOpen={(r) => openHistoryMutation.mutate(r)}
          onNew={() => { resetAll(); setStep('pick'); }}
        />
      ) : null}
```

把 `Step` 类型（`:47`）改为：

```ts
type Step = 'pick' | 'assigned' | 'candidates' | 'result' | 'history';
```

并在 `StepBar`（`:72`）里对 `history` 直接返回 `null`（历史不是流程中的一步，不该画进进度条）：

```tsx
function StepBar({ step }: { step: Step }) {
  if (step === 'history') return null;
```

顶部 import 补上 `listRuns` 与 `type MashupRunSummary`、`type CandidateDetail`、`type RenderResult`（按文件里已有的 import 形式合并进同一个 `from '../api/mashup.api'`）。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && npx vitest run src/pages/MashupPage.HistoryStep.test.tsx && npx tsc --noEmit`
Expected: 测试 8 passed；`tsc` 无输出（0 错误）

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/pages/MashupPage.tsx apps/dashboard/src/pages/MashupPage.HistoryStep.test.tsx
git commit -m "feat(mashup): 历史记录恢复接线——候选态走 listCandidates 不重跑生成

GP-Anchor: line05/batch_mashup#step2"
```

---

### Task 6: 素材预览 API 封装

**Files:**
- Modify: `apps/dashboard/src/api/materials.api.ts`
- Test: `apps/dashboard/src/api/__tests__/materials.api.test.ts`

- [ ] **Step 1: Write the failing test**

在 `apps/dashboard/src/api/__tests__/materials.api.test.ts` 末尾追加（import 块补上 `getMaterialPreview`）：

```ts
describe('getMaterialPreview', () => {
  it('带 X-Upload-Token 调 GET /materials/:id/preview 并解包', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/account/me') return { data: { license: { license_key: 'ZJ-F-TESTKEY' } } };
      if (url === '/materials/mat-1/preview') {
        return {
          data: {
            data: {
              materialId: 'mat-1',
              previewUrl: 'https://cos.example/mat-1.mp4?sig=x',
              previewAvailable: true,
              expiresAt: '2026-09-21T12:00:00.000Z',
            },
          },
        };
      }
      throw new Error('unexpected GET ' + url);
    });

    const result = await getMaterialPreview('mat-1');

    expect(result.previewUrl).toBe('https://cos.example/mat-1.mp4?sig=x');
    const call = get.mock.calls.find((c: unknown[]) => c[0] === '/materials/mat-1/preview');
    expect((call?.[1] as { headers: Record<string, string> }).headers['X-Upload-Token']).toBe('ZJ-F-TESTKEY');
  });
});
```

该文件顶部已有 `const { get } = vi.hoisted(() => ({ get: vi.fn() }))` + `vi.mock('../client', ...)`（`materials.api.test.ts:14-15`），上面的测试直接沿用这个 `get` 桩，不要再建第二套。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && npx vitest run src/api/__tests__/materials.api.test.ts -t getMaterialPreview`
Expected: FAIL — `getMaterialPreview is not a function`

- [ ] **Step 3: Write minimal implementation**

在 `apps/dashboard/src/api/materials.api.ts` 的类型区加入：

```ts
export interface MaterialPreview {
  materialId: string;
  /** 现签的临时地址；null = 签发失败（storage_key 失效/未配存储）。 */
  previewUrl: string | null;
  /** 服务端按 mime 判的"可播"。前端不拿它当播放开关——见 getMaterialPreview 注释。 */
  previewAvailable: boolean;
  expiresAt: string;
}
```

在请求区加入：

```ts
/**
 * 打开详情弹窗时现签一个预览地址。
 *
 * 不复用列表里的 preview_url：那是列表渲染时签的，TTL 1 小时、前端还缓存 5 分钟，
 * 弹窗打开那一刻可能已经过期，<video> 拿到过期 URL 只会黑屏。
 */
export async function getMaterialPreview(materialId: string): Promise<MaterialPreview> {
  const token = await getUploadToken();
  const { data } = await apiClient.get<{ data: MaterialPreview }>(
    `/materials/${materialId}/preview`,
    { headers: { 'X-Upload-Token': token } },
  );
  return data.data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && npx vitest run src/api/__tests__/materials.api.test.ts`
Expected: PASS（全文件绿）

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/api/materials.api.ts apps/dashboard/src/api/__tests__/materials.api.test.ts
git commit -m "feat(materials): getMaterialPreview 现签预览地址封装

GP-Anchor: line05/batch_mashup#step2"
```

---

### Task 7: 素材弹窗内联播放视频

**Files:**
- Modify: `apps/dashboard/src/pages/MaterialsPage.tsx`（`Lightbox`，`:73-122`；文件头注释 `:9-11`）
- Test: `apps/dashboard/src/pages/MaterialsPage.Lightbox.test.tsx`（新建）

- [ ] **Step 1: Write the failing test**

新建 `apps/dashboard/src/pages/MaterialsPage.Lightbox.test.tsx`：

```tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { Lightbox } from './MaterialsPage';
import type { Material } from '../api/materials.api';

const { getMaterialPreview } = vi.hoisted(() => ({ getMaterialPreview: vi.fn() }));
vi.mock('../api/materials.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/materials.api')>()),
  getMaterialPreview,
}));

/**
 * 素材视频在线预览 —— 决策 1a20f778 否掉的是"网格里每条都 ffmpeg 抽帧"，
 * 不是"点开播放"；后端 GET /materials/:id/preview 早就为播放写好了，前端没接。
 */
const VIDEO: Material = {
  id: 'mat-1', file_name: 'clip.mp4', size_bytes: 1024, mime_type: 'video/mp4',
  taken_at: null, created_at: '2026-09-20T10:00:00.000Z', preview_url: 'https://stale.example/old.mp4',
};

beforeEach(() => {
  getMaterialPreview.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('MaterialsPage Lightbox — 视频在线预览 [BEHAVIOR]', () => {
  it('打开视频弹窗渲染 <video controls>，src 来自现签地址而非列表里的旧地址', async () => {
    getMaterialPreview.mockResolvedValue({
      materialId: 'mat-1', previewUrl: 'https://fresh.example/new.mp4', previewAvailable: true,
      expiresAt: '2026-09-21T12:00:00.000Z',
    });

    render(<Lightbox item={VIDEO} onClose={vi.fn()} />);

    await waitFor(() => expect(document.querySelector('video')).toBeTruthy());
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('https://fresh.example/new.mp4');
    expect(video.hasAttribute('controls')).toBe(true);
    expect(getMaterialPreview).toHaveBeenCalledWith('mat-1');
  });

  it('后端说 previewAvailable=false 但签出了地址 → 仍然播（快捷指令传 octet-stream 的视频）', async () => {
    getMaterialPreview.mockResolvedValue({
      materialId: 'mat-1', previewUrl: 'https://fresh.example/new.mov', previewAvailable: false,
      expiresAt: '2026-09-21T12:00:00.000Z',
    });

    render(<Lightbox item={{ ...VIDEO, mime_type: 'application/octet-stream', file_name: 'clip.mov' }} onClose={vi.fn()} />);

    await waitFor(() => expect(document.querySelector('video')).toBeTruthy());
  });

  it('签发失败（previewUrl 为 null）→ 占位文案，绝不把 null 塞进 src', async () => {
    getMaterialPreview.mockResolvedValue({
      materialId: 'mat-1', previewUrl: null, previewAvailable: false, expiresAt: '2026-09-21T12:00:00.000Z',
    });

    render(<Lightbox item={VIDEO} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/预览地址签发失败/)).toBeTruthy());
    expect(document.querySelector('video')).toBeNull();
  });

  it('浏览器解不了这个编码 → onError 降级占位，不留黑屏', async () => {
    getMaterialPreview.mockResolvedValue({
      materialId: 'mat-1', previewUrl: 'https://fresh.example/weird.avi', previewAvailable: true,
      expiresAt: '2026-09-21T12:00:00.000Z',
    });

    render(<Lightbox item={VIDEO} onClose={vi.fn()} />);

    await waitFor(() => expect(document.querySelector('video')).toBeTruthy());
    fireEvent.error(document.querySelector('video') as HTMLVideoElement);

    await waitFor(() => expect(screen.getByText(/这个视频浏览器放不了/)).toBeTruthy());
  });

  it('图片素材不受影响，照旧渲染 <img>，不调预览接口', async () => {
    render(
      <Lightbox
        item={{ ...VIDEO, file_name: 'photo.jpg', mime_type: 'image/jpeg', preview_url: 'https://img.example/p.jpg' }}
        onClose={vi.fn()}
      />,
    );

    expect(document.querySelector('img')).toBeTruthy();
    expect(getMaterialPreview).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && npx vitest run src/pages/MaterialsPage.Lightbox.test.tsx`
Expected: FAIL — `Lightbox` 不是 `./MaterialsPage` 的导出

- [ ] **Step 3: Write minimal implementation**

改 `apps/dashboard/src/pages/MaterialsPage.tsx`：

1. 顶部 import 补 `useEffect`，并把 `getMaterialPreview` 加进 `from '../api/materials.api'`。
2. 把 `function Lightbox` 改成 `export function Lightbox`，整体替换为：

```tsx
/**
 * 点开看大图 / 看视频。
 *
 * 视频用 GET /materials/:id/preview 现签地址，不复用列表里的 preview_url——后者
 * 签发时就在走 1 小时 TTL、前端还缓存 5 分钟，点开那一刻可能已过期。
 *
 * 播放与否只看"签出了地址"，不看服务端的 previewAvailable：后者只认
 * mime video/*，而 iPhone 快捷指令常把 .mov 传成 octet-stream——按它拦截就等于
 * 把能播的素材判死。播不动最多 onError 降级一次，拦错了客户永远看不到。
 */
export function Lightbox({ item, onClose }: { item: Material; onClose: () => void }) {
  const video = isVideo(item);
  const [preview, setPreview] = useState<{ status: 'loading' | 'ready' | 'unavailable'; url: string | null }>(
    video ? { status: 'loading', url: null } : { status: 'ready', url: item.preview_url },
  );

  useEffect(() => {
    if (!video) return;
    let alive = true;
    getMaterialPreview(item.id)
      .then((p) => {
        if (!alive) return;
        setPreview(p.previewUrl ? { status: 'ready', url: p.previewUrl } : { status: 'unavailable', url: null });
      })
      .catch(() => {
        if (alive) setPreview({ status: 'unavailable', url: null });
      });
    return () => { alive = false; };
  }, [video, item.id]);

  const [playbackFailed, setPlaybackFailed] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="presentation"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="max-h-full max-w-4xl" onClick={(e) => e.stopPropagation()} role="presentation">
        {video ? (
          preview.status === 'loading' ? (
            <div className="rounded-lg bg-gray-900 px-8 py-12 text-center text-gray-300">
              <Film className="mx-auto h-12 w-12 animate-pulse" />
              <p className="mt-3 text-sm">预览地址获取中…</p>
            </div>
          ) : preview.status === 'ready' && preview.url && !playbackFailed ? (
            <video
              src={preview.url}
              controls
              autoPlay={false}
              onError={() => setPlaybackFailed(true)}
              className="max-h-[80vh] w-full rounded-lg bg-black"
            />
          ) : (
            <div className="rounded-lg bg-gray-900 px-8 py-12 text-center text-gray-300">
              <Film className="mx-auto h-12 w-12" />
              <p className="mt-3 text-sm">
                {playbackFailed ? '这个视频浏览器放不了，用下面的链接下载后看' : '这条素材的预览地址签发失败'}
              </p>
            </div>
          )
        ) : item.preview_url ? (
          <img src={item.preview_url} alt={item.file_name} className="max-h-[80vh] rounded-lg object-contain" />
        ) : (
          <div className="rounded-lg bg-gray-900 px-8 py-12 text-center text-gray-300">
            <AlertTriangle className="mx-auto h-12 w-12" />
            <p className="mt-3 text-sm">这条素材的预览地址签发失败</p>
          </div>
        )}
        <div className="mt-3 text-center text-sm text-white">
          <div className="font-medium">{item.file_name}</div>
          <div className="text-white/60">
            {formatSize(item.size_bytes)}
            {item.taken_at ? ` · 拍摄于 ${formatTime(item.taken_at)}` : ''}
            {` · 上传于 ${formatTime(item.created_at)}`}
          </div>
          {preview.url ?? item.preview_url ? (
            <a
              href={preview.url ?? item.preview_url ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-blue-300 underline"
            >
              打开原文件
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
```

3. 把文件头注释（`:9-11`）里的取舍②改成与现状一致的说法：

```
 *  ② 网格里视频只显示图标 + 文件名，不出缩略图——抽帧转码要 ffmpeg + 异步任务 +
 *     缩略图存储，是独立的一件事。点开播放不需要抽帧（后端签的 URL 直接能喂
 *     <video>），所以弹窗里是能播的，被 1a20f778 挡住的只有网格缩略图。
```

4. `Tile` 组件（`:36` 的 `canPreview`）**不动**。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && npx vitest run src/pages/MaterialsPage.Lightbox.test.tsx && npx tsc --noEmit`
Expected: 测试 5 passed；`tsc` 0 错误

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/pages/MaterialsPage.tsx apps/dashboard/src/pages/MaterialsPage.Lightbox.test.tsx
git commit -m "feat(materials): 素材详情弹窗内联播放视频（现签地址+onError 降级）

GP-Anchor: line05/batch_mashup#step2"
```

---

### Task 8: smoke 脚本 + 三处登记

**Files:**
- Create: `.github/workflows/scripts/smoke/mashup-history-smoke.sh`
- Modify: `product-map/product-map.yaml`（`batch_mashup.smoke_files`，`:385-389`）
- Modify: `product-map/generated/product-map.json`（由 generate 命令产出，不手改）
- Modify: `.github/workflows/scripts/smoke-baseline.txt`

- [ ] **Step 1: 写 smoke 脚本**

新建 `.github/workflows/scripts/smoke/mashup-history-smoke.sh`（`chmod +x`）：

```bash
#!/usr/bin/env bash
# mashup-history-smoke.sh
#
# 批量混剪历史记录（GP line05/batch_mashup 横切）smoke：真库 + 真 API 进程，
# 锁 GET /api/mashup/runs 的两件事——
#   1. 租户隔离：A 租户的凭据看不到 B 租户的 run（与 materials 同口径，
#      这是整条链上最关键的闸）
#   2. stage 与库里事实一致：selected_candidate_id + contents.export_url
#      决定「已完成」，而不是 mashup_runs.status（后者无 CHECK 约束、
#      应用层随便写，用它判会把被安全 Gate 拦下的 run 显示成已完成）
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

fail() { echo "❌ FAIL: $*"; exit 1; }
ok()   { echo "  ✅ $*"; }

for bin in psql curl; do
  command -v "$bin" >/dev/null 2>&1 || fail "缺少必需命令：$bin"
done

if [ -n "${E2E_DATABASE_URL:-}" ]; then
  PGURL="$E2E_DATABASE_URL"
elif [ -n "${DATABASE_URL:-}" ]; then
  PGURL="$DATABASE_URL"
else
  PGURL="postgresql://${DATABASE_USER:-cecelia}:${DATABASE_PASSWORD:-cecelia}@${DATABASE_HOST:-localhost}:${DATABASE_PORT:-5432}/${DATABASE_NAME:-cecelia}"
fi
API_BASE="${API_BASE:-http://localhost:5200}"

psql_q() { psql "$PGURL" -t -A -q -c "$1"; }

psql "$PGURL" -v ON_ERROR_STOP=1 -q -c "SELECT 1" >/dev/null 2>&1 || fail "数据库连不上：$PGURL"
curl -sf "$API_BASE/health" >/dev/null 2>&1 || fail "API 没起来：$API_BASE"

SFX=$(date +%s)$RANDOM
TENANT_A="mhs-a-$SFX"
TENANT_B="mhs-b-$SFX"
KEY_A="ZJ-F-MHSA$SFX"
KEY_B="ZJ-F-MHSB$SFX"

seed_license() {
  psql_q "INSERT INTO zenithjoy.licenses (license_key, tenant_id, status, expires_at) \
    VALUES ('$1', '$2', 'active', NOW() + INTERVAL '1 day') RETURNING id"
}
LIC_A=$(seed_license "$KEY_A" "$TENANT_A")
LIC_B=$(seed_license "$KEY_B" "$TENANT_B")
[ -n "$LIC_A" ] && [ -n "$LIC_B" ] || fail "测试凭据未建成"
ok "两个租户的凭据已就位"

TMPL_ID=$(psql_q "SELECT id FROM zenithjoy.mashup_templates WHERE tenant_id IS NULL LIMIT 1")
[ -n "$TMPL_ID" ] || fail "内置模板未找到，migration 未生效"

seed_run() {  # $1=tenant
  psql_q "INSERT INTO zenithjoy.mashup_runs (tenant_id, template_id, status) \
    VALUES ('$1', '$TMPL_ID', 'completed') RETURNING id"
}
RUN_A_PENDING=$(seed_run "$TENANT_A")
RUN_A_GATED=$(seed_run "$TENANT_A")
RUN_B=$(seed_run "$TENANT_B")

seed_candidate() {  # $1=run_id $2=tenant
  psql_q "INSERT INTO zenithjoy.mashup_candidates (run_id, tenant_id, slot_fill, score, signature) \
    VALUES ('$1', '$2', '{}'::jsonb, 1.0, 'sig-$1') RETURNING id"
}
CAND_PENDING=$(seed_candidate "$RUN_A_PENDING" "$TENANT_A")
CAND_GATED=$(seed_candidate "$RUN_A_GATED" "$TENANT_A")
[ -n "$CAND_PENDING" ] && [ -n "$CAND_GATED" ] || fail "候选未建成"

# RUN_A_GATED：选了候选、渲染跑完，但安全 Gate 没过 → export_url 为 NULL
psql_q "UPDATE zenithjoy.mashup_runs SET selected_candidate_id = '$CAND_GATED' WHERE id = '$RUN_A_GATED'" >/dev/null
psql_q "INSERT INTO zenithjoy.contents (tenant_id, source_candidate_id, safety_check_status, watermark_check_status, export_url) \
  VALUES ('$TENANT_A', '$CAND_GATED', 'failed_pending_review', 'passed', NULL)" >/dev/null
ok "种子 run 已建成（候选待选定 1 条、被 Gate 拦下 1 条、B 租户 1 条）"

BODY_A=$(curl -sf -H "X-Upload-Token: $KEY_A" "$API_BASE/api/mashup/runs") || fail "GET /api/mashup/runs 请求失败"

echo "$BODY_A" | grep -q "$RUN_A_PENDING" || fail "A 租户看不到自己的 run $RUN_A_PENDING"
ok "A 租户看得到自己的 run"

echo "$BODY_A" | grep -q "$RUN_B" && fail "租户隔离破了：A 的凭据看到了 B 的 run $RUN_B"
ok "A 租户看不到 B 租户的 run（租户隔离成立）"

STAGE_GATED=$(echo "$BODY_A" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
const r=d.data.items.find(i=>i.runId==='$RUN_A_GATED');
process.stdout.write(r?r.stage:'MISSING');
")
[ "$STAGE_GATED" = "rendering" ] \
  || fail "被安全 Gate 拦下的 run 应为 rendering（export_url 为空），实际 $STAGE_GATED"
ok "status=completed 但 export_url 为空 → stage=rendering，没被误报成已完成"

STAGE_PENDING=$(echo "$BODY_A" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
const r=d.data.items.find(i=>i.runId==='$RUN_A_PENDING');
process.stdout.write(r?r.stage:'MISSING');
")
[ "$STAGE_PENDING" = "candidates_pending" ] \
  || fail "有候选未选定的 run 应为 candidates_pending，实际 $STAGE_PENDING"
ok "有候选未选定 → stage=candidates_pending"

curl -s -o /dev/null -w '%{http_code}' "$API_BASE/api/mashup/runs" | grep -q '^401$' \
  || fail "无凭据访问应回 401"
ok "无凭据 → 401"

psql_q "DELETE FROM zenithjoy.contents WHERE tenant_id IN ('$TENANT_A','$TENANT_B')" >/dev/null
psql_q "DELETE FROM zenithjoy.mashup_runs WHERE tenant_id IN ('$TENANT_A','$TENANT_B')" >/dev/null
psql_q "DELETE FROM zenithjoy.licenses WHERE license_key IN ('$KEY_A','$KEY_B')" >/dev/null

echo "✅ PASS: mashup-history-smoke"
```

已核对过的前提（写计划时查证，无需再查）：`zenithjoy.licenses` 列为 `id/license_key/tenant_id/status/expires_at`（`walking-skeleton.service.ts:189-191`）；健康检查路径 `/health`（`index.ts:75`）；`API_BASE` 默认端口 5200 是本仓库 smoke 的既有惯例（`my-works-api-smoke.sh:12`）。

- [ ] **Step 2: 本地跑一遍，确认它真能红**

```bash
chmod +x .github/workflows/scripts/smoke/mashup-history-smoke.sh
bash .github/workflows/scripts/smoke/mashup-history-smoke.sh
```

Expected: PASS。然后**故意把 `deriveStage` 里的 `hasExport ? 'completed' : 'rendering'` 改成恒返回 `'completed'`，重跑 smoke，必须看到它红**（`❌ FAIL: 被安全 Gate 拦下的 run 应为 rendering`）。看到红之后把代码改回来再跑一次绿。没亲眼见过它报红的守卫不算守卫。

- [ ] **Step 3: 三处登记**

`product-map/product-map.yaml` 的 `batch_mashup.smoke_files` 末尾追加一行：

```yaml
      - .github/workflows/scripts/smoke/mashup-history-smoke.sh
```

重新生成 JSON（用仓库既有命令，不要手改 generated 文件）：

```bash
npm run product-map:generate 2>/dev/null || npm run product-map:check
```

`.github/workflows/scripts/smoke-baseline.txt` 末尾追加一行：

```
mashup-history-smoke.sh
```

- [ ] **Step 4: 验证锚点闸会放行**

```bash
PR_BODY="GP-Anchor: line05/batch_mashup#step2" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main
```

Expected: `PASS: GP-Anchor 校验通过 (progressing: line05/batch_mashup)`

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/scripts/smoke/mashup-history-smoke.sh \
        .github/workflows/scripts/smoke-baseline.txt \
        product-map/product-map.yaml product-map/generated/product-map.json
git commit -m "test(mashup): 历史列表真库 smoke + 登记进 GP smoke_files 与必绿基线

GP-Anchor: line05/batch_mashup#step2"
```

---

### Task 9: 全量验证

**Files:** 无改动（除非发现问题）

- [ ] **Step 1: 两端测试 + 类型 + lint 全跑**

```bash
cd apps/api && npx vitest run src/routes/__tests__/mashup.test.ts && npx tsc --noEmit && npm run lint
cd ../dashboard && npx vitest run && npx tsc --noEmit && npm run lint
```

Expected: 全部 0 错误。任何一项红就地修，不要带着红往下走。

- [ ] **Step 2: 确认没有动不该动的东西**

```bash
git diff origin/main --stat
```

Expected: 只出现 File Structure 表里列的文件。出现别的（尤其是 `apps/dashboard/src/pages/MaterialsPage.tsx` 的 `Tile` 组件、任何 `db/migrations/`）→ 回退掉。

- [ ] **Step 3: Commit（若有修复）**

```bash
git add -A && git commit -m "fix(mashup): 全量验证发现的问题

GP-Anchor: line05/batch_mashup#step2"
```

---

## 完成后的交接

PR body 必须恰好含一行：

```
GP-Anchor: line05/batch_mashup#step2
```

Final E2E（`windows_cloud`）按设计文档「验收」四条逐条验。
