import { describe, expect, it } from 'vitest';
import { VALID_REPORT_ERROR_CODES, normalizeReportErrorCode } from './acquisition';

/**
 * 真机确诊(2026-08-19 小白 realme RMX3478)：设备端队列被一个永不结束的 currentJob 堵死后，
 * 后续任务只入队不派发、全程零日志；中台这边只看到任务被拉走标 running，
 * 10 分钟后被 sweep-timeouts 收成 failed —— 这 10 分钟里中台以为设备在干活，实际它是哑的。
 *
 * 修法是设备端超时自回收并主动上报 `AGENT_QUEUE_STALLED`。
 * 但 report-videos 的 error_code 走白名单，不在表里的值会被
 * normalizeReportErrorCode() 静默压成 UNKNOWN —— 那样这条诊断信息等于没发。
 * 所以白名单必须同步认这个新枚举，否则设备端改了也白改。
 */
describe('collect report error_code 白名单 — AGENT_QUEUE_STALLED [REGRESSION]', () => {
  it('AGENT_QUEUE_STALLED 必须在白名单里，不能被压成 UNKNOWN', () => {
    expect(VALID_REPORT_ERROR_CODES.has('AGENT_QUEUE_STALLED')).toBe(true);
    expect(normalizeReportErrorCode('AGENT_QUEUE_STALLED')).toBe('AGENT_QUEUE_STALLED');
  });

  it('既有枚举值不受影响（向后兼容）', () => {
    for (const code of ['KEYWORD_NO_RESULT', 'PLATFORM_LIMITED', 'STAGE2_DISPATCH_EXHAUSTED', 'stage1_empty']) {
      expect(normalizeReportErrorCode(code)).toBe(code);
    }
  });

  it('白名单外的值仍然归一为 UNKNOWN，空值仍然为 null', () => {
    expect(normalizeReportErrorCode('SOMETHING_MADE_UP')).toBe('UNKNOWN');
    expect(normalizeReportErrorCode(null)).toBeNull();
    expect(normalizeReportErrorCode(undefined)).toBeNull();
    expect(normalizeReportErrorCode('')).toBeNull();
  });
});
