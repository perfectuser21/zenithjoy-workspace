/**
 * Sprint 07282119-agent-panel-knife2-android — 合同测试（TDD Red 阶段）
 *
 * 覆盖 Golden Path Step 6：services/agent 新增 line02 桥接模块——真实调用
 * PanelEventBus.ingest()（真 bus，不 mock），只 mock 桥接模块对外发起的 fetch()
 * 这一层"更外层的无关依赖"（跨主机网络调用中台 API 是合法外部边界）。
 *
 * 此刻 `services/agent/src/shared/panel-line02-bridge.ts` 尚不存在，import 应报错——
 * 这就是 TDD Red 证据。
 */
import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { PanelEventBus } from '../../../services/agent/src/shared/panel-event-bus';
// eslint-disable-next-line import/no-unresolved -- 合同阶段该文件尚不存在，Generator 阶段创建
import { PanelLine02Bridge } from '../../../services/agent/src/shared/panel-line02-bridge';

describe('PanelLine02Bridge — 真实 ingest 进 PanelEventBus [BEHAVIOR]', () => {
  let bus: PanelEventBus;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    bus = new PanelEventBus();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    bus.destroy();
    vi.unstubAllGlobals();
  });

  it('拉取到 activeTasks 后真实调用 bus.ingest()，getActiveTasks("line02") 返回一致数据', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        line: 'line02',
        activeTasks: [{
          task_id: 't-bridge-1', device: 'RMX3478-b6ee', title: '📱 RMX3478-b6ee 第1/3步', progress: [1, 3], state: 'work',
        }],
        recentCompleted: [],
      }),
    });

    const bridge = new PanelLine02Bridge({
      bus, apiBase: 'http://fake-brain-api.local', tenantId: 'tenant-x', agentId: 'agent-x',
    });
    await bridge.pollOnce();

    const active = bus.getActiveTasks('line02');
    expect(active).toHaveLength(1);
    expect(active[0].task_id).toBe('t-bridge-1');
    expect(active[0].device).toBe('RMX3478-b6ee');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/agent/burner/panel-active-tasks?line=line02'),
      expect.anything(),
    );
  });

  it('fetch 失败时不崩溃，不清空 bus 已有状态（静默降级，不得让故障传播到 line04）', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        line: 'line02',
        activeTasks: [{
          task_id: 't-bridge-2', device: 'RMX3478-b6ee', title: 'x', progress: [1, 1], state: 'work',
        }],
        recentCompleted: [],
      }),
    });
    const bridge = new PanelLine02Bridge({
      bus, apiBase: 'http://fake-brain-api.local', tenantId: 'tenant-x', agentId: 'agent-x',
    });
    await bridge.pollOnce();
    expect(bus.getActiveTasks('line02')).toHaveLength(1);

    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(bridge.pollOnce()).resolves.not.toThrow();
    // 上一次已知状态保留，不因单次轮询失败清空
    expect(bus.getActiveTasks('line02')).toHaveLength(1);
  });

  it('done 状态的任务不进 activeTasks（映射进 bus 的 complete 语义）', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        line: 'line02',
        activeTasks: [],
        recentCompleted: [{
          task_id: 't-bridge-3', device: 'RMX3478-b6ee', title: 'x', state: 'done',
        }],
      }),
    });
    const bridge = new PanelLine02Bridge({
      bus, apiBase: 'http://fake-brain-api.local', tenantId: 'tenant-x', agentId: 'agent-x',
    });
    await bridge.pollOnce();
    expect(bus.getActiveTasks('line02')).toHaveLength(0);
    expect(bus.getRecentCompleted('line02').some((t) => t.task_id === 't-bridge-3')).toBe(true);
  });
});
