# Staff Hub 验收模块（前端）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Staff Hub 新增"验收"模块：列表页(待验收清单+角标)、详情页(矩阵总览+按Step分组答题+工作卡展开+提交)、历史页(按GP查历史)，反代层调用 Brain 新增的三个内网 acceptance 端点。

**Architecture:** `apps/api/src/services/acceptance.ts`（反代+降级）+ `apps/api/src/routes/staff.ts` 新增路由（沿用文件，不新建）；`apps/staff-hub/src/pages/{AcceptancePage,AcceptanceDetailPage,AcceptanceHistoryPage}.tsx`；`App.tsx` 加导航+路由。

**Tech Stack:** TypeScript, Express + axios（后端），React + Vite + react-router-dom（前端），vitest（单测），Playwright（E2E）。

---

### Task 1: 后端反代层 — `apps/api/src/services/acceptance.ts` + `routes/staff.ts` 路由

**Files:**
- Create: `apps/api/src/services/acceptance.ts`
- Create: `apps/api/src/services/__tests__/acceptance.test.ts`
- Modify: `apps/api/src/routes/staff.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/api/src/services/__tests__/acceptance.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

describe('acceptance service', () => {
  const origEnv = process.env.CECELIA_BRAIN_URL;
  beforeEach(() => {
    process.env.CECELIA_BRAIN_URL = 'http://brain.test';
    vi.clearAllMocks();
  });
  afterEach(() => {
    if (origEnv === undefined) delete process.env.CECELIA_BRAIN_URL;
    else process.env.CECELIA_BRAIN_URL = origEnv;
  });

  it('fetchPendingRuns: 正常返回 runs 数组，availability=ready', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { runs: [{ run_key: 'r1', checks: [] }] } });
    const { fetchPendingRuns } = await import('../acceptance');
    const result = await fetchPendingRuns();
    expect(result.availability).toBe('ready');
    expect(result.runs).toHaveLength(1);
    expect(mockedAxios.get).toHaveBeenCalledWith('http://brain.test/api/brain/acceptance/pending', expect.any(Object));
  });

  it('fetchPendingRuns: Brain 不可达时 availability=degraded，runs=[]，不抛异常', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const { fetchPendingRuns } = await import('../acceptance');
    const result = await fetchPendingRuns();
    expect(result.availability).toBe('degraded');
    expect(result.runs).toEqual([]);
    expect(result.message).toContain('Brain:');
  });

  it('fetchHistoryByGpId: 正常返回历史 runs', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { runs: [{ run_key: 'r1', version: '1.21' }] } });
    const { fetchHistoryByGpId } = await import('../acceptance');
    const result = await fetchHistoryByGpId('gp1');
    expect(result.availability).toBe('ready');
    expect(result.runs[0].run_key).toBe('r1');
  });

  it('fetchHistoryByGpId: Brain 不可达时 availability=degraded', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('timeout'));
    const { fetchHistoryByGpId } = await import('../acceptance');
    const result = await fetchHistoryByGpId('gp1');
    expect(result.availability).toBe('degraded');
    expect(result.runs).toEqual([]);
  });

  it('submitResults: 正常提交返回 Brain 响应体', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { updated: 1, runs: [{ run_key: 'r1', status: 'passed' }] } });
    const { submitResults } = await import('../acceptance');
    const result = await submitResults([{ check_key: 'r1:001', result: '通过' }], 'alice@zenjoymedia.media');
    expect(result.updated).toBe(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://brain.test/api/brain/acceptance/results',
      { results: [{ check_key: 'r1:001', result: '通过', submitted_by: 'alice@zenjoymedia.media' }] },
      expect.any(Object)
    );
  });

  it('submitResults: Brain 报错时异常必须冒泡（写路径不能伪装成功）', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('Brain 500'));
    const { submitResults } = await import('../acceptance');
    await expect(submitResults([{ check_key: 'r1:001', result: '通过' }], 'alice@zenjoymedia.media')).rejects.toThrow('Brain 500');
  });
});
```

Run: `cd apps/api && npx vitest run src/services/__tests__/acceptance.test.ts`
Expected: FAIL（模块 `../acceptance` 不存在）

- [ ] **Step 2: 实现 `apps/api/src/services/acceptance.ts`**

```typescript
/**
 * Staff Hub 验收模块 — Brain 内网 acceptance 端点反代层
 *
 * 读路径（pending/history）：Brain 不可达时降级 availability='degraded'，不抛异常，
 * 参照 line-health.ts 的三态降级模型（此处永远是 ready/degraded 二态，无 not_connected）。
 * 写路径（submitResults）：Brain 报错必须让异常冒泡给调用方，不能伪装成功——
 * 员工提交结果这个动作有实际后果（触发驳回任务/算 pass_rate），绝不能静默丢失。
 */
import axios from 'axios';

const CECELIA_BRAIN_BASE = (): string =>
  process.env.CECELIA_BRAIN_URL ?? 'http://host.docker.internal:5221';

const TIMEOUT_MS = 20000;

export type AcceptanceCheck = {
  id: string;
  check_key: string;
  kind: 'FR' | 'NFR' | 'Invariant' | 'SOP';
  name: string;
  device: string | null;
  result: '通过' | '不通过' | '无法验证' | null;
  note: string | null;
  detail: { op?: string[]; exp?: string; pass?: string; fail?: string } | null;
  submitted_by: string | null;
  decided_at: string | null;
};

export type AcceptanceRun = {
  id: string;
  run_key: string;
  title: string;
  gp_id: string | null;
  line: string | null;
  surface: string | null;
  version: string | null;
  status: 'pending' | 'in_review' | 'passed' | 'failed';
  pass_rate: number | null;
  created_at: string;
  checks: AcceptanceCheck[];
};

export type AcceptanceListResult = {
  availability: 'ready' | 'degraded';
  runs: AcceptanceRun[];
  message: string | null;
};

async function fetchRunsList(url: string): Promise<AcceptanceListResult> {
  try {
    const upstream = await axios.get(url, { timeout: TIMEOUT_MS });
    const runs = Array.isArray(upstream.data?.runs) ? (upstream.data.runs as AcceptanceRun[]) : [];
    return { availability: 'ready', runs, message: null };
  } catch (err) {
    const message = axios.isAxiosError(err) ? err.message : (err as Error).message || 'brain unavailable';
    return { availability: 'degraded', runs: [], message: `Brain: ${message}` };
  }
}

export async function fetchPendingRuns(): Promise<AcceptanceListResult> {
  return fetchRunsList(`${CECELIA_BRAIN_BASE()}/api/brain/acceptance/pending`);
}

export async function fetchHistoryByGpId(gpId: string): Promise<AcceptanceListResult> {
  const url = `${CECELIA_BRAIN_BASE()}/api/brain/acceptance/runs?gp_id=${encodeURIComponent(gpId)}`;
  return fetchRunsList(url);
}

export type SubmitResultItem = { check_key: string; result: '通过' | '不通过' | '无法验证'; note?: string };

export type SubmitResultsResponse = {
  updated: number;
  runs: Array<{ run_key: string; pass_rate: number; status: string }>;
};

export async function submitResults(
  items: SubmitResultItem[],
  submittedBy: string
): Promise<SubmitResultsResponse> {
  const payload = {
    results: items.map((item) => ({ ...item, submitted_by: submittedBy })),
  };
  // 写路径不 catch——失败必须冒泡给路由层返回非 200，不能伪装成功
  const upstream = await axios.post(`${CECELIA_BRAIN_BASE()}/api/brain/acceptance/results`, payload, {
    timeout: TIMEOUT_MS,
  });
  return upstream.data as SubmitResultsResponse;
}
```

- [ ] **Step 3: 重跑测试确认通过**

Run: `cd apps/api && npx vitest run src/services/__tests__/acceptance.test.ts`
Expected: PASS（6/6）

- [ ] **Step 4: 在 `apps/api/src/routes/staff.ts` 新增路由**

在文件顶部 import 区加：
```typescript
import {
  fetchPendingRuns,
  fetchHistoryByGpId,
  submitResults,
  type SubmitResultItem,
} from '../services/acceptance';
```

在文件末尾 `export default router;` 之前加：

```typescript
// ─── 验收模块（Staff Hub 直连 Brain，决策 fc7b5dc0）───────────────────────
// 反代逻辑在 services/acceptance.ts，本处只做 HTTP 语义 + 身份透传。

router.get('/acceptance/pending', async (_req, res): Promise<void> => {
  const result = await fetchPendingRuns();
  res.status(200).json({ success: true, ...result });
});

router.get('/acceptance/history', async (req, res): Promise<void> => {
  const gpId = typeof req.query.gp_id === 'string' ? req.query.gp_id : '';
  if (!gpId) {
    res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'gp_id query param required' } });
    return;
  }
  const result = await fetchHistoryByGpId(gpId);
  res.status(200).json({ success: true, ...result });
});

router.post('/acceptance/results', async (req, res): Promise<void> => {
  const items = req.body?.results as SubmitResultItem[] | undefined;
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'results must be a non-empty array' } });
    return;
  }
  const emailHeader = req.headers['x-user-email'];
  const openIdHeader = req.headers['x-feishu-user-id'];
  const submittedBy =
    (typeof emailHeader === 'string' && emailHeader.trim()) ||
    (typeof openIdHeader === 'string' && openIdHeader.trim()) ||
    'unknown';
  try {
    const result = await submitResults(items, submittedBy);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    const message = axios.isAxiosError(err) ? err.message : (err as Error).message || 'submit failed';
    res.status(502).json({ success: false, error: { code: 'BRAIN_UNAVAILABLE', message } });
  }
});
```

（若文件顶部尚未 `import axios from 'axios';`，需要加上；`Request`/`Response` 类型已由文件既有 import 提供）

- [ ] **Step 5: 写路由层测试（新建 `apps/api/src/routes/__tests__/staff-acceptance.test.ts`，若 `staff.test.ts` 已存在同类分组测试则改为追加到那个文件的对应 describe 块，参照文件里 line-health 路由测试的写法抄 supertest 用法）**

先跑一次找到现有 `staff.test.ts` 里 line-health 测试的 supertest app 构造方式，照着抄，新增：
- `GET /api/staff/acceptance/pending` 返回 200 + availability 字段
- `GET /api/staff/acceptance/history` 缺 gp_id → 400
- `POST /api/staff/acceptance/results` 空数组 → 400；service 抛错 → 502

Run 对应测试文件确认 PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/acceptance.ts apps/api/src/services/__tests__/acceptance.test.ts apps/api/src/routes/staff.ts apps/api/src/routes/__tests__/
git commit -m "feat(staff-hub): 验收模块后端反代层 — pending/history/results 三端点"
```

---

### Task 2: `AcceptancePage.tsx` — 列表页 + 首页角标

**Files:**
- Create: `apps/staff-hub/src/pages/AcceptancePage.tsx`
- Create: `apps/staff-hub/src/pages/AcceptancePage.test.tsx`
- Modify: `apps/staff-hub/src/App.tsx`

- [ ] **Step 1: 写组件测试（vitest + @testing-library/react，参照仓库里其他 `*.test.tsx` 的 mock fetch 写法，若无先例则用 `vi.stubGlobal('fetch', ...)`）**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AcceptancePage from './AcceptancePage';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'staff@test.com' } }),
}));

describe('AcceptancePage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('渲染待验收列表', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        availability: 'ready',
        runs: [{ run_key: 'r1', title: '被动接待验收', status: 'in_review', checks: [{ result: null }, { result: '通过' }] }],
      }),
    });
    render(<MemoryRouter><AcceptancePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('acceptance-run-r1')).toBeInTheDocument());
    expect(screen.getByText('被动接待验收')).toBeInTheDocument();
  });

  it('Brain 降级时展示提示，不崩溃', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, availability: 'degraded', runs: [], message: 'Brain: timeout' }),
    });
    render(<MemoryRouter><AcceptancePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('acceptance-degraded-banner')).toBeInTheDocument());
  });
});
```

Run: `cd apps/staff-hub && npx vitest run src/pages/AcceptancePage.test.tsx`
Expected: FAIL（`AcceptancePage` 不存在）

- [ ] **Step 2: 实现 `AcceptancePage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminFetch } from '../lib/adminFetch';
import { useAuth } from '../contexts/AuthContext';

type Check = { result: string | null };
type Run = { run_key: string; title: string; status: string; gp_id?: string | null; checks: Check[] };

export default function AcceptancePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<Run[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const res = await adminFetch('/api/staff/acceptance/pending', user);
        const json = await res.json();
        setRuns(json.runs ?? []);
        setDegraded(json.availability === 'degraded');
      } catch {
        setDegraded(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const pendingCount = runs.reduce(
    (sum, r) => sum + r.checks.filter((c) => c.result === null).length,
    0
  );

  return (
    <div data-testid="acceptance-page">
      <h1>验收（{pendingCount} 条待处理）</h1>
      {degraded && (
        <div className="pill fail" data-testid="acceptance-degraded-banner">
          验收系统暂时无法连接，请稍后重试
        </div>
      )}
      {loading && <p>加载中...</p>}
      {!loading && !degraded && runs.length === 0 && <p data-testid="acceptance-empty">暂无待验收单</p>}
      <ul>
        {runs.map((run) => {
          const total = run.checks.length;
          const done = run.checks.filter((c) => c.result !== null).length;
          return (
            <li
              key={run.run_key}
              data-testid={`acceptance-run-${run.run_key}`}
              onClick={() => navigate(`/acceptance/${run.run_key}`)}
              style={{ cursor: 'pointer' }}
            >
              <strong>{run.title}</strong> — {run.status}（{done}/{total}）
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: 重跑测试确认通过**

Run: `cd apps/staff-hub && npx vitest run src/pages/AcceptancePage.test.tsx`
Expected: PASS

- [ ] **Step 4: 在 `App.tsx` 加导航入口 + 路由**

参照文件里 line-health 的加法模式：在 import 区加 `import AcceptancePage from './pages/AcceptancePage';`，在 `Shell()` 的导航列表里加一条（图标从 `lucide-react` 选 `ClipboardCheck`）：
```tsx
<NavLink to="/acceptance" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
  <ClipboardCheck size={18} /> 验收
</NavLink>
```
在 `<Routes>` 里加：
```tsx
<Route path="/acceptance" element={<AcceptancePage />} />
```

- [ ] **Step 5: Commit**

```bash
git add apps/staff-hub/src/pages/AcceptancePage.tsx apps/staff-hub/src/pages/AcceptancePage.test.tsx apps/staff-hub/src/App.tsx
git commit -m "feat(staff-hub): 验收列表页 + 导航入口"
```

---

### Task 3: `AcceptanceDetailPage.tsx` — 矩阵总览 + 按 Step 分组答题 + 工作卡 + 提交

**Files:**
- Create: `apps/staff-hub/src/pages/AcceptanceDetailPage.tsx`
- Create: `apps/staff-hub/src/pages/AcceptanceDetailPage.test.tsx`
- Modify: `apps/staff-hub/src/App.tsx`

- [ ] **Step 1: 写组件测试**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AcceptanceDetailPage from './AcceptanceDetailPage';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'staff@test.com' } }),
}));

const RUN = {
  run_key: 'r1', title: '被动接待验收', status: 'in_review', pass_rate: null,
  checks: [
    { id: 'c1', check_key: 'r1:001', kind: 'FR', name: 'Step1: 用户发消息', device: '手机A', result: null, note: null, detail: { op: ['打开APP'], exp: '收到回复' } },
    { id: 'c2', check_key: 'r1:002', kind: 'Invariant', name: 'Step1: 不重复回复', device: null, result: '通过', note: 'ok', detail: null },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/acceptance/r1']}>
      <Routes><Route path="/acceptance/:runKey" element={<AcceptanceDetailPage />} /></Routes>
    </MemoryRouter>
  );
}

describe('AcceptanceDetailPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, availability: 'ready', runs: [RUN] }),
    }));
  });

  it('渲染矩阵总览 + 按 Step 分组的判定项行', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('acceptance-matrix')).toBeInTheDocument());
    expect(screen.getByTestId('acceptance-check-r1:001')).toBeInTheDocument();
    expect(screen.getByTestId('acceptance-check-r1:002')).toBeInTheDocument();
  });

  it('点击行展开工作卡', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('acceptance-check-r1:001'));
    fireEvent.click(screen.getByTestId('acceptance-expand-r1:001'));
    expect(screen.getByTestId('acceptance-workcard-r1:001')).toBeInTheDocument();
  });

  it('选择结果后提交，调用 submit 端点', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, availability: 'ready', runs: [RUN] }) });
    renderPage();
    await waitFor(() => screen.getByTestId('acceptance-check-r1:001'));
    fireEvent.change(screen.getByTestId('acceptance-result-r1:001'), { target: { value: '通过' } });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { updated: 1, runs: [{ run_key: 'r1', status: 'passed', pass_rate: 1 }] } }) });
    fireEvent.click(screen.getByTestId('acceptance-submit'));
    await waitFor(() => expect(screen.getByTestId('acceptance-submit-success')).toBeInTheDocument());
  });
});
```

Run: `cd apps/staff-hub && npx vitest run src/pages/AcceptanceDetailPage.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 2: 实现 `AcceptanceDetailPage.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { adminFetch } from '../lib/adminFetch';
import { useAuth } from '../contexts/AuthContext';

type Detail = { op?: string[]; exp?: string; pass?: string; fail?: string } | null;
type Check = {
  id: string; check_key: string; kind: 'FR' | 'NFR' | 'Invariant' | 'SOP';
  name: string; device: string | null; result: string | null; note: string | null; detail: Detail;
};
type Run = { run_key: string; title: string; status: string; pass_rate: number | null; checks: Check[] };

const KINDS: Array<Check['kind']> = ['FR', 'NFR', 'Invariant', 'SOP'];

// v1 简化：判定项名字里若含 "Step N" 前缀就按此分组，否则归"未分组"
// （Brain checks 暂无独立 step 字段，见 design 文档"不包含"一节，非本次范围）
function stepOf(name: string): string {
  const m = name.match(/Step\s*\d+/i);
  return m ? m[0] : '未分组';
}

export default function AcceptanceDetailPage() {
  const { runKey } = useParams<{ runKey: string }>();
  const { user } = useAuth();
  const [run, setRun] = useState<Run | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [draft, setDraft] = useState<Record<string, { result: string; note: string }>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  const load = async () => {
    try {
      const res = await adminFetch(`/api/staff/acceptance/pending`, user);
      const json = await res.json();
      if (json.availability === 'degraded') { setDegraded(true); return; }
      const found = (json.runs ?? []).find((r: Run) => r.run_key === runKey) ?? null;
      setRun(found);
    } catch {
      setDegraded(true);
    }
  };

  useEffect(() => { void load(); }, [runKey]);

  const grouped = useMemo(() => {
    if (!run) return {};
    const groups: Record<string, Check[]> = {};
    for (const c of run.checks) {
      const step = stepOf(c.name);
      (groups[step] ??= []).push(c);
    }
    return groups;
  }, [run]);

  const matrix = useMemo(() => {
    if (!run) return {};
    const m: Record<string, Record<string, number>> = {};
    for (const step of Object.keys(grouped)) {
      m[step] = {};
      for (const kind of KINDS) {
        m[step][kind] = grouped[step].filter((c) => c.kind === kind).length;
      }
    }
    return m;
  }, [grouped, run]);

  const handleSubmit = async () => {
    const items = Object.entries(draft)
      .filter(([, v]) => v.result)
      .map(([check_key, v]) => ({ check_key, result: v.result as '通过' | '不通过' | '无法验证', note: v.note || undefined }));
    if (items.length === 0) return;
    setSubmitState('submitting');
    try {
      const res = await adminFetch('/api/staff/acceptance/results', user, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: items }),
      });
      if (!res.ok) throw new Error('submit failed');
      setSubmitState('success');
      setDraft({});
      await load();
    } catch {
      setSubmitState('error');
    }
  };

  if (degraded) return <div data-testid="acceptance-degraded-banner">验收系统暂时无法连接，请稍后重试</div>;
  if (!run) return <p>加载中...</p>;

  return (
    <div data-testid="acceptance-detail-page">
      <Link to="/acceptance">← 返回验收列表</Link>
      <h1>{run.title}</h1>

      <table data-testid="acceptance-matrix">
        <thead>
          <tr><th>Step</th>{KINDS.map((k) => <th key={k}>{k}</th>)}</tr>
        </thead>
        <tbody>
          {Object.keys(matrix).map((step) => (
            <tr key={step}>
              <td>{step}</td>
              {KINDS.map((k) => <td key={k}>{matrix[step][k] || '-'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>

      {Object.entries(grouped).map(([step, checks]) => (
        <section key={step}>
          <h2>{step}</h2>
          {checks.map((c) => (
            <div key={c.check_key} data-testid={`acceptance-check-${c.check_key}`}>
              <span>[{c.kind}] {c.name}</span>
              {c.device && <span> ({c.device})</span>}
              {c.detail && (
                <button
                  data-testid={`acceptance-expand-${c.check_key}`}
                  onClick={() => setExpanded((e) => ({ ...e, [c.check_key]: !e[c.check_key] }))}
                >
                  {expanded[c.check_key] ? '收起' : '展开工作卡'}
                </button>
              )}
              {expanded[c.check_key] && c.detail && (
                <div data-testid={`acceptance-workcard-${c.check_key}`}>
                  {c.detail.op && <p>操作步骤: {c.detail.op.join(' → ')}</p>}
                  {c.detail.exp && <p>预期结果: {c.detail.exp}</p>}
                  {c.detail.pass && <p>通过判定: {c.detail.pass}</p>}
                  {c.detail.fail && <p>不通过判定: {c.detail.fail}</p>}
                </div>
              )}
              <select
                data-testid={`acceptance-result-${c.check_key}`}
                value={draft[c.check_key]?.result ?? c.result ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [c.check_key]: { result: e.target.value, note: d[c.check_key]?.note ?? c.note ?? '' } }))
                }
              >
                <option value="">未填写</option>
                <option value="通过">通过</option>
                <option value="不通过">不通过</option>
                <option value="无法验证">无法验证</option>
              </select>
              <input
                data-testid={`acceptance-note-${c.check_key}`}
                placeholder="意见"
                value={draft[c.check_key]?.note ?? c.note ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [c.check_key]: { result: d[c.check_key]?.result ?? c.result ?? '', note: e.target.value } }))
                }
              />
            </div>
          ))}
        </section>
      ))}

      <button data-testid="acceptance-submit" onClick={() => void handleSubmit()} disabled={submitState === 'submitting'}>
        提交
      </button>
      {submitState === 'success' && <p data-testid="acceptance-submit-success">提交成功</p>}
      {submitState === 'error' && <p data-testid="acceptance-submit-error">提交失败，请重试</p>}
    </div>
  );
}
```

- [ ] **Step 3: 重跑测试确认通过**

Run: `cd apps/staff-hub && npx vitest run src/pages/AcceptanceDetailPage.test.tsx`
Expected: PASS

- [ ] **Step 4: 在 `App.tsx` 加路由**

```tsx
import AcceptanceDetailPage from './pages/AcceptanceDetailPage';
...
<Route path="/acceptance/:runKey" element={<AcceptanceDetailPage />} />
```

- [ ] **Step 5: Commit**

```bash
git add apps/staff-hub/src/pages/AcceptanceDetailPage.tsx apps/staff-hub/src/pages/AcceptanceDetailPage.test.tsx apps/staff-hub/src/App.tsx
git commit -m "feat(staff-hub): 验收详情页 — 矩阵总览+按Step分组答题+工作卡展开+提交"
```

---

### Task 4: `AcceptanceHistoryPage.tsx` — 按 GP 查历史

**Files:**
- Create: `apps/staff-hub/src/pages/AcceptanceHistoryPage.tsx`
- Create: `apps/staff-hub/src/pages/AcceptanceHistoryPage.test.tsx`
- Modify: `apps/staff-hub/src/App.tsx`

- [ ] **Step 1: 写组件测试**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AcceptanceHistoryPage from './AcceptanceHistoryPage';

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: 'staff@test.com' } }) }));

describe('AcceptanceHistoryPage', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => vi.unstubAllGlobals());

  it('输入 GP id 查询后展示历史 run 列表，可展开看判定项', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true, availability: 'ready',
        runs: [{ run_key: 'r1', title: '被动接待 v1.21', version: '1.21', created_at: '2026-07-10', checks: [{ check_key: 'r1:001', name: 'x', result: '通过', note: 'ok' }] }],
      }),
    });
    render(<MemoryRouter><AcceptanceHistoryPage /></MemoryRouter>);
    fireEvent.change(screen.getByTestId('acceptance-history-gpid-input'), { target: { value: 'gp1' } });
    fireEvent.click(screen.getByTestId('acceptance-history-search'));
    await waitFor(() => expect(screen.getByTestId('acceptance-history-run-r1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('acceptance-history-run-r1'));
    expect(screen.getByText('ok')).toBeInTheDocument();
  });
});
```

Run: `cd apps/staff-hub && npx vitest run src/pages/AcceptanceHistoryPage.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 2: 实现 `AcceptanceHistoryPage.tsx`**

```tsx
import { useState } from 'react';
import { adminFetch } from '../lib/adminFetch';
import { useAuth } from '../contexts/AuthContext';

type Check = { check_key: string; name: string; result: string | null; note: string | null };
type Run = { run_key: string; title: string; version: string | null; created_at: string; checks: Check[] };

export default function AcceptanceHistoryPage() {
  const { user } = useAuth();
  const [gpId, setGpId] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);

  const search = async () => {
    if (!gpId) return;
    try {
      const res = await adminFetch(`/api/staff/acceptance/history?gp_id=${encodeURIComponent(gpId)}`, user);
      const json = await res.json();
      setDegraded(json.availability === 'degraded');
      setRuns(json.runs ?? []);
    } catch {
      setDegraded(true);
    }
  };

  return (
    <div data-testid="acceptance-history-page">
      <h1>验收历史</h1>
      <input
        data-testid="acceptance-history-gpid-input"
        placeholder="输入 GP ID"
        value={gpId}
        onChange={(e) => setGpId(e.target.value)}
      />
      <button data-testid="acceptance-history-search" onClick={() => void search()}>查询</button>

      {degraded && <p data-testid="acceptance-degraded-banner">验收系统暂时无法连接，请稍后重试</p>}
      {!degraded && runs.length === 0 && <p data-testid="acceptance-history-empty">暂无历史记录</p>}

      <ul>
        {runs.map((run) => (
          <li key={run.run_key}>
            <div
              data-testid={`acceptance-history-run-${run.run_key}`}
              onClick={() => setExpanded(expanded === run.run_key ? null : run.run_key)}
              style={{ cursor: 'pointer' }}
            >
              {run.title}（{run.version ?? '未知版本'}） — {run.created_at}
            </div>
            {expanded === run.run_key && (
              <ul>
                {run.checks.map((c) => (
                  <li key={c.check_key}>
                    {c.name}: {c.result ?? '未填写'} {c.note && `（${c.note}）`}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: 重跑测试确认通过**

Run: `cd apps/staff-hub && npx vitest run src/pages/AcceptanceHistoryPage.test.tsx`
Expected: PASS

- [ ] **Step 4: 在 `App.tsx` 加导航 + 路由**

```tsx
import AcceptanceHistoryPage from './pages/AcceptanceHistoryPage';
...
<NavLink to="/acceptance-history" ...><History size={18} /> 验收历史</NavLink>
...
<Route path="/acceptance-history" element={<AcceptanceHistoryPage />} />
```

- [ ] **Step 5: Commit**

```bash
git add apps/staff-hub/src/pages/AcceptanceHistoryPage.tsx apps/staff-hub/src/pages/AcceptanceHistoryPage.test.tsx apps/staff-hub/src/App.tsx
git commit -m "feat(staff-hub): 验收历史页 — 按GP查历史run"
```

---

### Task 5: smoke 脚本 + smoke-baseline 登记 + E2E spec + Windows CI workflow

**Files:**
- Create: `.github/workflows/scripts/smoke/staff-acceptance-smoke.sh`
- Modify: `.github/workflows/scripts/smoke-baseline.txt`
- Create: `apps/staff-hub/e2e/acceptance.spec.ts`
- Create: `.github/workflows/e2e-staff-acceptance-windows.yml`

- [ ] **Step 1: 读一遍 `staff-line-health-smoke.sh` 和 `e2e-staff-line-health-windows.yml` 全文（作为本任务的精确抄写模板，字段/端口/命令都要跟这两个文件的既有约定一致，不要自己发明新约定）**

- [ ] **Step 2: 写 `staff-acceptance-smoke.sh`**（照抄 `staff-line-health-smoke.sh` 的骨架：build+起真实 apps/api → curl 打 `/api/staff/acceptance/pending`（未授权应 403）→ curl 打 `/api/staff/acceptance/history`（缺 gp_id 应 400）→ curl POST `/api/staff/acceptance/results` 空数组应 400 → kill 清理）

Run 本地验证：`bash .github/workflows/scripts/smoke/staff-acceptance-smoke.sh`
Expected: 全部 PASS

- [ ] **Step 3: 登记进 `smoke-baseline.txt`**（追加一行 `staff-acceptance-smoke.sh`，按文件现有排序规则插入正确位置——这一步是最容易漏的强制项，遗漏会导致 CI 直接 fail）

- [ ] **Step 4: 写 `apps/staff-hub/e2e/acceptance.spec.ts`**（照抄 `line-health.spec.ts` 的骨架：真实后端、禁 `page.route()`、Golden Path 覆盖：打开 `/acceptance` 列表 → 点开一个 run 进详情 → 断言矩阵渲染 → 选一个结果+提交 → 断言成功提示或 Brain 不可达时的降级提示（`a.or(b)` 二选一断言）→ 打开 `/acceptance-history` 页截图）

Run 本地验证（若能起真实 apps/api + vite preview）：`cd apps/staff-hub && npx playwright test e2e/acceptance.spec.ts`

- [ ] **Step 5: 写 `.github/workflows/e2e-staff-acceptance-windows.yml`**（照抄 `e2e-staff-line-health-windows.yml` 完整结构：`paths:` 改成本模块涉及的文件清单；`e2e` job ubuntu-latest 跑 PR 快反馈；`e2e-windows` job **`runs-on: windows-latest`**，`workflow_dispatch` 触发；两个 job 都要有"spec 禁止 page.route()"的 grep 校验步骤；`concurrency` group 按 `${{ github.ref }}`；`permissions: contents: read`）

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/scripts/smoke/staff-acceptance-smoke.sh .github/workflows/scripts/smoke-baseline.txt apps/staff-hub/e2e/acceptance.spec.ts .github/workflows/e2e-staff-acceptance-windows.yml
git commit -m "test(staff-hub): 验收模块 smoke + E2E + Windows CI workflow 三件套"
```
