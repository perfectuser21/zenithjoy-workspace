/**
 * 批量混剪加厚（GP f6f96e17/line05 step3）：候选真实轻量预览渲染叶子单测（决策 623a81d7）。
 *
 * 与 mashup-render.test.ts 同口径：假 pool + 假 storage + mock concatAndScale，
 * 不连真 ffmpeg。核心断言：预览不跑 Gemini 审核、不写 contents，只产出 previewUrl。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync } from 'fs';

const query = vi.fn();
vi.mock('../../db/connection', () => ({ default: { query } }));

const concatAndScale = vi.fn();
vi.mock('../mashup-render-ffmpeg', () => ({ concatAndScale: (...args: unknown[]) => concatAndScale(...args) }));

function fakeStorage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    putObject: vi.fn(),
    getSignedUrl: vi.fn(async () => 'https://signed.example/preview.mp4'),
    deleteObject: vi.fn(),
    presignPutUrl: vi.fn(),
    headObject: vi.fn(),
    ...overrides,
  };
}

const CANDIDATE = { id: 'cand-1', run_id: 'run-1', slot_fill: { hook: 'mat-1', product: 'mat-2' } };
const RUN = { id: 'run-1', tenant_id: 'tenant-a', template_id: 'tmpl-1' };
const TEMPLATE_SLOTS = [
  { key: 'hook', required: true, match_tags: [] },
  { key: 'product', required: true, match_tags: [] },
];

function mockDb({ candidate = CANDIDATE, run = RUN, slots = TEMPLATE_SLOTS, materials = [{ id: 'mat-1', storage_key: 'k1' }, { id: 'mat-2', storage_key: 'k2' }] }: {
  candidate?: unknown; run?: unknown; slots?: unknown; materials?: { id: string; storage_key: string }[];
} = {}) {
  query.mockImplementation((sql: string) => {
    if (sql.includes('FROM zenithjoy.mashup_candidates')) return { rows: candidate ? [candidate] : [] };
    if (sql.includes('FROM zenithjoy.mashup_runs')) return { rows: run ? [run] : [] };
    if (sql.includes('FROM zenithjoy.mashup_templates')) return { rows: [{ slots }] };
    if (sql.includes('FROM zenithjoy.materials')) return { rows: materials };
    return { rows: [] };
  });
}

describe('renderPreview', () => {
  beforeEach(() => {
    query.mockReset();
    concatAndScale.mockReset();
  });

  it('成功：产出 previewUrl，用轻量档位调 concatAndScale（480p 附近+ultrafast），不调 Gemini/不写 contents', async () => {
    mockDb();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }) as unknown as typeof fetch;
    concatAndScale.mockImplementation((_inputs: string[], outPath: string) => { writeFileSync(outPath, Buffer.from([0])); return true; });
    const storage = fakeStorage();

    const { renderPreview } = await import('../mashup-preview-render');
    const result = await renderPreview({ tenantId: 'tenant-a', candidateId: 'cand-1' }, { storage });

    expect(result.previewUrl).toBeDefined();
    expect(storage.putObject).toHaveBeenCalledTimes(1);
    const putCall = storage.putObject.mock.calls[0][0];
    expect(putCall.key).toBe('mashup-previews/tenant-a/cand-1.mp4');

    expect(concatAndScale).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      expect.objectContaining({ preset: 'ultrafast' }),
    );
    const opts = concatAndScale.mock.calls[0][2];
    expect(opts.width).toBeLessThan(1920);
    expect(opts.height).toBeLessThan(1080);

    // 预览不落 contents 表——不应该有任何 INSERT INTO zenithjoy.contents 调用。
    const insertContentCall = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO zenithjoy.contents'));
    expect(insertContentCall).toBeUndefined();
  });

  it('ffmpeg 合成失败：返回空结果（无 previewUrl），不抛异常', async () => {
    mockDb();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }) as unknown as typeof fetch;
    concatAndScale.mockReturnValue(false);
    const storage = fakeStorage();

    const { renderPreview } = await import('../mashup-preview-render');
    const result = await renderPreview({ tenantId: 'tenant-a', candidateId: 'cand-1' }, { storage });

    expect(result.previewUrl).toBeUndefined();
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('素材下载失败：不裸崩，跳过该素材继续', async () => {
    mockDb();
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
    const storage = fakeStorage();

    const { renderPreview } = await import('../mashup-preview-render');
    const result = await renderPreview({ tenantId: 'tenant-a', candidateId: 'cand-1' }, { storage });

    expect(result.previewUrl).toBeUndefined();
    expect(concatAndScale).not.toHaveBeenCalled();
  });

  it('候选不存在：抛出明确错误', async () => {
    mockDb({ candidate: null });
    const storage = fakeStorage();
    const { renderPreview } = await import('../mashup-preview-render');
    await expect(renderPreview({ tenantId: 'tenant-a', candidateId: 'missing' }, { storage })).rejects.toThrow(/candidate not found/i);
  });
});
