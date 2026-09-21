/**
 * Step4 渲染队列并发=1 + 失败态（mock DB 纯单测，符合本目录既有惯例：
 * mashup-render.test.ts / mashup-candidate-generation.test.ts / mashup-slot-assignment.test.ts
 * 均 vi.mock('../../db/connection', ...) 桩掉 DB，因为本文件被默认 L3 "API Test" job
 * 用 `npx vitest run --coverage` 收集，该 job 无 Postgres 服务容器，真连接必 ECONNREFUSED）。
 *
 * 真 Postgres 覆盖（禁 mock 边：渲染队列 ↔ mashup_candidates 状态迁移的真实 SQL 语义）
 * 由同源 sprint 集成测试跑：sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-render-queue.test.ts
 * （已注册 test-registry.yaml，type=integration/ci=L4，同 07212317-android-signal-reporting 惯例，
 * 不进默认 L3 vitest include，避免污染无 DB 的单测 job）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../../db/connection', () => ({ default: { query } }));
vi.mock('../mashup-render', () => ({ renderCandidate: vi.fn() }));
vi.mock('../material-storage', () => ({ createMaterialStorage: vi.fn() }));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const candidates = new Map<string, { render_status: string }>();

beforeEach(() => {
  candidates.clear();
  query.mockReset();
  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('SELECT id, render_status FROM')) {
      const id = params[0] as string;
      const row = candidates.get(id);
      return { rows: row ? [{ id, render_status: row.render_status }] : [] };
    }
    if (sql.includes('UPDATE zenithjoy.mashup_candidates SET render_status')) {
      const [id, , status] = params as [string, string, string];
      candidates.set(id, { render_status: status });
      return { rows: [] };
    }
    if (sql.includes('SELECT id FROM zenithjoy.contents')) {
      return { rows: [] };
    }
    return { rows: [] };
  });
});

describe('Step4 渲染队列并发=1', () => {
  it('渲染并发上限为 1，第二个入队 queued', async () => {
    const { enqueueRender } = await import('../mashup-render-queue');
    candidates.set('cand-a', { render_status: 'pending' });
    candidates.set('cand-b', { render_status: 'pending' });

    const gate = deferred<void>();
    const slowRender = async () => { await gate.promise; return { renderStatus: 'rendered' as const }; };

    const a = await enqueueRender({ tenantId: 't1', candidateId: 'cand-a' }, { render: slowRender });
    expect(a.renderStatus).toBe('rendering');

    // A 的渲染被 gate 卡住占用唯一 slot 时，B 入队必须是 queued（并发=1）
    const b = await enqueueRender({ tenantId: 't1', candidateId: 'cand-b' }, { render: slowRender });
    expect(b.renderStatus).toBe('queued');
    expect(b.queuePosition).toBeGreaterThanOrEqual(1);

    gate.resolve();
    await new Promise((r) => setTimeout(r, 20));
    expect(candidates.get('cand-a')?.render_status).toBe('rendered');
  });

  it('render_failed 可重新入队（非死路）', async () => {
    const { enqueueRender } = await import('../mashup-render-queue');
    candidates.set('cand-c', { render_status: 'render_failed' });
    const okRender = async () => ({ renderStatus: 'rendered' as const });

    const retry = await enqueueRender({ tenantId: 't1', candidateId: 'cand-c' }, { render: okRender });
    expect(['queued', 'rendering']).toContain(retry.renderStatus);
  });
});
