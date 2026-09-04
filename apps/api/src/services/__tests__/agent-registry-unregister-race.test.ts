/**
 * 顺手修的既有 bug（prep-prd 对抗 P1-1）：
 * agent-registry.unregister 只按 agentId 删、不校验 ws 身份 —— 设备快速重连时，
 * 旧 socket 的 close 事件会误删新连接的 entry：设备明明在线却 NOT_CONNECTED，
 * DB 还被误标 offline。
 *
 * 修法：unregister(agentId, ws?) 仅 entry.ws === ws 时删除；不传 ws 保持旧行为
 * （兼容其他调用点），返回是否真正删除（agent-ws close handler 据此决定要不要
 * setAgentOffline）。
 */
import { describe, it, expect, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { AgentRegistry } from '../agent-registry';

const stubWs = (): WebSocket => ({ close: () => {} }) as unknown as WebSocket;
const META = { capabilities: ['android'], version: '2.1.48', tenantId: 'tenant-1' };

describe('AgentRegistry.unregister ws 身份校验（快速重连竞态）', () => {
  it('旧 ws 的 close 不误删新连接 entry，也不发 unregister 事件', () => {
    const reg = new AgentRegistry();
    const ws1 = stubWs();
    const ws2 = stubWs();
    reg.register('a1', META, ws1);
    reg.register('a1', META, ws2); // 快速重连：新 socket 顶替
    const onUnregister = vi.fn();
    reg.on('unregister', onUnregister);

    // 旧 socket 的 close 迟到 → 带旧 ws 调 unregister，必须不删
    expect(reg.unregister('a1', ws1)).toBe(false);
    expect(reg.get('a1')).toBeDefined();
    expect(reg.get('a1')!.ws).toBe(ws2);
    expect(onUnregister).not.toHaveBeenCalled();

    // 当前连接自己的 close → 正常删除 + 发事件
    expect(reg.unregister('a1', ws2)).toBe(true);
    expect(reg.get('a1')).toBeUndefined();
    expect(onUnregister).toHaveBeenCalledTimes(1);
  });

  it('不传 ws 保持旧行为：直接删除（兼容既有调用点）', () => {
    const reg = new AgentRegistry();
    reg.register('a1', META, stubWs());
    expect(reg.unregister('a1')).toBe(true);
    expect(reg.get('a1')).toBeUndefined();
  });

  it('unregister 不存在的 agent → false 且不发事件', () => {
    const reg = new AgentRegistry();
    const onUnregister = vi.fn();
    reg.on('unregister', onUnregister);
    expect(reg.unregister('ghost')).toBe(false);
    expect(onUnregister).not.toHaveBeenCalled();
  });
});
