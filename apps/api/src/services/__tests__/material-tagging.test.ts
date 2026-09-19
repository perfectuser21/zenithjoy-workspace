/**
 * 批量混剪 S1（GP f6f96e17）：素材打标签服务单测。
 *
 * 用假 pool + 假 storage + mock axios 打桩，不连真库/真 COS/真 Gemini——
 * 三态（tagged / pending / failed_pending_review）都要能在没有真实外部依赖时验证到。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../../db/connection', () => ({ default: { query } }));

const axiosPost = vi.fn();
vi.mock('axios', () => ({
  default: { post: axiosPost },
  isAxiosError: (err: unknown) => (err as { isAxiosError?: boolean })?.isAxiosError === true,
}));

const extractFrameBase64 = vi.fn();
vi.mock('../video-frame-extract', () => ({ extractFrameBase64: (...args: unknown[]) => extractFrameBase64(...args) }));

function fakeStorage(getSignedUrlImpl: (key: string) => Promise<string>) {
  return {
    putObject: vi.fn(),
    getSignedUrl: vi.fn(getSignedUrlImpl),
    deleteObject: vi.fn(),
    presignPutUrl: vi.fn(),
    headObject: vi.fn(),
  };
}

describe('tagMaterial', () => {
  beforeEach(() => {
    query.mockReset();
    axiosPost.mockReset();
    extractFrameBase64.mockReset();
    delete process.env.TOAPIS_API_KEY;
  });

  it('打标签成功：真调 Gemini 拿到标签+描述，写回 tag_status=tagged', async () => {
    process.env.TOAPIS_API_KEY = 'test-key';
    query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT') && sql.includes('FROM zenithjoy.materials')) {
        return { rows: [{ id: 'mat-1', tenant_id: 'tenant-a', storage_key: 'tenant-a/mat-1/a.mp4', mime_type: 'video/mp4' }] };
      }
      if (sql.includes('UPDATE zenithjoy.materials')) return { rows: [] };
      return { rows: [] };
    });
    const storage = fakeStorage(async () => 'https://signed.example/a.mp4');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }) as unknown as typeof fetch;
    extractFrameBase64.mockReturnValue('data:image/jpeg;base64,AAAA');
    axiosPost.mockResolvedValue({
      data: {
        choices: [{
          message: { content: '标签：产品特写, 厨房场景\n描述：一段厨房产品展示镜头' },
          finish_reason: 'stop',
        }],
      },
    });

    const { tagMaterial } = await import('../material-tagging');
    const result = await tagMaterial('mat-1', { storage });

    expect(result.status).toBe('tagged');
    expect(result.tags).toContain('产品特写');
    expect(result.description).toContain('厨房产品展示');

    const updateCall = query.mock.calls.find((c) => String(c[0]).includes('UPDATE zenithjoy.materials'));
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toContain('mat-1');
  });

  it('未配置 TOAPIS_API_KEY：标 failed_pending_review，不抛异常', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT') && sql.includes('FROM zenithjoy.materials')) {
        return { rows: [{ id: 'mat-2', tenant_id: 'tenant-a', storage_key: 'tenant-a/mat-2/a.mp4', mime_type: 'video/mp4' }] };
      }
      return { rows: [] };
    });
    const storage = fakeStorage(async () => 'https://signed.example/a.mp4');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }) as unknown as typeof fetch;
    extractFrameBase64.mockReturnValue('data:image/jpeg;base64,AAAA');

    const { tagMaterial } = await import('../material-tagging');
    const result = await tagMaterial('mat-2', { storage });

    expect(result.status).toBe('failed_pending_review');
    expect(axiosPost).not.toHaveBeenCalled();
    const updateCall = query.mock.calls.find((c) => String(c[0]).includes('UPDATE zenithjoy.materials'));
    expect(updateCall![0]).toContain('failed_pending_review');
  });

  it('抽帧失败（ffmpeg 不在/视频损坏）：标 failed_pending_review，不调 Gemini', async () => {
    process.env.TOAPIS_API_KEY = 'test-key';
    query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT') && sql.includes('FROM zenithjoy.materials')) {
        return { rows: [{ id: 'mat-3', tenant_id: 'tenant-a', storage_key: 'tenant-a/mat-3/a.mp4', mime_type: 'video/mp4' }] };
      }
      return { rows: [] };
    });
    const storage = fakeStorage(async () => 'https://signed.example/a.mp4');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }) as unknown as typeof fetch;
    extractFrameBase64.mockReturnValue(null);

    const { tagMaterial } = await import('../material-tagging');
    const result = await tagMaterial('mat-3', { storage });

    expect(result.status).toBe('failed_pending_review');
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('Gemini 调用超时/网络错误：标 failed_pending_review，不抛异常给调用方', async () => {
    process.env.TOAPIS_API_KEY = 'test-key';
    query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT') && sql.includes('FROM zenithjoy.materials')) {
        return { rows: [{ id: 'mat-4', tenant_id: 'tenant-a', storage_key: 'tenant-a/mat-4/a.mp4', mime_type: 'video/mp4' }] };
      }
      return { rows: [] };
    });
    const storage = fakeStorage(async () => 'https://signed.example/a.mp4');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }) as unknown as typeof fetch;
    extractFrameBase64.mockReturnValue('data:image/jpeg;base64,AAAA');
    axiosPost.mockRejectedValue(Object.assign(new Error('timeout'), { isAxiosError: true, code: 'ECONNABORTED' }));

    const { tagMaterial } = await import('../material-tagging');
    const result = await expect(tagMaterial('mat-4', { storage })).resolves.toMatchObject({ status: 'failed_pending_review' });
    void result;
  });

  it('素材 id 不存在：抛出明确错误，不静默返回空结果', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT') && sql.includes('FROM zenithjoy.materials')) return { rows: [] };
      return { rows: [] };
    });
    const storage = fakeStorage(async () => 'https://signed.example/a.mp4');

    const { tagMaterial } = await import('../material-tagging');
    await expect(tagMaterial('mat-missing', { storage })).rejects.toThrow(/not found/i);
  });
});
