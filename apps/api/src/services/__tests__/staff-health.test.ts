/**
 * staff-health 共用数据源单测（line-health 业务线健康看板复用的原语）
 *
 * 覆盖：maturity 档位换算 / GitHub 鉴权头 / 仓库名 env 覆盖 /
 *      Brain journey_features 非数组兜底 / smoke run hint 匹配与未匹配
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const axiosGetMock = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({
  default: { get: axiosGetMock, isAxiosError: () => false },
}));

import {
  CECELIA_BRAIN_BASE,
  fetchJourneyFeatures,
  fetchLatestSmokeRun,
  githubHeaders,
  githubRepo,
  maturityFromCounts,
} from '../staff-health';

beforeEach(() => {
  axiosGetMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('maturityFromCounts', () => {
  it('done/total 比例落在各档位边界上时给出对应 maturity', () => {
    expect(maturityFromCounts(0, 0)).toBe('thin');
    expect(maturityFromCounts(0, 10)).toBe('thin');
    expect(maturityFromCounts(2, 10)).toBe('thin');
    expect(maturityFromCounts(4, 10)).toBe('medium');
    expect(maturityFromCounts(7, 10)).toBe('thick');
    expect(maturityFromCounts(10, 10)).toBe('mature');
  });
});

describe('githubHeaders / githubRepo / CECELIA_BRAIN_BASE', () => {
  it('无 token 时不带 Authorization 头，有 token 时带 Bearer', () => {
    vi.stubEnv('GH_TOKEN', '');
    vi.stubEnv('GITHUB_TOKEN', '');
    expect(githubHeaders().Authorization).toBeUndefined();
    expect(githubHeaders()['User-Agent']).toBe('zenithjoy-staff-hub');

    vi.stubEnv('GH_TOKEN', 'ghp_fake');
    expect(githubHeaders().Authorization).toBe('Bearer ghp_fake');
  });

  it('仓库名与 Brain 基址可被 env 覆盖，env 未设置时回退默认值', () => {
    // ?? 只在 undefined 时回退，所以"缺省"必须用删除 env 而不是置空串来验证
    const origRepo = process.env.STAFF_HUB_GITHUB_REPO;
    const origBrain = process.env.CECELIA_BRAIN_URL;
    delete process.env.STAFF_HUB_GITHUB_REPO;
    delete process.env.CECELIA_BRAIN_URL;
    try {
      expect(githubRepo()).toBe('perfectuser21/zenithjoy-workspace');
      expect(CECELIA_BRAIN_BASE()).toBe('http://host.docker.internal:5221');
    } finally {
      if (origRepo !== undefined) process.env.STAFF_HUB_GITHUB_REPO = origRepo;
      if (origBrain !== undefined) process.env.CECELIA_BRAIN_URL = origBrain;
    }

    vi.stubEnv('STAFF_HUB_GITHUB_REPO', 'acme/repo');
    vi.stubEnv('CECELIA_BRAIN_URL', 'http://brain.test');
    expect(githubRepo()).toBe('acme/repo');
    expect(CECELIA_BRAIN_BASE()).toBe('http://brain.test');
  });
});

describe('fetchJourneyFeatures', () => {
  it('按 journey_id 查询 Brain，返回数组原样透传', async () => {
    axiosGetMock.mockResolvedValue({ data: [{ id: 'f1', name: '能力1' }] });
    const features = await fetchJourneyFeatures('journey-abc');
    expect(features).toEqual([{ id: 'f1', name: '能力1' }]);
    expect(axiosGetMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/brain/journey_features'),
      expect.objectContaining({ params: { journey_id: 'journey-abc' } })
    );
  });

  it('Brain 返回非数组（如错误对象）时兜底为空数组，不抛异常', async () => {
    axiosGetMock.mockResolvedValue({ data: { error: 'boom' } });
    await expect(fetchJourneyFeatures('journey-abc')).resolves.toEqual([]);
  });
});

describe('fetchLatestSmokeRun', () => {
  it('按 hint 在 name/display_title 上做大小写不敏感匹配，命中第一条', async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        workflow_runs: [
          { id: 1, name: 'Unrelated CI', display_title: '', conclusion: 'success' },
          { id: 2, name: 'Golden-Path-4 Smoke', display_title: '', conclusion: 'failure' },
        ],
      },
    });
    const run = await fetchLatestSmokeRun(['golden-path-4']);
    expect(run?.id).toBe(2);
  });

  it('无匹配 run 或返回体缺 workflow_runs 时返回 null', async () => {
    axiosGetMock.mockResolvedValue({ data: { workflow_runs: [{ id: 1, name: 'Unrelated', display_title: '' }] } });
    await expect(fetchLatestSmokeRun(['golden-path-4'])).resolves.toBeNull();

    axiosGetMock.mockResolvedValue({ data: {} });
    await expect(fetchLatestSmokeRun(['golden-path-4'])).resolves.toBeNull();
  });
});
