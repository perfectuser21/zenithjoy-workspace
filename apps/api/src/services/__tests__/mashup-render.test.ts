/**
 * 批量混剪 S4（GP f6f96e17）：候选渲染 + 内容安全 Gate 编排层单测。
 *
 * fail-closed（proposal-v2.md A1）：safety/watermark 两项只要有一项非"通过"，
 * export_url/download_url 必须是 NULL——用假 pool + 假 storage + mock axios(Gemini)
 * + mock concatAndScale/extractFrameBase64 打桩，不连真 ffmpeg/真 Gemini。
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

// 口播刀（决策 f10195d7）：配音 / 字幕 / 文案合规三件的桩
const synthesize = vi.fn();
vi.mock('../tts-volcengine', () => ({ synthesize: (...args: unknown[]) => synthesize(...args) }));
const writeSrtFile = vi.fn();
vi.mock('../mashup-subtitle', () => ({ writeSrtFile: (...args: unknown[]) => writeSrtFile(...args) }));
const checkCopy = vi.fn();
vi.mock('../copy-compliance', () => ({ checkCopy: (...args: unknown[]) => checkCopy(...args) }));

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
    concatAndScale.mockImplementation((_inputs: string[], outPath: string) => { writeFileSync(outPath, Buffer.from([0])); return true; });
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
    concatAndScale.mockImplementation((_inputs: string[], outPath: string) => { writeFileSync(outPath, Buffer.from([0])); return true; });
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
    concatAndScale.mockImplementation((_inputs: string[], outPath: string) => { writeFileSync(outPath, Buffer.from([0])); return true; });
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

  it('素材下载抛网络异常（非HTTP状态错误，如DNS失败/连接被拒）：不崩溃，落 failed_pending_review', async () => {
    // 真机实测复现（本地人工browser验证批量混剪UI时抓到）：fetch() 对某些URL会直接
    // throw（不是拿到 !resp.ok 的响应），比如协议不支持/网络层失败。这类异常之前没有
    // try/catch 兜底，会直接冒泡到路由层变成裸 500，用户在前端只看到
    // "Request failed with status code 500"，比 S1 material-tagging.ts 早就
    // 解决过的同类问题（下载失败优雅降级）还退步。
    process.env.TOAPIS_API_KEY = 'test-key';
    mockDb();
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
    const storage = fakeStorage();

    const { renderCandidate } = await import('../mashup-render');
    const result = await renderCandidate({ tenantId: 'tenant-a', candidateId: 'cand-1' }, { storage });

    expect(result.safetyCheckStatus).toBe('failed_pending_review');
    expect(result.exportUrl).toBeUndefined();
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('未配置 TOAPIS_API_KEY：落 failed_pending_review，不抛异常', async () => {
    mockDb();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }) as unknown as typeof fetch;
    concatAndScale.mockImplementation((_inputs: string[], outPath: string) => { writeFileSync(outPath, Buffer.from([0])); return true; });
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

/**
 * 口播成片串联（GP line05/batch_mashup#step4，决策 f10195d7）
 *
 * 客户实测："我给了文案，片子里一个字都没有"——文案既没被念出来也没上字幕，
 * 成片是横屏哑片，抖音根本发不了。本组锁的是"文案真的变成了声音和字"这条链：
 *   模板里的 script_text → TTS 配音 → 逐字时间戳 → srt → 带音轨+字幕渲染
 *
 * 还锁一条安全底线：配音字幕会把违规词从"藏在文案里"放大成"念出来+写屏上"，
 * 客户卖蟑螂药属农药类目，极限词是账号级风险，必须在合成前拦住。
 */
describe('renderCandidate — 口播成片串联 [BEHAVIOR]', () => {
  const SCRIPT = '厨房蟑螂反复出没？这瓶喷雾一喷就见效。';

  function primeQueries(templateRow: Record<string, unknown>) {
    const scriptTextForTest = (templateRow.script_text ?? null) as string | null;
    query.mockImplementation(async (sql: string) => {
      // 注意匹配顺序：resolveScriptText 的查询也是 FROM mashup_candidates 开头
      // （三表 JOIN 取 t.script_text），必须先按 SELECT 的内容区分，否则会被
      // 下面的候选分支抢先吃掉、返回一个没有 script_text 的对象——那样文案取不到，
      // TTS 永远不会被调用，而表面上看起来"查询都命中了"。
      if (/SELECT\s+t\.script_text/i.test(sql)) {
        return { rows: [{ script_text: scriptTextForTest }] };
      }
      if (/FROM zenithjoy\.mashup_candidates/i.test(sql)) return { rows: [CANDIDATE] };
      if (/FROM zenithjoy\.mashup_runs/i.test(sql)) return { rows: [RUN] };
      if (/FROM zenithjoy\.mashup_templates/i.test(sql)) return { rows: [templateRow] };
      if (/FROM zenithjoy\.mashup_slot_assignments/i.test(sql)) {
        return { rows: [{ slot_key: 'hook', material_id: 'mat-1', status: 'assigned' }] };
      }
      if (/FROM zenithjoy\.materials/i.test(sql)) {
        return { rows: [{ id: 'mat-1', storage_key: 'k1', mime_type: 'video/mp4' }] };
      }
      if (/INSERT INTO zenithjoy\.contents/i.test(sql)) return { rows: [{ id: 'content-1' }] };
      return { rows: [] };
    });
  }

  beforeEach(() => {
    query.mockReset(); axiosPost.mockReset(); concatAndScale.mockReset();
    renderMashupWithAudio.mockReset(); synthesize.mockReset();
    writeSrtFile.mockReset(); checkCopy.mockReset();
    extractFrameBase64.mockReturnValue('data:image/png;base64,AAA');
    axiosPost.mockResolvedValue({ data: { choices: [{ message: { content: '安全：通过\n水印：无' } }] } });
    checkCopy.mockReturnValue({ passed: true, issues: [] });
    synthesize.mockResolvedValue({
      audioPath: '/tmp/voice.mp3',
      durationMs: 3000,
      words: [{ word: '厨', startMs: 0, endMs: 200 }, { word: '房', startMs: 200, endMs: 420 }],
    });
    // mock 说渲染成功，就得真落一个文件出来——renderCandidate 后面会
    // readFileSync(outputPath) 抽帧送安全审核，桩不补文件会 ENOENT。
    const fakeRender = (...args: unknown[]) => {
      const out = String(args[1]);
      writeFileSync(out, Buffer.from([0x00, 0x01, 0x02]));
      return true;
    };
    renderMashupWithAudio.mockImplementation(fakeRender);
    concatAndScale.mockImplementation(fakeRender);
    globalThis.fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })) as never;
  });

  it('模板有文案 → 走 TTS 配音并烧字幕，不再是哑片', async () => {
    primeQueries({ id: 'tmpl-1', slots: [{ key: 'hook', match_tags: ['开场'] }], script_text: SCRIPT });
    const { renderCandidate } = await import('../mashup-render');
    await renderCandidate({ tenantId: 'tenant-a', candidateId: 'cand-1' }, { storage: fakeStorage() } as never);

    expect(synthesize, 'TTS 必须被调用——否则片子还是哑的').toHaveBeenCalled();
    expect(String(synthesize.mock.calls[0][0])).toContain('蟑螂');
    expect(writeSrtFile, '必须生成字幕文件').toHaveBeenCalled();
    expect(renderMashupWithAudio, '必须走带音轨+字幕的渲染，不能再走无声的 concatAndScale').toHaveBeenCalled();
    const opts = renderMashupWithAudio.mock.calls[0][2] as Record<string, unknown>;
    expect(opts.audioPath, '渲染要挂上配音').toBeTruthy();
    expect(opts.srtPath, '渲染要烧上字幕').toBeTruthy();
  });

  it('文案命中极限词 → 合成前就拦住，绝不产出违规成片', async () => {
    checkCopy.mockReturnValue({
      passed: false,
      issues: [{ term: '根治', category: '农药高危宣称', position: 0 }],
    });
    primeQueries({ id: 'tmpl-1', slots: [{ key: 'hook', match_tags: ['开场'] }], script_text: '根治蟑螂，无毒无害' });
    const { renderCandidate } = await import('../mashup-render');
    const r = await renderCandidate({ tenantId: 'tenant-a', candidateId: 'cand-1' }, { storage: fakeStorage() } as never);

    expect(synthesize, '违规文案不该被念出来').not.toHaveBeenCalled();
    expect(renderMashupWithAudio, '违规文案不该产出成片').not.toHaveBeenCalled();
    expect(r.safetyCheckStatus, '要落到未通过态，不能假装成功').not.toBe('passed');
  });

  it('模板没有文案（老数据/内置模板）→ 退回无声渲染，不炸', async () => {
    primeQueries({ id: 'tmpl-1', slots: [{ key: 'hook', match_tags: ['开场'] }], script_text: null });
    const { renderCandidate } = await import('../mashup-render');
    const r = await renderCandidate({ tenantId: 'tenant-a', candidateId: 'cand-1' }, { storage: fakeStorage() } as never);

    expect(synthesize).not.toHaveBeenCalled();
    expect(r.contentId, '老数据仍要能出片，不能因为没文案就失败').toBeTruthy();
  });

  it('TTS 挂了 → 不让整条渲染崩，退回无声成片', async () => {
    synthesize.mockRejectedValue(new Error('volcengine 520'));
    primeQueries({ id: 'tmpl-1', slots: [{ key: 'hook', match_tags: ['开场'] }], script_text: SCRIPT });
    const { renderCandidate } = await import('../mashup-render');
    const r = await renderCandidate({ tenantId: 'tenant-a', candidateId: 'cand-1' }, { storage: fakeStorage() } as never);

    expect(r.contentId, 'TTS 是增强项，挂了要降级不要连累出片').toBeTruthy();
  });
});
