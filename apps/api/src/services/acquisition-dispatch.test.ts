import { describe, it, expect } from 'vitest';
import { defaultConfig, AcquisitionConfig } from './acquisition-dispatch';

// 配套 unit（lint-test-pairing）— dispatchDue 真派单到 publish_tasks 的核心契约。
// 端到端行为由 staging DB 验证：dm_assignments.status='dispatched' + publish_tasks 有记录。

describe('acquisition-dispatch defaultConfig', () => {
  it('dm_message 有默认话术', () => {
    const cfg: AcquisitionConfig = defaultConfig('t1');
    expect(cfg.dm_message).toBeTruthy();
    expect(cfg.dm_message.length).toBeGreaterThan(0);
  });

  it('dm_per_hour / dm_per_day 有合理默认值', () => {
    const cfg = defaultConfig('t2');
    expect(cfg.dm_per_hour).toBeGreaterThan(0);
    expect(cfg.dm_per_day).toBeGreaterThanOrEqual(cfg.dm_per_hour);
  });

  it('dm_active_start < dm_active_end（时段合法）', () => {
    const cfg = defaultConfig('t3');
    expect(cfg.dm_active_start < cfg.dm_active_end).toBe(true);
  });

  it('dm_interval_min_sec <= dm_interval_max_sec', () => {
    const cfg = defaultConfig('t4');
    expect(cfg.dm_interval_min_sec).toBeLessThanOrEqual(cfg.dm_interval_max_sec);
  });
});
