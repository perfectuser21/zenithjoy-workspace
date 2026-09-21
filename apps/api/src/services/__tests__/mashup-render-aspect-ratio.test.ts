/**
 * 批量混剪横竖屏选择（GP line05/batch_mashup#step4）：客户原话"抖音横屏和竖屏是我们要
 * 选择的呀，有的是横屏，有的是竖屏"。渲染层（mashup-render-ffmpeg.ts）早支持
 * width/height 可传，但 mashup-render.ts 调用时从未传过——本测试锁住
 * renderCandidate 按 run.aspect_ratio 翻译出正确 width/height 并透传给
 * renderMashupWithAudio（配音路径）与 concatAndScale（无声路径）。
 *
 * 与 mashup-render.test.ts 同口径：假 pool + 假 storage + mock ffmpeg 编排层，
 * 不连真 ffmpeg/真 Gemini。独立成新文件而不是改现有 mashup-render.test.ts——
 * 任务铁律只许碰指定文件，新增测试单独登记进 test-registry.yaml。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync } from 'fs';

const query = vi.fn();
vi.mock('../../db/connection', () => ({ default: { query } }));

const axiosPost = vi.fn();
const isAxiosError = (err: unknown) => (err as { isAxiosError?: boolean })?.isAxiosError === true;
vi.mock('axios', () => ({ default: { post: axiosPost, isAxiosError } }));

const concatAndScale = vi.fn();
const renderMashupWithAudio = vi.fn();
vi.mock('../mashup-render-ffmpeg', () => ({
  concatAndScale: (...args: unknown[]) => concatAndScale(...args),
  renderMashupWithAudio: (...args: unknown[]) => renderMashupWithAudio(...args),
}));

const synthesize = vi.fn();
vi.mock('../tts-volcengine', () => ({ synthesize: (...args: unknown[]) => synthesize(...args) }));
const writeSrtFile = vi.fn();
vi.mock('../mashup-subtitle', () => ({ writeSrtFile: (...args: unknown[]) => writeSrtFile(...args) }));
const checkCopy = vi.fn();
vi.mock('../copy-compliance', () => ({ checkCopy: (...args: unknown[]) => checkCopy(...args) }));

const extractFrameBase64 = vi.fn();
vi.mock('../video-frame-extract', () => ({ extractFrameBase64: (...args: unknown[]) => extractFrameBase64(...args) }));

function fakeStorage() {
  return {
    putObject: vi.fn(),
    getSignedUrl: vi.fn(async () => 'https://signed.example/output.mp4'),
    deleteObject: vi.fn(),
    presignPutUrl: vi.fn(),
    headObject: vi.fn(),
  };
}

const CANDIDATE = { id: 'cand-1', run_id: 'run-1', slot_fill: { hook: 'mat-1', product: 'mat-2' } };
const TEMPLATE_SLOTS = [
  { key: 'hook', required: true, match_tags: [] },
  { key: 'product', required: true, match_tags: [] },
];
const MATERIALS = [{ id: 'mat-1', storage_key: 'k1' }, { id: 'mat-2', storage_key: 'k2' }];

/**
 * 注意匹配顺序（同 mashup-render.test.ts 的 primeQueries 教训）：resolveAspectRatio
 * 的查询也是 FROM mashup_candidates 开头（两表 JOIN 取 r.aspect_ratio），必须先按
 * SELECT 的具体列区分，否则会被下面的候选分支抢先吃掉、返回一个没有 aspect_ratio
 * 的对象——那样永远读不到真实值，表面看查询都命中了，实际测的是假阳性。
 * script_text 同理，也要在 candidates 通配之前单独拦截。
 */
function mockDb({ run, candidate = CANDIDATE, slots = TEMPLATE_SLOTS, materials = MATERIALS, scriptText = null }: {
  run: unknown; candidate?: unknown; slots?: unknown; materials?: { id: string; storage_key: string }[]; scriptText?: string | null;
}) {
  query.mockImplementation((sql: string) => {
    if (/SELECT\s+r\.aspect_ratio/i.test(sql)) return { rows: run ? [run] : [] };
    if (/SELECT\s+t\.script_text/i.test(sql)) return { rows: [{ script_text: scriptText }] };
    if (sql.includes('FROM zenithjoy.mashup_candidates')) return { rows: candidate ? [candidate] : [] };
    if (sql.includes('FROM zenithjoy.mashup_runs')) return { rows: run ? [run] : [] };
    if (sql.includes('FROM zenithjoy.mashup_templates')) return { rows: [{ slots }] };
    if (sql.includes('FROM zenithjoy.materials')) return { rows: materials };
    if (sql.includes('INSERT INTO zenithjoy.contents')) return { rows: [{ id: 'content-1' }] };
    return { rows: [] };
  });
}

beforeEach(() => {
  query.mockReset();
  axiosPost.mockReset();
  concatAndScale.mockReset();
  renderMashupWithAudio.mockReset();
  synthesize.mockReset();
  checkCopy.mockReset();
  extractFrameBase64.mockReset();
  delete process.env.TOAPIS_API_KEY;
});

describe('resolveAspectRatio', () => {
  it('run.aspect_ratio = portrait → 原样返回 portrait', async () => {
    mockDb({ run: { id: 'run-1', tenant_id: 'tenant-a', aspect_ratio: 'portrait' } });
    const { resolveAspectRatio } = await import('../mashup-render');
    const result = await resolveAspectRatio({ tenantId: 'tenant-a', candidateId: 'cand-1' });
    expect(result).toBe('portrait');
  });

  it('run.aspect_ratio = landscape → 原样返回 landscape', async () => {
    mockDb({ run: { id: 'run-1', tenant_id: 'tenant-a', aspect_ratio: 'landscape' } });
    const { resolveAspectRatio } = await import('../mashup-render');
    const result = await resolveAspectRatio({ tenantId: 'tenant-a', candidateId: 'cand-1' });
    expect(result).toBe('landscape');
  });

  it('老 run 没有 aspect_ratio 列值（undefined）→ 默认 landscape，不报错', async () => {
    mockDb({ run: { id: 'run-1', tenant_id: 'tenant-a' } });
    const { resolveAspectRatio } = await import('../mashup-render');
    const result = await resolveAspectRatio({ tenantId: 'tenant-a', candidateId: 'cand-1' });
    expect(result).toBe('landscape');
  });

  it('库里出现非法值 → 兜底 landscape，不抛异常', async () => {
    mockDb({ run: { id: 'run-1', tenant_id: 'tenant-a', aspect_ratio: 'square' } });
    const { resolveAspectRatio } = await import('../mashup-render');
    const result = await resolveAspectRatio({ tenantId: 'tenant-a', candidateId: 'cand-1' });
    expect(result).toBe('landscape');
  });
});

describe('renderCandidate — 按 run.aspect_ratio 传 width/height', () => {
  it('portrait + 有配音：renderMashupWithAudio 收到 width=1080/height=1920', async () => {
    process.env.TOAPIS_API_KEY = 'test-key';
    mockDb({
      run: { id: 'run-1', tenant_id: 'tenant-a', template_id: 'tmpl-1', aspect_ratio: 'portrait' },
      scriptText: '这是一段带货文案',
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }) as unknown as typeof fetch;
    checkCopy.mockReturnValue({ passed: true, issues: [] });
    synthesize.mockResolvedValue({ audioPath: '/tmp/voice.mp3', durationMs: 3000, words: [] });
    renderMashupWithAudio.mockImplementation((_segs: unknown, outPath: string) => { writeFileSync(outPath, Buffer.from([0])); return true; });
    extractFrameBase64.mockReturnValue('data:image/jpeg;base64,AAAA');
    axiosPost.mockResolvedValue({ data: { choices: [{ message: { content: '安全：通过\n水印：无' } }] } });

    const { renderCandidate } = await import('../mashup-render');
    await renderCandidate({ tenantId: 'tenant-a', candidateId: 'cand-1' }, { storage: fakeStorage() });

    expect(renderMashupWithAudio).toHaveBeenCalledTimes(1);
    const opts = renderMashupWithAudio.mock.calls[0][2];
    expect(opts).toMatchObject({ width: 1080, height: 1920 });
  });

  it('landscape（老 run 默认）+ 无文案：concatAndScale 收到 width=1920/height=1080', async () => {
    process.env.TOAPIS_API_KEY = 'test-key';
    mockDb({ run: { id: 'run-1', tenant_id: 'tenant-a', template_id: 'tmpl-1' } });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }) as unknown as typeof fetch;
    concatAndScale.mockImplementation((_inputs: string[], outPath: string) => { writeFileSync(outPath, Buffer.from([0])); return true; });
    extractFrameBase64.mockReturnValue('data:image/jpeg;base64,AAAA');
    axiosPost.mockResolvedValue({ data: { choices: [{ message: { content: '安全：通过\n水印：无' } }] } });

    const { renderCandidate } = await import('../mashup-render');
    await renderCandidate({ tenantId: 'tenant-a', candidateId: 'cand-1' }, { storage: fakeStorage() });

    expect(concatAndScale).toHaveBeenCalledTimes(1);
    const opts = concatAndScale.mock.calls[0][2];
    expect(opts).toMatchObject({ width: 1920, height: 1080 });
  });

  it('portrait + 无文案：concatAndScale 也要收到竖屏尺寸（无声档同样能出竖屏）', async () => {
    process.env.TOAPIS_API_KEY = 'test-key';
    mockDb({ run: { id: 'run-1', tenant_id: 'tenant-a', template_id: 'tmpl-1', aspect_ratio: 'portrait' } });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }) as unknown as typeof fetch;
    concatAndScale.mockImplementation((_inputs: string[], outPath: string) => { writeFileSync(outPath, Buffer.from([0])); return true; });
    extractFrameBase64.mockReturnValue('data:image/jpeg;base64,AAAA');
    axiosPost.mockResolvedValue({ data: { choices: [{ message: { content: '安全：通过\n水印：无' } }] } });

    const { renderCandidate } = await import('../mashup-render');
    await renderCandidate({ tenantId: 'tenant-a', candidateId: 'cand-1' }, { storage: fakeStorage() });

    expect(concatAndScale).toHaveBeenCalledTimes(1);
    const opts = concatAndScale.mock.calls[0][2];
    expect(opts).toMatchObject({ width: 1080, height: 1920 });
  });
});
