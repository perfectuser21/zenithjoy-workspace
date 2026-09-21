/**
 * 批量混剪配音刀（GP line05/batch_mashup#step4）：火山引擎 TTS 服务单测。
 *
 * mock axios，不真调火山（CI 上没凭据）。覆盖：
 *   - 成功路径：base64 音频落地成文件 + addition.frontend 逐字时间戳归一化
 *   - code != 3000：抛出带 code/message 的错误
 *   - 网关类错误（520 等）退避重试后成功
 *   - 4xx 确定性故障：绝不重试
 *   - frontend 字段缺失/非法 JSON：不抛异常，words 退化为空数组
 *   - 缺凭据：抛出明确错误，不静默返回空
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, unlinkSync } from 'fs';

const axiosPost = vi.fn();
const isAxiosError = (err: unknown) => (err as { isAxiosError?: boolean })?.isAxiosError === true;
vi.mock('axios', () => ({
  default: { post: axiosPost, isAxiosError },
}));

function gatewayError(status: number) {
  const err = new Error(`Request failed with status code ${status}`) as Error & {
    isAxiosError: boolean;
    code?: string;
    response: { status: number; data: string };
  };
  err.isAxiosError = true;
  err.response = { status, data: `error code: ${status}` };
  return err;
}

function timeoutError() {
  const err = new Error('timeout of 30000ms exceeded') as Error & { isAxiosError: boolean; code: string };
  err.isAxiosError = true;
  err.code = 'ECONNABORTED';
  return err;
}

// 23 个字 → 逐字时间戳（真实实测口径的缩样，不要求条数与真机一致，只验证归一化）
const FRONTEND_JSON = JSON.stringify({
  words: [
    { word: '厨', start_time: 0, end_time: 235 },
    { word: '房', start_time: 235, end_time: 460 },
  ],
});

function successResponse() {
  return {
    data: {
      code: 3000,
      message: 'OK',
      data: Buffer.from('fake-mp3-bytes').toString('base64'),
      addition: {
        duration: '5395',
        frontend: FRONTEND_JSON,
      },
    },
  };
}

describe('synthesize (tts-volcengine)', () => {
  const producedPaths: string[] = [];

  beforeEach(() => {
    axiosPost.mockReset();
    process.env.VOLCENGINE_TTS_APP_ID = 'test-app-id';
    process.env.VOLCENGINE_TTS_ACCESS_KEY = 'test-access-key';
    process.env.VOLCENGINE_TTS_RETRY_BASE_MS = '1';
  });

  afterEach(() => {
    delete process.env.VOLCENGINE_TTS_APP_ID;
    delete process.env.VOLCENGINE_TTS_ACCESS_KEY;
    delete process.env.VOLCENGINE_TTS_RETRY_BASE_MS;
    for (const p of producedPaths.splice(0)) {
      try { unlinkSync(p); } catch { /* ignore */ }
    }
  });

  it('成功路径：音频落地成文件 + 逐字时间戳归一化为 startMs/endMs', async () => {
    axiosPost.mockResolvedValue(successResponse());

    const { synthesize } = await import('../tts-volcengine');
    const result = await synthesize('厨房产品文案');
    producedPaths.push(result.audioPath);

    expect(existsSync(result.audioPath)).toBe(true);
    expect(readFileSync(result.audioPath).toString()).toBe('fake-mp3-bytes');
    expect(result.durationMs).toBe(5395);
    expect(result.words).toEqual([
      { word: '厨', startMs: 0, endMs: 235 },
      { word: '房', startMs: 235, endMs: 460 },
    ]);

    // Authorization 头必须是火山特殊写法 "Bearer; <access_key>"
    const [, , config] = axiosPost.mock.calls[0];
    expect(config.headers.Authorization).toBe('Bearer; test-access-key');
  });

  it('code != 3000：抛出带 code 和 message 的错误，不能静默返回空', async () => {
    axiosPost.mockResolvedValue({
      data: { code: 3001, message: '文本为空' },
    });

    const { synthesize, VolcengineTtsError } = await import('../tts-volcengine');
    await expect(synthesize('')).rejects.toThrow(VolcengineTtsError);
    await expect(synthesize('')).rejects.toMatchObject({ code: '3001', message: expect.stringContaining('文本为空') });
  });

  it('缺凭据：抛出明确错误，不静默返回空', async () => {
    delete process.env.VOLCENGINE_TTS_APP_ID;
    delete process.env.VOLCENGINE_TTS_ACCESS_KEY;

    const { synthesize, VolcengineTtsError } = await import('../tts-volcengine');
    await expect(synthesize('文案')).rejects.toThrow(VolcengineTtsError);
    await expect(synthesize('文案')).rejects.toMatchObject({ code: 'missing_credentials' });
    expect(axiosPost).not.toHaveBeenCalled();
  });

  describe('网关类错误退避重试（对齐 issue f3b6ba7c 的分寸：网关重试，4xx 不重试）', () => {
    it('遇 520 → 重试后成功', async () => {
      axiosPost.mockReset();
      axiosPost.mockRejectedValueOnce(gatewayError(520)).mockResolvedValueOnce(successResponse());

      const { synthesize } = await import('../tts-volcengine');
      const result = await synthesize('厨房产品文案');
      producedPaths.push(result.audioPath);

      expect(axiosPost).toHaveBeenCalledTimes(2);
      expect(result.durationMs).toBe(5395);
    });

    it.each([502, 503, 504, 521, 524])('遇 %d 同样重试', async (status) => {
      axiosPost.mockReset();
      axiosPost.mockRejectedValueOnce(gatewayError(status)).mockResolvedValueOnce(successResponse());

      const { synthesize } = await import('../tts-volcengine');
      const result = await synthesize('厨房产品文案');
      producedPaths.push(result.audioPath);

      expect(axiosPost).toHaveBeenCalledTimes(2);
    });

    it('超时（ECONNABORTED）同样重试', async () => {
      axiosPost.mockReset();
      axiosPost.mockRejectedValueOnce(timeoutError()).mockResolvedValueOnce(successResponse());

      const { synthesize } = await import('../tts-volcengine');
      const result = await synthesize('厨房产品文案');
      producedPaths.push(result.audioPath);

      expect(axiosPost).toHaveBeenCalledTimes(2);
    });

    it.each([400, 401, 403, 404])('遇 %d 绝不重试——确定性故障要如实报出来', async (status) => {
      axiosPost.mockReset();
      axiosPost.mockRejectedValue(gatewayError(status));

      const { synthesize } = await import('../tts-volcengine');
      await expect(synthesize('厨房产品文案')).rejects.toThrow();
      expect(axiosPost).toHaveBeenCalledTimes(1);
    });

    it('520 重试到上限仍失败 → 抛错，不假装成功', async () => {
      axiosPost.mockReset();
      axiosPost.mockRejectedValue(gatewayError(520));

      const { synthesize } = await import('../tts-volcengine');
      await expect(synthesize('厨房产品文案')).rejects.toThrow();
      expect(axiosPost.mock.calls.length).toBeGreaterThan(1);
    });
  });

  describe('frontend 字段容错', () => {
    it('frontend 缺失：不抛异常，words 退化为空数组', async () => {
      axiosPost.mockResolvedValue({
        data: {
          code: 3000,
          data: Buffer.from('fake-mp3-bytes').toString('base64'),
          addition: { duration: '1000' },
        },
      });

      const { synthesize } = await import('../tts-volcengine');
      const result = await synthesize('文案');
      producedPaths.push(result.audioPath);

      expect(result.words).toEqual([]);
      expect(result.durationMs).toBe(1000);
    });

    it('frontend 是非法 JSON：不抛异常，words 退化为空数组', async () => {
      axiosPost.mockResolvedValue({
        data: {
          code: 3000,
          data: Buffer.from('fake-mp3-bytes').toString('base64'),
          addition: { duration: '1000', frontend: '{not json' },
        },
      });

      const { synthesize } = await import('../tts-volcengine');
      const result = await synthesize('文案');
      producedPaths.push(result.audioPath);

      expect(result.words).toEqual([]);
    });
  });
});
