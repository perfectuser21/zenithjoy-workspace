/**
 * acquisition-dispatch.api.ts 单元测试 — mock global fetch，验证 URL / 方法 / body / 信封解析 / 错误抛出。
 * 配对 lint-test-pairing：apps/dashboard/src/api/acquisition-dispatch.api.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchAcquisitionConfig,
  updateAcquisitionConfig,
  buildDispatch,
  runDispatch,
  fetchDispatchPlan,
  fetchCookieHealth,
  type AcquisitionConfigPatch,
} from './acquisition-dispatch.api';

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = init;
  return vi.fn().mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  } as unknown as Response);
}

const SAMPLE_PATCH: AcquisitionConfigPatch = {
  collect_rounds_per_day: 2,
  keywords_per_round_min: 3,
  keywords_per_round_max: 5,
  collect_active_start: '09:00',
  collect_active_end: '21:00',
  burner_count: 3,
  dm_per_hour: 5,
  dm_per_day: 30,
  dm_interval_min_sec: 300,
  dm_interval_max_sec: 900,
  dm_active_start: '09:00',
  dm_active_end: '22:00',
  nurture_per_day_min: 1,
  nurture_per_day_max: 2,
  cookie_check_interval_hours: 6,
};

describe('acquisition-dispatch.api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchAcquisitionConfig 调 GET /api/acquisition/config 返回 data', async () => {
    const f = mockFetchOnce({ success: true, data: SAMPLE_PATCH });
    vi.stubGlobal('fetch', f);

    const out = await fetchAcquisitionConfig();
    expect(out).toEqual(SAMPLE_PATCH);
    const [url, opts] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/acquisition/config');
    expect(opts.credentials).toBe('include');
  });

  it('updateAcquisitionConfig 用 PUT + JSON body 调 /api/acquisition/config', async () => {
    const f = mockFetchOnce({ success: true, data: SAMPLE_PATCH });
    vi.stubGlobal('fetch', f);

    const out = await updateAcquisitionConfig(SAMPLE_PATCH);
    expect(out).toEqual(SAMPLE_PATCH);
    const [url, opts] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/acquisition/config');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body as string)).toEqual(SAMPLE_PATCH);
  });

  it('buildDispatch 用 POST 调 /dispatch/build 返回 {scored, assigned}', async () => {
    const f = mockFetchOnce({ success: true, data: { scored: 4, assigned: 6 } });
    vi.stubGlobal('fetch', f);

    const out = await buildDispatch();
    expect(out).toEqual({ scored: 4, assigned: 6 });
    const [url, opts] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/acquisition/dispatch/build');
    expect(opts.method).toBe('POST');
  });

  it('runDispatch 用 POST 调 /dispatch/run 返回 {dispatched}', async () => {
    const f = mockFetchOnce({ success: true, data: { dispatched: 2 } });
    vi.stubGlobal('fetch', f);

    const out = await runDispatch();
    expect(out).toEqual({ dispatched: 2 });
    const [url, opts] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/acquisition/dispatch/run');
    expect(opts.method).toBe('POST');
  });

  it('fetchDispatchPlan 调 GET /dispatch/plan，带 status 拼 query', async () => {
    const plan = [
      { id: 'a1', lead_id: 'l1', nickname: '客户A', relevance_score: 88, profile_url: 'u', account_label: 'perfect-02', status: 'queued', scheduled_for: 'x' },
    ];
    const f = mockFetchOnce({ success: true, data: { plan, total: plan.length } });
    vi.stubGlobal('fetch', f);

    const out = await fetchDispatchPlan('queued');
    expect(out).toEqual(plan);
    const url = f.mock.calls[0][0] as string;
    expect(url).toContain('/api/acquisition/dispatch/plan');
    expect(url).toContain('status=queued');
  });

  it('fetchDispatchPlan 不传 status 时无 query', async () => {
    const f = mockFetchOnce({ success: true, data: { plan: [], total: 0 } });
    vi.stubGlobal('fetch', f);

    await fetchDispatchPlan();
    const url = f.mock.calls[0][0] as string;
    expect(url).not.toContain('?');
  });

  it('fetchCookieHealth 调 GET /cookie-health 返回 items + alert_count', async () => {
    const result = {
      items: [
        { account_label: 'perfect-01', role: 'main', health: 'healthy', bound_at: 'x', needs_rescan: false },
        { account_label: 'perfect-02', role: 'burner', health: 'expired', bound_at: null, needs_rescan: true },
      ],
      alert_count: 1,
    };
    const f = mockFetchOnce({ success: true, data: result });
    vi.stubGlobal('fetch', f);

    const out = await fetchCookieHealth();
    expect(out).toEqual(result);
    expect(f.mock.calls[0][0]).toContain('/api/acquisition/cookie-health');
  });

  it('success:false 时抛出 error.message', async () => {
    const f = mockFetchOnce(
      { success: false, error: { code: 'BAD_RANGE', message: 'dm_per_day 超出范围' } },
      { ok: false, status: 400 }
    );
    vi.stubGlobal('fetch', f);

    await expect(updateAcquisitionConfig(SAMPLE_PATCH)).rejects.toThrow('dm_per_day 超出范围');
  });

  it('响应非 JSON 时抛出带状态码的错误', async () => {
    const f = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    vi.stubGlobal('fetch', f);

    await expect(fetchAcquisitionConfig()).rejects.toThrow('500');
  });
});
