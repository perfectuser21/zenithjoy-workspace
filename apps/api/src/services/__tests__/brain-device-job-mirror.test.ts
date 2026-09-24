/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { buildMirrorTitle, mapWorkerStatus, buildMirrorPayload } from '../brain-device-job-mirror';

describe('buildMirrorTitle', () => {
  // Brain 有唯一索引 UNIQUE(title, goal_id, project_id) WHERE status IN ('queued','in_progress')。
  // 金诺两台同时跑同一个词，title 一样就会 23505 被咽掉 —— 这正是本次要修的病。
  it('带上序列号尾4位与时分，同词不同机不撞', () => {
    const a = buildMirrorTitle('获客采收·AI人工智能训练师', 'ANGYVB4227006983', '2026-09-24T14:30:00Z', 'w1abc234');
    const b = buildMirrorTitle('获客采收·AI人工智能训练师', 'ANGYVB4402004137', '2026-09-24T14:30:00Z', 'w2def567');
    expect(a).not.toBe(b);
    expect(a).toContain('6983');
    expect(a).toContain('1430');
  });

  it('同机同词同分钟由 task id 前6位兜底', () => {
    const a = buildMirrorTitle('获客采收·X', 'S0001234', '2026-09-24T14:30:00Z', 'aaaaaa11');
    const b = buildMirrorTitle('获客采收·X', 'S0001234', '2026-09-24T14:30:59Z', 'bbbbbb22');
    expect(a).not.toBe(b);
  });

  it('原标题保留在开头，人能一眼认出这是什么活', () => {
    expect(buildMirrorTitle('触达·单#246 小海', 'S0001234', '2026-09-24T14:30:00Z', 'aaaaaa11'))
      .toMatch(/^触达·单#246 小海 · /);
  });
});

describe('mapWorkerStatus', () => {
  // 页面 STATUS_MAP: queued/in_progress/completed/failed/blocked，未知一律落 blocked 不静默骗人
  it('四档映射到页面认得的状态', () => {
    expect(mapWorkerStatus('running')).toBe('in_progress');
    expect(mapWorkerStatus('completed')).toBe('completed');
    expect(mapWorkerStatus('failed')).toBe('failed');
    expect(mapWorkerStatus('needs_review')).toBe('blocked');
  });
  it('未知状态落 blocked，不猜成 completed', () => {
    expect(mapWorkerStatus('whatever')).toBe('blocked');
  });
});

describe('buildMirrorPayload', () => {
  const p = buildMirrorPayload({ serial: 'ANGYVB4227006983', workerTaskId: 'wt-1', startedAt: '2026-09-24T14:30:00Z' });

  it('标只读：页面不该给改时间/取消按钮，点了对真机零作用', () => {
    expect(p.read_only).toBe(true);
  });
  it('source=cron 而非 oneoff：领单器只认 oneoff，否则会把已在跑的活再领一遍', () => {
    expect(p.source).toBe('cron');
  });
  it('headed_manual 防 Brain tick 把这条活派给 LLM 执行体真去跑一轮采收', () => {
    expect(p.headed_manual).toBe(true);
  });
  it('serial 存 adb 看得到的裸序列号', () => {
    expect(p.serial).toBe('ANGYVB4227006983');
  });
  it('幂等键用 worker_task id，curl 重试不会重复建', () => {
    expect(p.idempotency_key).toBe('wt-1');
  });
});

import { vi } from 'vitest';
vi.mock('../../db/brain-pool', () => ({ getBrainPool: vi.fn() }));
vi.mock('../../db/connection', () => ({ default: { query: vi.fn() } }));
import { getBrainPool } from '../../db/brain-pool';
import localPool from '../../db/connection';
import { createMirrorJob, completeMirrorJob } from '../brain-device-job-mirror';

describe('completeMirrorJob 的 SQL 必须给 $2 显式标类型', () => {
  // 0924 生产事故：$2 同时喂给 status（varchar 列）和 IN ('completed','failed') 的文本比较，
  // 不标 ::text 时 PG 报 "inconsistent types deduced for parameter $2"，收尾永远不回写、
  // 页面停在"执行中"。1030 个测试全绿也抓不到——pool 是 mock 的，SQL 文本没人真跑。
  // 所以这里只能直接断言 SQL 文本，这是 mock 测试唯一能守住 SQL 正确性的办法。
  it('status 与 CASE WHEN 两处的 $2 都带 ::text', async () => {
    const q = vi.fn(async () => ({ rows: [] }));
    (getBrainPool as any).mockReturnValue({ query: q });
    await completeMirrorJob('brain-1', 'completed', {});
    const sql = q.mock.calls[0][0] as string;
    expect(sql).toMatch(/SET\s+status\s*=\s*\$2::text/i);
    expect(sql).toMatch(/CASE\s+WHEN\s+\$2::text\s+IN/i);
    // 反过来防退化：不允许出现裸的 $2（后面不跟 ::）
    expect(sql).not.toMatch(/\$2(?!::)/);
  });
});

describe('createMirrorJob', () => {
  const args = {
    workerTaskId: 'wt-1', agentId: 'agent-uuid-1', serial: 'ANGYVB4227006983',
    title: '获客采收·AI人工智能训练师', startedAt: '2026-09-24T14:30:00Z',
  };

  beforeEach(() => vi.clearAllMocks());

  it('建单成功时返回 brain task id', async () => {
    (getBrainPool as any).mockReturnValue({ query: vi.fn(async () => ({ rows: [{ id: 'brain-1' }] })) });
    expect(await createMirrorJob(args)).toBe('brain-1');
  });

  it('due_at 必须传值 —— 传 NULL 页面会渲染成 1970-01-01', async () => {
    const q = vi.fn(async () => ({ rows: [{ id: 'brain-1' }] }));
    (getBrainPool as any).mockReturnValue({ query: q });
    await createMirrorJob(args);
    const params = q.mock.calls[0][1] as unknown[];
    expect(params).toContain(args.startedAt);
    expect(params.some((p) => p === null)).toBe(false);
  });

  it('trigger_source 不能用库默认的 brain_auto —— 会被 Brain escalation 静默 paused', async () => {
    const q = vi.fn(async () => ({ rows: [{ id: 'brain-1' }] }));
    (getBrainPool as any).mockReturnValue({ query: q });
    await createMirrorJob(args);
    expect((q.mock.calls[0][1] as unknown[])).toContain('cron');
    expect((q.mock.calls[0][1] as unknown[])).not.toContain('brain_auto');
  });

  it('Brain 没配时不崩，落 outbox 返回 null', async () => {
    (getBrainPool as any).mockReturnValue(null);
    expect(await createMirrorJob(args)).toBeNull();
    expect((localPool as any).query).toHaveBeenCalledWith(
      expect.stringContaining('brain_sync_outbox'), expect.anything(),
    );
  });

  it('Brain 写失败时吞掉异常并落 outbox —— 记账绝不能阻断采收', async () => {
    (getBrainPool as any).mockReturnValue({ query: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) });
    await expect(createMirrorJob(args)).resolves.toBeNull();
    expect((localPool as any).query).toHaveBeenCalledWith(
      expect.stringContaining('brain_sync_outbox'), expect.anything(),
    );
  });
});
