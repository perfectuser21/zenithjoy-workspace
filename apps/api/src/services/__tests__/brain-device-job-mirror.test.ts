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
