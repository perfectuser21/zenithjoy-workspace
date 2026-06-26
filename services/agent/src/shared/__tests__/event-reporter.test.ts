// services/agent/src/shared/__tests__/event-reporter.test.ts
//
// Sprint cp-06261900 — Agent 观测上报单测（TDD commit-1 红）
//
// reportEvent(cfg, {kind,...}) → POST ${apiBase}/api/agent/events 带 x-license-key。
// 失败必须静默吞（绝不崩 agent）。契约见 observability-contract.md「Agent 侧（T1）B」。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reportEvent } from '../event-reporter';

describe('event-reporter — reportEvent [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POST 到 /api/agent/events，带 x-license-key 头与正确 body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => '{"success":true}' });
    vi.stubGlobal('fetch', fetchMock);

    await reportEvent(
      { apiBase: 'https://api.example.com/', license: 'ZJ-KEY-1', agentId: 'agent-x' },
      { kind: 'upgrade', phase: 'download', percent: 42, message: '下载中' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/agent/events');
    expect(init.method).toBe('POST');
    expect(init.headers['x-license-key']).toBe('ZJ-KEY-1');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      agent_id: 'agent-x',
      kind: 'upgrade',
      phase: 'download',
      percent: 42,
      message: '下载中',
    });
  });

  it('log 类带 level + message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    await reportEvent(
      { apiBase: 'https://api.example.com', license: 'K', agentId: 'a1' },
      { kind: 'log', level: 'error', message: 'boom' },
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.kind).toBe('log');
    expect(body.level).toBe('error');
    expect(body.message).toBe('boom');
  });

  it('fetch reject → 静默吞，不抛（不崩 agent）', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      reportEvent(
        { apiBase: 'https://api.example.com', license: 'K', agentId: 'a1' },
        { kind: 'log', level: 'error', message: 'x' },
      ),
    ).resolves.toBeUndefined();
  });

  it('HTTP 非 2xx → 静默吞，不抛', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      reportEvent(
        { apiBase: 'https://api.example.com', license: 'K', agentId: 'a1' },
        { kind: 'upgrade', phase: 'failed', message: 'x' },
      ),
    ).resolves.toBeUndefined();
  });

  it('无 apiBase 或无 license → 跳过（不 fetch，不抛）', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await reportEvent({ apiBase: '', license: 'K', agentId: 'a1' }, { kind: 'log', message: 'x' });
    await reportEvent(
      { apiBase: 'https://api.example.com', license: '', agentId: 'a1' },
      { kind: 'log', message: 'x' },
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
