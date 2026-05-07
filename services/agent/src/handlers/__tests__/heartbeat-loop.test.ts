// services/agent/src/handlers/__tests__/heartbeat-loop.test.ts
//
// Walking Skeleton #1 — heartbeat-loop unit test
//
// 验证：
//   - 每次 sendOnce 走 POST /api/agent/heartbeat，body 含 license/version/hostname
//   - 第一次响应里的 agent_id 被记住，后续请求把 agent_id 带回去
//   - queued_tasks 数组里每个 task 都派发到 onTask 回调
//   - start() / stop() 启停 setInterval

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatLoop, type HeartbeatTask } from '../heartbeat-loop';

describe('HeartbeatLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('POST /api/agent/heartbeat with license/version/hostname', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ ok: true, agent_id: 'agent-1', queued_tasks: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const loop = new HeartbeatLoop({
      apiBase: 'https://api.example.com',
      license: 'zj-test',
      version: '0.1.0',
      hostname: 'host-x',
      fetchImpl: fetchImpl as any,
    });

    const resp = await loop.sendOnce();
    expect(resp?.agent_id).toBe('agent-1');
    expect(loop.getAgentId()).toBe('agent-1');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/agent/heartbeat');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body.license).toBe('zj-test');
    expect(body.version).toBe('0.1.0');
    expect(body.hostname).toBe('host-x');
  });

  it('subsequent heartbeats include agent_id once known', async () => {
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      call += 1;
      return new Response(
        JSON.stringify({ ok: true, agent_id: 'agent-keep', queued_tasks: [] }),
        { status: 200 },
      );
    });

    const loop = new HeartbeatLoop({
      apiBase: 'https://api.example.com',
      license: 'zj-test',
      version: '0.1.0',
      hostname: 'host-x',
      fetchImpl: fetchImpl as any,
    });

    await loop.sendOnce();
    await loop.sendOnce();

    expect(call).toBe(2);
    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
    expect(secondBody.agent_id).toBe('agent-keep');
  });

  it('dispatches each queued_task to onTask handler', async () => {
    const tasks: HeartbeatTask[] = [
      { task_id: 't1', platform: 'qr_bind_douyin', payload: { account_label: 'default' } },
      { task_id: 't2', platform: 'folder_bind', payload: { local_path: '/tmp/v' } },
    ];
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ ok: true, agent_id: 'agent-1', queued_tasks: tasks }),
        { status: 200 },
      ),
    );
    const onTask = vi.fn<(t: HeartbeatTask) => Promise<void>>(async () => {});

    const loop = new HeartbeatLoop({
      apiBase: 'https://api.example.com',
      license: 'zj-test',
      version: '0.1.0',
      hostname: 'host-x',
      fetchImpl: fetchImpl as any,
      onTask,
    });

    await loop.sendOnce();

    expect(onTask).toHaveBeenCalledTimes(2);
    expect(onTask.mock.calls[0][0]).toEqual(tasks[0]);
    expect(onTask.mock.calls[1][0]).toEqual(tasks[1]);
  });

  it('start() schedules at intervalMs, stop() cancels timer', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ ok: true, agent_id: 'agent-1', queued_tasks: [] }),
        { status: 200 },
      ),
    );

    const loop = new HeartbeatLoop({
      apiBase: 'https://api.example.com',
      license: 'zj-test',
      version: '0.1.0',
      hostname: 'host-x',
      intervalMs: 30_000,
      fetchImpl: fetchImpl as any,
    });

    loop.start();
    // Initial heartbeat fires immediately on start
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    loop.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns null and does not throw on network error', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('boom');
    });
    const loop = new HeartbeatLoop({
      apiBase: 'https://api.example.com',
      license: 'zj-test',
      version: '0.1.0',
      hostname: 'host-x',
      fetchImpl: fetchImpl as any,
    });
    const resp = await loop.sendOnce();
    expect(resp).toBeNull();
  });
});
