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
