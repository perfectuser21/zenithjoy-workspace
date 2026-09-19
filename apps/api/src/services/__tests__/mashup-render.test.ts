/**
 * 批量混剪 S4（GP f6f96e17）：候选渲染 + 内容安全 Gate 编排层单测。
 *
 * fail-closed（proposal-v2.md A1）：safety/watermark 两项只要有一项非"通过"，
 * export_url/download_url 必须是 NULL——用假 pool + 假 storage + mock axios(Gemini)
 * + mock concatAndScale/extractFrameBase64 打桩，不连真 ffmpeg/真 Gemini。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../../db/connection', () => ({ default: { query } }));

const axiosPost = vi.fn();
const isAxiosError = (err: unknown) => (err as { isAxiosError?: boolean })?.isAxiosError === true;
vi.mock('axios', () => ({ default: { post: axiosPost, isAxiosError } }));

const concatAndScale = vi.fn();
vi.mock('../mashup-render-ffmpeg', () => ({ concatAndScale: (...args: unknown[]) => concatAndScale(...args) }));

const extractFrameBase64 = vi.fn();
vi.mock('../video-frame-extract', () => ({ extractFrameBase64: (...args: unknown[]) => extractFrameBase64(...args) }));

function fakeStorage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    putObject: vi.fn(),
    getSignedUrl: vi.fn(async () => 'https://signed.example/output.mp4'),
    deleteObject: vi.fn(),
    presignPutUrl: vi.fn(),
    headObject: vi.fn(),
    ...overrides,
  };
}

const CANDIDATE = {
  id: 'cand-1',
  run_id: 'run-1',
  slot_fill: { hook: 'mat-1', product: 'mat-2' },
};
const RUN = { id: 'run-1', tenant_id: 'tenant-a', template_id: 'tmpl-1' };
const TEMPLATE_SLOTS = [
  { key: 'hook', required: true, match_tags: [] },
  { key: 'product', required: true, match_tags: [] },
  { key: 'cta', required: true, match_tags: [] },
];

function mockDb({ candidate = CANDIDATE, run = RUN, slots = TEMPLATE_SLOTS, materials = [{ id: 'mat-1', storage_key: 'k1' }, { id: 'mat-2', storage_key: 'k2' }] }: {
  candidate?: unknown; run?: unknown; slots?: unknown; materials?: { id: string; storage_key: string }[];
} = {}) {
  query.mockImplementation((sql: string) => {
    if (sql.includes('FROM zenithjoy.mashup_candidates')) return { rows: candidate ? [candidate] : [] };
    if (sql.includes('FROM zenithjoy.mashup_runs')) return { rows: run ? [run] : [] };
    if (sql.includes('FROM zenithjoy.mashup_templates')) return { rows: [{ slots }] };
    if (sql.includes('FROM zenithjoy.materials')) return { rows: materials };
    if (sql.includes('INSERT INTO zenithjoy.contents')) return { rows: [{ id: 'content-1' }] };
    return { rows: [] };
  });
}

describe('renderCandidate', () => {
  beforeEach(() => {
    query.mockReset();
    axiosPost.mockReset();
    concatAndScale.mockReset();
    extractFrameBase64.mockReset();
    delete process.env.TOAPIS_API_KEY;
  });

  it('安全+水印均通过：上传成片，export_url/download_url 非空', async () => {
    process.env.TOAPIS_API_KEY = 'test-key';
    mockDb();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }) as unknown as typeof fetch;
    concatAndScale.mockReturnValue(true);
    extractFrameBase64.mockReturnValue('data:image/jpeg;base64,AAAA');
    axiosPost.mockResolvedValue({
      data: { choices: [{ message: { content: '安全：通过\n水印：无' } }] },
    });
    const storage = fakeStorage();

    const { renderCandidate } = await import('../mashup-render');
    const result = await renderCandidate({ tenantId: 'tenant-a', candidateId: 'cand-1' }, { storage });

    expect(result.safetyCheckStatus).toBe('passed');
    expect(result.watermarkCheckStatus).toBe('passed');
    expect(result.exportUrl).toBeDefined();
    expect(result.downloadUrl).toBeDefined();
    expect(storage.putObject).toHaveBeenCalledTimes(1);

    const insertCall = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO zenithjoy.contents'));
    expect(insertCall).toBeDefined();
  });

  it('内容安全不通过：fail-closed，export_url/download_url 为空，不上传成片', async () => {
    process.env.TOAPIS_API_KEY = 'test-key';
    mockDb();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }) as unknown as typeof fetch;
    concatAndScale.mockReturnValue(true);
    extractFrameBase64.mockReturnValue('data:image/jpeg;base64,AAAA');
    axiosPost.mockResolvedValue({
      data: { choices: [{ message: { content: '安全：不通过\n水印：无' } }] },
    });
    const storage = fakeStorage();

    const { renderCandidate } = await import('../mashup-render');
    const result = await renderCandidate({ tenantId: 'tenant-a', candidateId: 'cand-1' }, { storage });

    expect(result.safetyCheckStatus).toBe('flagged');
    expect(result.exportUrl).toBeUndefined();
    expect(result.downloadUrl).toBeUndefined();
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('检测到水印：fail-closed，即使内容安全通过也不给下载链接', async () => {
    process.env.TOAPIS_API_KEY = 'test-key';
    mockDb();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }) as unknown as typeof fetch;
    concatAndScale.mockReturnValue(true);
    extractFrameBase64.mockReturnValue('data:image/jpeg;base64,AAAA');
    axiosPost.mockResolvedValue({
      data: { choices: [{ message: { content: '安全：通过\n水印：有' } }] },
    });
    const storage = fakeStorage();

    const { renderCandidate } = await import('../mashup-render');
    const result = await renderCandidate({ tenantId: 'tenant-a', candidateId: 'cand-1' }, { storage });

    expect(result.watermarkCheckStatus).toBe('flagged');
    expect(result.exportUrl).toBeUndefined();
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('渲染失败（ffmpeg 合成失败）：落 failed_pending_review，不调用 Gemini', async () => {
    process.env.TOAPIS_API_KEY = 'test-key';
    mockDb();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }) as unknown as typeof fetch;
    concatAndScale.mockReturnValue(false);
    const storage = fakeStorage();

    const { renderCandidate } = await import('../mashup-render');
    const result = await renderCandidate({ tenantId: 'tenant-a', candidateId: 'cand-1' }, { storage });

    expect(result.safetyCheckStatus).toBe('failed_pending_review');
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('未配置 TOAPIS_API_KEY：落 failed_pending_review，不抛异常', async () => {
    mockDb();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }) as unknown as typeof fetch;
    concatAndScale.mockReturnValue(true);
    extractFrameBase64.mockReturnValue('data:image/jpeg;base64,AAAA');
    const storage = fakeStorage();

    const { renderCandidate } = await import('../mashup-render');
    const result = await renderCandidate({ tenantId: 'tenant-a', candidateId: 'cand-1' }, { storage });

    expect(result.safetyCheckStatus).toBe('failed_pending_review');
    expect(result.exportUrl).toBeUndefined();
  });

  it('候选不存在：抛出明确错误', async () => {
    mockDb({ candidate: null });
    const storage = fakeStorage();
    const { renderCandidate } = await import('../mashup-render');
    await expect(renderCandidate({ tenantId: 'tenant-a', candidateId: 'missing' }, { storage })).rejects.toThrow(/candidate not found/i);
  });
});
