// services/agent/src/shared/__tests__/task-event-reporter.test.ts
//
// Sprint cp-06262240 — 任务观测上报单测（TDD commit-1 红）
//
// 断言：任务失败时上报被调用且 message 含 error；上报失败静默吞不外泄；
// 平台→module 映射；任务开始/成功上报。让 qr-bind 失败原因（playwright 未安装等）能进中台。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  reportTaskStart,
  reportTaskFail,
  reportTaskOk,
  platformToModule,
  __setTaskReportImpl,
} from '../task-event-reporter';

const CFG = { apiBase: 'https://api.example.com', license: 'ZJ-KEY-1', agentId: 'agent-x' };

describe('task-event-reporter [BEHAVIOR]', () => {
  beforeEach(() => {
    __setTaskReportImpl(undefined); // 恢复默认
  });

  it('任务失败：reportImpl 被调用，level=error 且 message 含原始 error 文本', async () => {
    const impl = vi.fn().mockResolvedValue(undefined);
    __setTaskReportImpl(impl);

    await reportTaskFail(CFG, {
      platform: 'qr_bind_douyin_burner',
      taskId: 't-123',
      error: 'playwright 未安装',
      accountLabel: 'burner01',
    });

    expect(impl).toHaveBeenCalledTimes(1);
    const [cfgArg, event] = impl.mock.calls[0];
    expect(cfgArg).toEqual(CFG);
    expect(event.kind).toBe('log');
    expect(event.level).toBe('error');
    expect(event.message).toContain('playwright 未安装');
    expect(event.message).toContain('qr_bind_douyin_burner');
    expect(event.context).toMatchObject({ task_id: 't-123', account_label: 'burner01' });
  });

  it('任务开始：level=info，message 含 platform + taskId', async () => {
    const impl = vi.fn().mockResolvedValue(undefined);
    __setTaskReportImpl(impl);

    await reportTaskStart(CFG, { platform: 'qr_bind/douyin', taskId: 't-9' });

    expect(impl).toHaveBeenCalledTimes(1);
    const [, event] = impl.mock.calls[0];
    expect(event.level).toBe('info');
    expect(event.message).toContain('任务开始');
    expect(event.message).toContain('qr_bind/douyin');
    expect(event.message).toContain('t-9');
  });

  it('任务成功：level=info，message 含「成功」', async () => {
    const impl = vi.fn().mockResolvedValue(undefined);
    __setTaskReportImpl(impl);

    await reportTaskOk(CFG, { platform: 'douyin', taskId: 't-5' });

    const [, event] = impl.mock.calls[0];
    expect(event.level).toBe('info');
    expect(event.message).toContain('成功');
  });

  it('上报实现抛异常时被静默吞，不外泄（绝不崩任务）', async () => {
    __setTaskReportImpl(() => {
      throw new Error('网络炸了');
    });
    // 不应 reject
    await expect(
      reportTaskFail(CFG, { platform: 'douyin', taskId: 't-x', error: 'boom' }),
    ).resolves.toBeUndefined();
  });

  it('上报实现返回 reject 的 Promise 时也被静默吞', async () => {
    __setTaskReportImpl(() => Promise.reject(new Error('rejected')));
    await expect(
      reportTaskStart(CFG, { platform: 'douyin', taskId: 't-y' }),
    ).resolves.toBeUndefined();
  });

  it('platformToModule 把平台映射到 line', () => {
    expect(platformToModule('qr_bind_douyin_burner')).toBe('line02');
    expect(platformToModule('crawl_comments_douyin_burner')).toBe('line02');
    expect(platformToModule('qr_bind_douyin')).toBe('line01');
    expect(platformToModule('douyin')).toBe('line01');
    expect(platformToModule('qr_bind/kuaishou')).toBe('line00');
    expect(platformToModule('wechat_qr_bind')).toBe('line04');
    expect(platformToModule(undefined)).toBeUndefined();
  });
});
