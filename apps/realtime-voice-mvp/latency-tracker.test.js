import { describe, it, expect } from 'vitest';
import { computeTurnLatency } from './latency-tracker.js';

describe('computeTurnLatency', () => {
  it('三个时间戳齐全时正确计算三段耗时', () => {
    const result = computeTurnLatency({
      lastAsrAt: 1000,
      chatStartAt: 1300,
      firstTtsAt: 1800,
      chatEndedAt: 2500,
    });
    expect(result).toEqual({ asrToChatMs: 300, chatToTtsMs: 500, totalMs: 1500 });
  });

  it('lastAsrAt 缺失时三段耗时全部为 null', () => {
    const result = computeTurnLatency({
      lastAsrAt: null,
      chatStartAt: 1300,
      firstTtsAt: 1800,
      chatEndedAt: 2500,
    });
    expect(result).toEqual({ asrToChatMs: null, chatToTtsMs: null, totalMs: null });
  });

  it('chatStartAt 缺失时 asrToChatMs 和 chatToTtsMs 为 null，totalMs 仍可计算', () => {
    const result = computeTurnLatency({
      lastAsrAt: 1000,
      chatStartAt: null,
      firstTtsAt: 1800,
      chatEndedAt: 2500,
    });
    expect(result).toEqual({ asrToChatMs: null, chatToTtsMs: null, totalMs: 1500 });
  });

  it('firstTtsAt 缺失时 chatToTtsMs 为 null，其余正常计算', () => {
    const result = computeTurnLatency({
      lastAsrAt: 1000,
      chatStartAt: 1300,
      firstTtsAt: null,
      chatEndedAt: 2500,
    });
    expect(result).toEqual({ asrToChatMs: 300, chatToTtsMs: null, totalMs: 1500 });
  });

  it('chatEndedAt 缺失时抛出异常（调用方必须保证有结束时间）', () => {
    expect(() =>
      computeTurnLatency({ lastAsrAt: 1000, chatStartAt: 1300, firstTtsAt: 1800, chatEndedAt: null })
    ).toThrow('chatEndedAt is required');
  });
});
