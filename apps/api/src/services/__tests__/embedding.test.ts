/**
 * 批量混剪 S3（GP f6f96e17）本地 embedding 服务单测。
 *
 * Gate0 实测（决策 98d1fab1）：TOAPIS/Gemini 代理零 embedding 模型访问权限，
 * 改用本地开源模型 @xenova/transformers，零第三方账号依赖。
 * mock 掉 @xenova/transformers 的 pipeline，不在单测里真下模型（真下载+真推理
 * 留给 embedding-smoke.sh）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const pipelineFn = vi.fn();
const extractorMock = vi.fn();
vi.mock('@xenova/transformers', () => ({ pipeline: (...args: unknown[]) => pipelineFn(...args) }));

beforeEach(() => {
  vi.resetModules();
  pipelineFn.mockReset();
  extractorMock.mockReset();
  pipelineFn.mockResolvedValue(extractorMock);
});

describe('embedText', () => {
  it('调用 pipeline 生成向量，归一化+mean pooling', async () => {
    extractorMock.mockResolvedValue({ data: new Float32Array([0.6, 0.8]), dims: [1, 2] });
    const { embedText } = await import('../embedding');
    const v = await embedText('产品特写，厨房场景');

    expect(v).toHaveLength(2);
    expect(v[0]).toBeCloseTo(0.6, 6);
    expect(v[1]).toBeCloseTo(0.8, 6);
    expect(extractorMock).toHaveBeenCalledWith('产品特写，厨房场景', { pooling: 'mean', normalize: true });
  });

  it('pipeline 只初始化一次（单例缓存），多次调用复用同一 extractor', async () => {
    extractorMock.mockResolvedValue({ data: new Float32Array([1, 0]), dims: [1, 2] });
    const { embedText } = await import('../embedding');
    await embedText('文本A');
    await embedText('文本B');

    expect(pipelineFn).toHaveBeenCalledTimes(1);
    expect(extractorMock).toHaveBeenCalledTimes(2);
  });
});

describe('cosineSimilarity', () => {
  it('相同向量相似度为 1', async () => {
    const { cosineSimilarity } = await import('../embedding');
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
  });

  it('正交向量相似度为 0', async () => {
    const { cosineSimilarity } = await import('../embedding');
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('反向向量相似度为 -1', async () => {
    const { cosineSimilarity } = await import('../embedding');
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  it('维度不一致：抛出明确错误，不静默算错', async () => {
    const { cosineSimilarity } = await import('../embedding');
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(/dimension/i);
  });
});
