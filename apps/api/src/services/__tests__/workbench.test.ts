/**
 * workbench service 测试 — Brain 转发与降级语义
 *
 * Task: 9cc10ff2
 *   - summary：三路并取；acceptance 或 in_progress 任一失败 → availability='degraded'（不抛）
 *   - feedback：payload 组装（source='api'、nature 白名单、link→ref_pr_url、email 前缀）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const axiosGetMock = vi.hoisted(() => vi.fn());
const axiosPostMock = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({
  default: { get: axiosGetMock, post: axiosPostMock, isAxiosError: () => false },
}));

const fetchPendingRunsMock = vi.hoisted(() => vi.fn());
vi.mock('../acceptance', () => ({
  fetchPendingRuns: fetchPendingRunsMock,
}));

import { fetchWorkbenchSummary, submitWorkbenchFeedback } from '../workbench';

describe('fetchWorkbenchSummary', () => {
  beforeEach(() => {
    axiosGetMock.mockReset();
    axiosPostMock.mockReset();
    fetchPendingRunsMock.mockReset();
  });

  it('[BEHAVIOR] 三路正常 → ready + 指标聚合正确', async () => {
    fetchPendingRunsMock.mockResolvedValue({
      availability: 'ready',
      runs: [{ run_key: 'r1', gp_title: 'GP-X', checks: [{}, {}] }],
      message: null,
    });
    const fresh = new Date().toISOString();
    const stale = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    axiosGetMock.mockImplementation((url: string) => {
      if (url.includes('status=in_progress')) {
        return Promise.resolve({ data: [{ id: 't1', title: 'UI③', task_type: 'dev' }] });
      }
      return Promise.resolve({ data: [
        { id: 'c1', completed_at: fresh },
        { id: 'c2', completed_at: stale },
      ] });
    });

    const s = await fetchWorkbenchSummary();
    expect(s.availability).toBe('ready');
    expect(s.metrics).toEqual({ pending_acceptance: 1, ai_running: 1, completed_7d: 1 });
    expect(s.pending_runs[0]).toEqual({ run_key: 'r1', gp_title: 'GP-X', checks_total: 2 });
  });

  it('[BEHAVIOR] Brain tasks 拉取失败 → degraded + message，不抛异常', async () => {
    fetchPendingRunsMock.mockResolvedValue({ availability: 'ready', runs: [], message: null });
    axiosGetMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const s = await fetchWorkbenchSummary();
    expect(s.availability).toBe('degraded');
    expect(s.message).toContain('ECONNREFUSED');
    expect(s.metrics.ai_running).toBe(0);
  });
});

describe('submitWorkbenchFeedback', () => {
  beforeEach(() => {
    axiosPostMock.mockReset();
  });

  it('[BEHAVIOR] payload 组装：source=api、issue 白名单、link→ref_pr_url、email 前缀', async () => {
    axiosPostMock.mockResolvedValue({ data: { id: 'cap-9', status: 'clarified', dedupe_hit: false } });

    const receipt = await submitWorkbenchFeedback({
      content: '按钮坏了',
      nature: 'issue',
      link: 'https://github.com/x/y/pull/9',
      email: 'staff@test.com',
    });

    expect(receipt.id).toBe('cap-9');
    const [url, payload] = axiosPostMock.mock.calls[0];
    expect(String(url)).toContain('/api/brain/captures');
    expect(payload).toMatchObject({
      content: '[staff:staff@test.com] 按钮坏了',
      source: 'api',
      nature: 'issue',
      ref_pr_url: 'https://github.com/x/y/pull/9',
    });
  });
});
