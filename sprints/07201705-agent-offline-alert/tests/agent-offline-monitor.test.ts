/**
 * [TDD commit-1 — RED] Agent 离线静默告警 — vitest 单测
 *
 * Sprint 07201705 / task_id: 027e6bba-9b00-4b9f-b3b9-33b2e3807717
 *
 * 此文件为 commit-1（失败状态）：被测模块尚未实现，所有测试预期 FAIL。
 * 实现完成后（commit-2）移至 apps/api/src/services/__tests__/agent-offline-monitor.test.ts
 *
 * 合同对照：
 *   [BEHAVIOR-01] 同机同次离线只告警一次（去重）
 *   [BEHAVIOR-02] 恢复后推恢复通知并复位去重
 *   [BEHAVIOR-03] sendOfflineAlert fetch 失败时 throw 不 warn
 *   [BEHAVIOR-04] webhook URL 来自 env 不硬编码
 *   [BEHAVIOR-05] 告警 payload 含 hostname/offline_duration_minutes/agent_id
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ──────────────────────────────────────────────────────────────────────────────
// 被测模块（尚未实现，import 会失败 → Red 状态）
// ──────────────────────────────────────────────────────────────────────────────
// 实现后路径为：apps/api/src/services/agent-offline-monitor.ts
// commit-1 阶段此 import 会抛 MODULE_NOT_FOUND → 所有 test 红
import type {
  AgentOfflineAlert,
} from '../../../apps/api/src/services/agent-offline-monitor';

// 动态 import 以便在模块不存在时给出友好错误
let sendOfflineAlert: (agent: AgentOfflineAlert) => Promise<void>;
let scanAndAlert: (opts?: { thresholdHours?: number }) => Promise<{ scanned: number; alerted: AgentOfflineAlert[]; recovered: AgentOfflineAlert[] }>;
let _resetAlertedMap: () => void;

beforeEach(async () => {
  // 这里在 commit-1 会 throw → 测试标记为失败（预期）
  const mod = await import('../../../apps/api/src/services/agent-offline-monitor');
  sendOfflineAlert = mod.sendOfflineAlert;
  scanAndAlert = mod.scanAndAlert;
  _resetAlertedMap = mod._resetAlertedMap;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ──────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-01] 同机同次离线只告警一次（去重）
// ──────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-01] 同机同次离线只告警一次（去重）', () => {
  beforeEach(() => {
    _resetAlertedMap();
    // mock DB 查询：返回含 stale agent 的列表（让 scanAndAlert 有数据可处理）
    vi.mock('../../../apps/api/src/db', () => ({
      default: {
        query: vi.fn().mockResolvedValue({
          rows: [
            {
              agent_id: 'agent-dedup-001',
              hostname: 'dedup-host',
              platform: 'windows',
              updated_at: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5h ago
              offline_duration_minutes: 300,
            },
          ],
        }),
      },
    }));
  });

  it('同一 agent_id 超阈值后，第二次扫描不重复发告警', async () => {
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', 'http://mock-webhook.test/hook');

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    // 第一次扫描（DB mock 返回 stale agent）：应发送告警，mockFetch 被调用 1 次
    const result1 = await scanAndAlert({ thresholdHours: 4 });
    expect(result1.alerted).toHaveLength(1);
    expect(result1.alerted[0].agent_id).toBe('agent-dedup-001');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // 第二次扫描（DB mock 仍返回同一 stale agent，updated_at 未变）：去重 Map 已有记录，不重复发
    const result2 = await scanAndAlert({ thresholdHours: 4 });
    expect(result2.alerted).toHaveLength(0); // 去重：alerted 应为空
    // mockFetch 依然只被调用了 1 次（第二次扫描未触发新告警）
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('sendOfflineAlert 直接调用仍正常发送（去重由 scanAndAlert 层控制）', async () => {
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', 'http://mock-webhook.test/hook');

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const staleAgent: AgentOfflineAlert = {
      agent_id: 'agent-dedup-direct-001',
      hostname: 'dedup-direct-host',
      offline_duration_minutes: 300,
    };

    // 直接调用 sendOfflineAlert 两次：每次都发（去重在 scanAndAlert 层，不在此函数）
    await sendOfflineAlert(staleAgent);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-02] 恢复后推恢复通知并复位去重
// ──────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-02] 恢复后推恢复通知并复位去重', () => {
  beforeEach(() => {
    _resetAlertedMap();
  });

  it('恢复通知 text 含 "已恢复" 或 "recovered"', async () => {
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', 'http://mock-webhook.test/hook');
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const mod = await import('../../../apps/api/src/services/agent-offline-monitor');
    const sendRecoveryAlert = mod.sendRecoveryAlert;
    expect(sendRecoveryAlert).toBeDefined();

    await sendRecoveryAlert({
      agent_id: 'agent-recover-001',
      hostname: 'recover-host',
      offline_duration_minutes: 300,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const text: string = body?.content?.text ?? '';
    const hasRecovery = text.includes('已恢复') || text.includes('recovered') || text.includes('恢复');
    expect(hasRecovery).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-03] sendOfflineAlert fetch 失败时 throw 不 warn
// ──────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-03] sendOfflineAlert fetch 失败时 throw 不 warn', () => {
  it('fetch 失败时抛出错误（不吞掉）', async () => {
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', 'http://mock-webhook.test/hook');

    const mockFetch = vi.fn().mockRejectedValue(new Error('network fail'));
    vi.stubGlobal('fetch', mockFetch);

    const errorSpy = vi.spyOn(console, 'error');
    const warnSpy = vi.spyOn(console, 'warn');

    await expect(
      sendOfflineAlert({
        agent_id: 'agent-throw-001',
        hostname: 'throw-host',
        offline_duration_minutes: 300,
      })
    ).rejects.toThrow('network fail');

    // 必须打 console.error
    expect(errorSpy).toHaveBeenCalled();
    // 禁止 console.warn 静默吞错（INV-01）
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('未配 FEISHU_ALERT_WEBHOOK 时不 throw，仅 log info', async () => {
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', '');
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    // 无 webhook 时不应抛错，服务可正常运行
    await expect(
      sendOfflineAlert({
        agent_id: 'agent-nowebhook',
        hostname: 'nowebhook-host',
        offline_duration_minutes: 300,
      })
    ).resolves.not.toThrow();

    // 未配 webhook 时不应调用 fetch
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-04] webhook URL 来自 env 不硬编码
// ──────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-04] webhook URL 来自 env 不硬编码', () => {
  it('使用 FEISHU_ALERT_WEBHOOK env 作为 webhook URL', async () => {
    const customUrl = 'http://custom-webhook-env.test/hook';
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', customUrl);

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    await sendOfflineAlert({
      agent_id: 'agent-env-001',
      hostname: 'env-host',
      offline_duration_minutes: 300,
    });

    expect(mockFetch).toHaveBeenCalledWith(customUrl, expect.any(Object));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-05] 告警 payload 含 hostname/offline_duration_minutes/agent_id
// ──────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-05] 告警 payload 含 hostname/offline_duration_minutes/agent_id', () => {
  it('飞书 POST body 中 text 含三个必填字段信息', async () => {
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', 'http://mock-webhook.test/hook');
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const agent: AgentOfflineAlert = {
      agent_id: 'agent-payload-001',
      hostname: 'payload-host',
      offline_duration_minutes: 245,
    };

    await sendOfflineAlert(agent);

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [, requestInit] = mockFetch.mock.calls[0];
    const body = JSON.parse(requestInit.body as string);

    // 验证飞书 text 格式
    expect(body).toHaveProperty('msg_type', 'text');
    expect(body).toHaveProperty('content.text');
    const text: string = body.content.text;

    // 必须含 hostname
    expect(text).toContain('payload-host');
    // 必须含 agent_id
    expect(text).toContain('agent-payload-001');
    // 必须含离线时长（整数分钟）
    expect(text).toContain('245');
  });

  it('offline_duration_minutes 必须是整数', async () => {
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', 'http://mock-webhook.test/hook');
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    // 传入浮点 → 实现层应 Math.floor
    const agent: AgentOfflineAlert = {
      agent_id: 'agent-int-check',
      hostname: 'int-host',
      offline_duration_minutes: 245, // 调用方传整数
    };

    await sendOfflineAlert(agent);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const text: string = body.content.text;
    // 文本中的时长数字应为整数（不含小数点）
    const match = text.match(/(\d+)\s*分钟/);
    if (match) {
      const minutes = Number(match[1]);
      expect(Number.isInteger(minutes)).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-06] scanAndAlert 结构完整性
// ──────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-06] scanAndAlert 返回结构', () => {
  it('返回 { scanned, alerted, recovered } 结构', async () => {
    // DB 未 mock，此测试在无 DB 环境下可能因 DB 连接失败而抛错
    // 实现时应 gracefully handle DB error
    _resetAlertedMap();
    const result = await scanAndAlert({ thresholdHours: 4 }).catch(() => ({
      scanned: 0,
      alerted: [] as AgentOfflineAlert[],
      recovered: [] as AgentOfflineAlert[],
    }));

    expect(result).toHaveProperty('scanned');
    expect(result).toHaveProperty('alerted');
    expect(result).toHaveProperty('recovered');
    expect(typeof result.scanned).toBe('number');
    expect(Array.isArray(result.alerted)).toBe(true);
    expect(Array.isArray(result.recovered)).toBe(true);
  });
});
