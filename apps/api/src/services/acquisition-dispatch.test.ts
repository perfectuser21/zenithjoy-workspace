/**
 * acquisition-dispatch.ts 纯函数单测 — 配对 lint-test-pairing。
 * 引擎的 DB 编排逻辑由 tests/routes/acquisition-dispatch.test.ts 用 fake pool 覆盖；
 * 本文件聚焦无 I/O 的纯函数（打分/校验/时段），确定性。
 */
import { describe, it, expect } from 'vitest';
import {
  heuristicScore,
  validateConfigPatch,
  parseHHMM,
  withinActiveWindow,
  defaultConfig,
} from './acquisition-dispatch';

describe('heuristicScore', () => {
  it('有 sec_uid + profile_url → 80', () => {
    expect(heuristicScore({ sec_uid: 'u1', profile_url: 'https://x', partial: false })).toBe(80);
  });
  it('只有其一 → 50', () => {
    expect(heuristicScore({ sec_uid: 'u1', profile_url: null, partial: false })).toBe(50);
  });
  it('partial / 都没有 → 20', () => {
    expect(heuristicScore({ sec_uid: null, profile_url: null, partial: true })).toBe(20);
  });
});

describe('validateConfigPatch', () => {
  it('合法 patch → null', () => {
    expect(validateConfigPatch({ dm_per_hour: 5, dm_per_day: 30 })).toBeNull();
  });
  it('超范围数值 → 报错串', () => {
    const err = validateConfigPatch({ dm_per_hour: 99999 });
    expect(typeof err).toBe('string');
    expect(err).toContain('dm_per_hour');
  });
  it('非整数 → 报错', () => {
    expect(validateConfigPatch({ dm_per_day: 3.5 })).toBeTruthy();
  });
  it('时间格式非法 → 报错', () => {
    expect(validateConfigPatch({ dm_active_start: '25:99' })).toBeTruthy();
  });
  it('min > max 自洽校验 → 报错', () => {
    expect(validateConfigPatch({ dm_interval_min_sec: 900, dm_interval_max_sec: 300 })).toBeTruthy();
  });
});

describe('parseHHMM', () => {
  it('09:00 → 540 分钟', () => {
    expect(parseHHMM('09:00')).toBe(540);
  });
  it('22:30 → 1350', () => {
    expect(parseHHMM('22:30')).toBe(1350);
  });
});

describe('withinActiveWindow', () => {
  it('窗口内为 true', () => {
    const d = new Date('2026-06-26T10:00:00');
    expect(withinActiveWindow(d, '09:00', '22:00')).toBe(true);
  });
  it('窗口外为 false', () => {
    const d = new Date('2026-06-26T23:30:00');
    expect(withinActiveWindow(d, '09:00', '22:00')).toBe(false);
  });
});

describe('defaultConfig', () => {
  it('默认值符合决策（dm_per_hour=5 / burner_count=3 / rounds=2）', () => {
    const c = defaultConfig('t1');
    expect(c.tenant_id).toBe('t1');
    expect(c.dm_per_hour).toBe(5);
    expect(c.burner_count).toBe(3);
    expect(c.collect_rounds_per_day).toBe(2);
  });
});
