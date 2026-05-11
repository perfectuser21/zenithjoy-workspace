/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * H-2 Bug 9 — Agent client register response 存 agentUuid + WS hello 带字段
 *
 * 覆盖：
 *  - cfg.agentUuid set → hello payload 含 agentUuid (新 Agent v1.0.1+ 复用 register 已创的 row)
 *  - cfg.agentUuid undefined → hello payload 不含 agentUuid (向后兼容老 cfg)
 */
import { describe, it, expect, beforeEach } from 'vitest';

describe('Agent client hello payload [Bug 9]', () => {
  beforeEach(() => {
    // 给 index.ts 一个 dummy license env 防 main() 在 import 时 process.exit(2)
    // (即便如此，main() 仍会尝试 connect — 我们靠 require.main !== module 的 guard 不执行 main)
    process.env.ZENITHJOY_LICENSE = process.env.ZENITHJOY_LICENSE || 'ZJ-TEST-DUMMY';
  });

  it('cfg.agentUuid set → hello payload 含 agentUuid', async () => {
    const mod = await import('../index');
    const payload = mod.buildHelloPayload({
      agentId: 'agent-env-xxx',
      agentUuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      apiUrl: 'wss://api.test/agent-ws',
      licenseKey: 'ZJ-X',
      loggedInAt: 0,
    } as any);
    expect(payload.agentId).toBe('agent-env-xxx');
    expect(payload.agentUuid).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(typeof payload.version).toBe('string');
    expect(Array.isArray(payload.capabilities)).toBe(true);
  });

  it('cfg.agentUuid undefined → hello payload 不含 agentUuid (向后兼容)', async () => {
    const mod = await import('../index');
    const payload = mod.buildHelloPayload({
      agentId: 'old-agent',
      apiUrl: 'wss://api.test/agent-ws',
      licenseKey: 'ZJ-X',
      loggedInAt: 0,
    } as any);
    expect(payload.agentId).toBe('old-agent');
    expect(payload.agentUuid).toBeUndefined();
  });
});
