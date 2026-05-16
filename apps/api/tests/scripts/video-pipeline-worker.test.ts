import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue({ json: () => Promise.resolve({ data: [] }) }),
);

const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation(
  (fn: TimerHandler, ms?: number) => setTimeout(fn, ms ?? 0) as unknown as ReturnType<typeof setInterval>,
);
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('video-pipeline-worker script', () => {
  beforeAll(async () => {
    await import('../../src/scripts/video-pipeline-worker');
  });

  it('registers a polling interval on startup', () => {
    expect(setIntervalSpy).toHaveBeenCalled();
  });

  it('uses POLL_INTERVAL_MS of 10 seconds', () => {
    const callArgs = setIntervalSpy.mock.calls[0];
    expect(callArgs[1]).toBe(10_000);
  });
});
