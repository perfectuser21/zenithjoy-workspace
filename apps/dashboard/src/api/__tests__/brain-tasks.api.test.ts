/**
 * brain-tasks.api —— 读 Brain task database 的客户端
 *
 * 锁两件在生产上真会咬人的事：
 *
 * 一、**必须带 status 参数**。`/api/brain/tasks` 不带过滤参数时只返回 10 个精简字段
 *    （id/title/description/priority/status/project_id/queued_at/updated_at/due_at/custom_props），
 *    带上 `status=` 或 `task_type=` 才返回完整 70+ 字段。
 *    0923 实测：我不带参数查，得出「device_job 有 0 个」——直接查库是 4 条。
 *    少了 task_type 和 tenant_id，页面就看不出哪条是派给手机的活、算哪个客户的。
 *
 * 二、**HTTP 错误必须抛出来，绝不 catch 成空数组**。空表和读不到长得一模一样，
 *    人会以为「今天没排活」，实际是后台断了。工作机领单器现在实测就在报
 *    BRAIN_UNAVAILABLE，这条路径不是假想的。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchBrainTasks } from '../brain-tasks.api';

const row = (id: string, status: string) => ({
  id,
  title: `任务 ${id}`,
  status,
  task_type: 'device_job',
  tenant_id: 'jinuo',
});

function stubFetch(impl: (url: string) => { ok: boolean; status: number; body: unknown }) {
  const f = vi.fn(async (url: string) => {
    const r = impl(String(url));
    return { ok: r.ok, status: r.status, json: async () => r.body } as Response;
  });
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchBrainTasks', () => {
  it('每个请求都带 status —— 不带就只能拿到精简字段，看不出类型和客户', async () => {
    const f = stubFetch(() => ({ ok: true, status: 200, body: [] }));
    await fetchBrainTasks(['queued', 'in_progress']);

    expect(f).toHaveBeenCalledTimes(2);
    for (const call of f.mock.calls) {
      const url = String(call[0]);
      expect(url).toMatch(/\/api\/brain\/tasks\?/);
      expect(url).toMatch(/status=/);
    }
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('status=queued'))).toBe(true);
    expect(urls.some((u) => u.includes('status=in_progress'))).toBe(true);
  });

  it('多个状态并发取完合并成一个列表', async () => {
    stubFetch((url) =>
      url.includes('status=queued')
        ? { ok: true, status: 200, body: [row('a', 'queued')] }
        : { ok: true, status: 200, body: [row('b', 'in_progress')] }
    );
    const rows = await fetchBrainTasks(['queued', 'in_progress']);
    expect(rows.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('同一条任务在两个状态里都出现时只留一条', async () => {
    stubFetch(() => ({ ok: true, status: 200, body: [row('dup', 'queued')] }));
    const rows = await fetchBrainTasks(['queued', 'in_progress']);
    expect(rows).toHaveLength(1);
  });

  it('HTTP 错误抛出来，不吞成空数组（空表 = 看着像"今天没排活"）', async () => {
    stubFetch(() => ({ ok: false, status: 502, body: { error: 'BRAIN_UNAVAILABLE' } }));
    await expect(fetchBrainTasks(['queued'])).rejects.toThrow(/BRAIN_HTTP_502/);
  });

  it('任意一个状态取失败，整体就算失败 —— 半真的列表比报错更坏', async () => {
    stubFetch((url) =>
      url.includes('status=queued')
        ? { ok: true, status: 200, body: [row('a', 'queued')] }
        : { ok: false, status: 500, body: {} }
    );
    await expect(fetchBrainTasks(['queued', 'in_progress'])).rejects.toThrow(/BRAIN_HTTP_500/);
  });

  it('认得三种返回形态：裸数组 / {tasks} / {data}', async () => {
    for (const body of [[row('x', 'queued')], { tasks: [row('x', 'queued')] }, { data: [row('x', 'queued')] }]) {
      stubFetch(() => ({ ok: true, status: 200, body }));
      const rows = await fetchBrainTasks(['queued']);
      expect(rows.map((r) => r.id)).toEqual(['x']);
    }
  });

  it('带 taskType 时也传进 query（按类型筛同样能拿到全字段）', async () => {
    const f = stubFetch(() => ({ ok: true, status: 200, body: [] }));
    await fetchBrainTasks(['queued'], { taskType: 'device_job' });
    expect(String(f.mock.calls[0][0])).toMatch(/task_type=device_job/);
  });

  it('limit 透传，默认 100', async () => {
    const f = stubFetch(() => ({ ok: true, status: 200, body: [] }));
    await fetchBrainTasks(['queued']);
    expect(String(f.mock.calls[0][0])).toMatch(/limit=100/);

    const f2 = stubFetch(() => ({ ok: true, status: 200, body: [] }));
    await fetchBrainTasks(['queued'], { limit: 20 });
    expect(String(f2.mock.calls[0][0])).toMatch(/limit=20/);
  });
});
