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

  // 防线 1（Agent）：心跳必须携带稳定 machine_id，让中台即便 agents 表暂缺该行，
  // 也能经 license_machines/service_agents 反查租户（修 Line04 P0② NO_TENANT_CONTEXT）。
  it('heartbeat body includes machine_id when machineId option set', async () => {
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
      machineId: '425b144f077a667bb42666821220e06d',
      fetchImpl: fetchImpl as any,
    });
    await loop.sendOnce();
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.machine_id, '心跳 body 必须带 machine_id').toBe(
      '425b144f077a667bb42666821220e06d',
    );
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

  it('forwards task.type from heartbeat response to onTask callback', async () => {
    const queuedTask: HeartbeatTask = {
      task_id: 'task-video-1',
      platform: 'douyin',
      type: 'video',
      payload: { folder_path: '/tmp/x' },
    };
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          agent_id: 'agent-1',
          queued_tasks: [queuedTask],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const received: HeartbeatTask[] = [];
    const loop = new HeartbeatLoop({
      apiBase: 'https://api.example.com',
      license: 'zj-test',
      version: '0.1.0',
      hostname: 'host-x',
      fetchImpl: fetchImpl as any,
      onTask: (t) => {
        received.push(t);
      },
    });

    await loop.sendOnce();

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('video');
    expect(received[0].platform).toBe('douyin');
    expect(received[0].task_id).toBe('task-video-1');
  });

  // ── 身份统一（cp-06270030）：心跳必须带 register 返的 agentUuid，
  //    让中台按 (tenant, hostname) 复用同一行，不再生成新 ws1-<hash> 裂身份 ──
  it('心跳 POST body 含 register 返的 agentUuid（首次心跳即带，不依赖响应）', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ ok: true, agent_id: 'ws1-server-id', queued_tasks: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const loop = new HeartbeatLoop({
      apiBase: 'https://api.example.com',
      license: 'zj-test',
      version: '0.1.0',
      hostname: 'host-x',
      agentUuid: 'uuid-from-register-abc',
      fetchImpl: fetchImpl as any,
    });

    await loop.sendOnce();

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    // 首次心跳就带 register UUID（响应还没回来），中台据此复用行
    expect(body.agent_id).toBe('uuid-from-register-abc');
    expect(body.agent_uuid).toBe('uuid-from-register-abc');
  });

  it('未传 agentUuid 时不带 agent_uuid 字段（向后兼容老 agent）', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true, agent_id: 'agent-1', queued_tasks: [] }), {
        status: 200,
      }),
    );
    const loop = new HeartbeatLoop({
      apiBase: 'https://api.example.com',
      license: 'zj-test',
      version: '0.1.0',
      hostname: 'host-x',
      fetchImpl: fetchImpl as any,
    });
    await loop.sendOnce();
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.agent_uuid).toBeUndefined();
  });
});
