import { describe, it, expect } from 'vitest';
import { explainError, KNOWN_ERROR_CODES } from '../error-codes';

describe('失败码翻译', () => {
  it('把机器码翻成人话并给出下一步（主理人原话：没跟我说为啥失败）', () => {
    const e = explainError('executor_lost')!;
    expect(e.label).toBe('机器失联');
    expect(e.hint).toMatch(/10 分钟|上报/);
    expect(e.needsHuman).toBe(false); // 系统自己会重来，不用人管
  });

  it('区分「要人处理」与「系统自愈」', () => {
    expect(explainError('device_offline')!.needsHuman).toBe(true);
    expect(explainError('captcha')!.needsHuman).toBe(true);
    expect(explainError('superseded')!.needsHuman).toBe(false);
    expect(explainError('lock_busy')!.needsHuman).toBe(false);
  });

  it('没登记的码原样显示，但标成要人看（不认识的失败不能默默吞掉）', () => {
    const e = explainError('some_new_code')!;
    expect(e.label).toBe('some_new_code');
    expect(e.needsHuman).toBe(true);
    expect(e.hint).toMatch(/未登记/);
  });

  it('空码返回 null，页面据此不渲染失败区', () => {
    expect(explainError(null)).toBeNull();
    expect(explainError(undefined)).toBeNull();
    expect(explainError('')).toBeNull();
  });

  it('生产链实际会写的码都已登记', () => {
    // 这些码散落在 wall-report.sh / outreach-tick.sh / worker-lease-sweeper 里，漏一个页面就露机器码
    for (const c of ['executor_lost', 'superseded', 'lock_busy', 'device_offline', 'keywords_unavailable', 'transient_exhausted']) {
      expect(KNOWN_ERROR_CODES).toContain(c);
    }
  });

  it('每条登记都有结论与下一步，不能只有结论', () => {
    for (const c of KNOWN_ERROR_CODES) {
      const e = explainError(c)!;
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.hint.length).toBeGreaterThan(8);
      expect(e.label).not.toBe(c); // 登记过的就不该再露机器码
    }
  });
});
