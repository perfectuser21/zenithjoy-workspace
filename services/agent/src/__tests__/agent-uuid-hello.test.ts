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

// 身份统一（cp-06270030）：事件上报 cfg.agentId 必须 = register 返的 agentUuid，
//   不是运行期 agent-env-xxx 文本，才能匹配中台去重后的机器行。
describe('buildEventReporterConfig — 事件上报身份统一 [cp-06270030]', () => {
  beforeEach(() => {
    process.env.ZENITHJOY_LICENSE = process.env.ZENITHJOY_LICENSE || 'ZJ-TEST-DUMMY';
  });

  it('cfg.agentUuid set → eventCfg.agentId === cfg.agentUuid（非 agent-env 文本）', async () => {
    const mod = await import('../index');
    const cfg = {
      agentId: 'agent-env-zzz',
      agentUuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      apiUrl: 'wss://api.test/agent-ws',
      licenseKey: 'ZJ-X',
      loggedInAt: 0,
    } as any;
    const eventCfg = mod.buildEventReporterConfig(cfg, 'https://api.test');
    expect(eventCfg.agentId).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    expect(eventCfg.agentId).not.toBe('agent-env-zzz');
    expect(eventCfg.apiBase).toBe('https://api.test');
    expect(eventCfg.license).toBe('ZJ-X');
  });

  it('cfg.agentUuid 缺失 → 退回 agentId（旁路观测 graceful）', async () => {
    const mod = await import('../index');
    const cfg = {
      agentId: 'agent-env-fallback',
      apiUrl: 'wss://api.test/agent-ws',
      licenseKey: 'ZJ-X',
      loggedInAt: 0,
    } as any;
    const eventCfg = mod.buildEventReporterConfig(cfg, 'https://api.test');
    expect(eventCfg.agentId).toBe('agent-env-fallback');
  });
});
