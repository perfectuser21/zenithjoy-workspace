/**
 * 候选真实轻量预览队列（决策 623a81d7），并发=1，独立于终版渲染队列。
 * mock DB 纯单测，同 mashup-render-queue.test.ts 惯例——本文件被默认 L3 API Test
 * job 收集，无 Postgres 服务容器。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../../db/connection', () => ({ default: { query } }));
vi.mock('../mashup-preview-render', () => ({ renderPreview: vi.fn() }));
vi.mock('../material-storage', () => ({ createMaterialStorage: vi.fn() }));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const candidates = new Map<string, { preview_status: string; preview_url: string | null }>();

beforeEach(() => {
  candidates.clear();
  query.mockReset();
  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('SELECT id, preview_status, preview_url FROM')) {
      const id = params[0] as string;
      const row = candidates.get(id);
      return { rows: row ? [{ id, preview_status: row.preview_status, preview_url: row.preview_url }] : [] };
    }
    if (sql.includes('UPDATE zenithjoy.mashup_candidates SET preview_status')) {
      const [id, , status, previewUrl] = params as [string, string, string, string | null];
      const prev = candidates.get(id);
      candidates.set(id, { preview_status: status, preview_url: previewUrl ?? prev?.preview_url ?? null });
      return { rows: [] };
    }
    return { rows: [] };
  });
});

describe('候选真实轻量预览队列并发=1', () => {
  it('并发上限为 1，第二个入队仍是 generating（queuePosition>=1）', async () => {
    const { enqueuePreview } = await import('../mashup-preview-queue');
    candidates.set('cand-a', { preview_status: 'none', preview_url: null });
    candidates.set('cand-b', { preview_status: 'none', preview_url: null });

    const gate = deferred<void>();
    const slowRender = async () => { await gate.promise; return { previewUrl: 'https://preview.example/a.mp4' }; };

    const a = await enqueuePreview({ tenantId: 't1', candidateId: 'cand-a' }, { render: slowRender });
    expect(a.previewStatus).toBe('generating');
    expect(a.queuePosition).toBe(0);

    const b = await enqueuePreview({ tenantId: 't1', candidateId: 'cand-b' }, { render: slowRender });
    expect(b.previewStatus).toBe('generating');
    expect(b.queuePosition).toBeGreaterThanOrEqual(1);

    gate.resolve();
    await new Promise((r) => setTimeout(r, 20));
    expect(candidates.get('cand-a')?.preview_status).toBe('ready');
    expect(candidates.get('cand-a')?.preview_url).toBe('https://preview.example/a.mp4');
  });

  it('已就绪且有 previewUrl：幂等直接回 ready，不重复渲染', async () => {
    const { enqueuePreview } = await import('../mashup-preview-queue');
    candidates.set('cand-c', { preview_status: 'ready', preview_url: 'https://preview.example/c.mp4' });
    const render = vi.fn();

    const r = await enqueuePreview({ tenantId: 't1', candidateId: 'cand-c' }, { render });
    expect(r.previewStatus).toBe('ready');
    expect(r.previewUrl).toBe('https://preview.example/c.mp4');
    expect(render).not.toHaveBeenCalled();
  });

  it('failed 状态可重新入队（非死路）', async () => {
    const { enqueuePreview } = await import('../mashup-preview-queue');
    candidates.set('cand-d', { preview_status: 'failed', preview_url: null });
    const okRender = async () => ({ previewUrl: 'https://preview.example/d.mp4' });

    const retry = await enqueuePreview({ tenantId: 't1', candidateId: 'cand-d' }, { render: okRender });
    expect(retry.previewStatus).toBe('generating');
  });

  it('候选不存在：抛出明确错误', async () => {
    const { enqueuePreview } = await import('../mashup-preview-queue');
    await expect(enqueuePreview({ tenantId: 't1', candidateId: 'missing' })).rejects.toThrow(/candidate not found/i);
  });
});
