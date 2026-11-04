/**
 * Agent 离线静默告警服务单测（test-pairing lint 配对）
 *
 * Sprint 07201705 / task_id: 027e6bba-9b00-4b9f-b3b9-33b2e3807717
 *
 * Current unit oracle; real SQL/HTTP dedupe/recovery uses media-extra/runtime.test.ts.
 * Active service behavior assertions complement that real integration contract.
 *
 * 合同对照：
 *   [BEHAVIOR-03] sendOfflineAlert fetch 失败时 throw 不 warn（INV-01）
 *   [BEHAVIOR-04] webhook URL 来自 env 不硬编码
 *   [BEHAVIOR-05] 告警 payload 含 hostname/offline_duration_minutes/agent_id
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../db', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

import {
  sendOfflineAlert,
  scanAndAlert,
  sendRecoveryAlert,
  _resetAlertedMap,
  type AgentOfflineAlert,
} from '../agent-offline-monitor';

beforeEach(() => {
  _resetAlertedMap();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const staleAgent: AgentOfflineAlert = {
  agent_id: 'agent-unit-001',
  hostname: 'unit-test-host',
  offline_duration_minutes: 300,
};

describe('[BEHAVIOR-03] sendOfflineAlert fetch 失败时 throw 不 warn（INV-01）', () => {
  it('fetch 失败时抛出错误', async () => {
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', 'https://open.feishu.cn/open-apis/bot/v2/hook/fixture');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network fail')));
    const warnSpy = vi.spyOn(console, 'warn');

    await expect(sendOfflineAlert(staleAgent)).rejects.toThrow('network fail');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('未配 FEISHU_ALERT_WEBHOOK 时不 throw，fetch 不被调用', async () => {
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', '');
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await expect(sendOfflineAlert(staleAgent)).resolves.not.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('[BEHAVIOR-04] webhook URL 来自 env 不硬编码', () => {
  it('fetch 调用 URL 等于 FEISHU_ALERT_WEBHOOK env', async () => {
    const url = 'https://open.feishu.cn/open-apis/bot/v2/hook/custom-fixture';
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', url);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    await sendOfflineAlert(staleAgent);
    expect(mockFetch.mock.calls[0][0]).toBe(url);
  });
});

describe('[BEHAVIOR-05] 告警 payload 含 hostname/offline_duration_minutes/agent_id', () => {
  it('POST body 包含关键字段', async () => {
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', 'https://open.feishu.cn/open-apis/bot/v2/hook/fixture');
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    await sendOfflineAlert(staleAgent);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const text: string = JSON.stringify(body);
    expect(text).toContain('unit-test-host');
  });
});

describe('[BEHAVIOR-02] 恢复通知 text 含恢复信号', () => {
  it('sendRecoveryAlert payload text 含"已恢复"或"recovered"', async () => {
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', 'https://open.feishu.cn/open-apis/bot/v2/hook/fixture');
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    await sendRecoveryAlert(staleAgent);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const text: string = body?.content?.text ?? JSON.stringify(body);
    const hasRecovery = text.includes('已恢复') || text.includes('recovered') || text.includes('恢复');
    expect(hasRecovery).toBe(true);
  });
});


it('floors fractional duration while retaining the actual host and agent payload', async () => {
  vi.stubEnv('FEISHU_ALERT_WEBHOOK','https://open.feishu.cn/open-apis/bot/v2/hook/fixture');
  const transport = vi.fn().mockResolvedValue({ok:true});vi.stubGlobal('fetch',transport);
  await sendOfflineAlert({...staleAgent,offline_duration_minutes:300.75});
  const text = JSON.parse(transport.mock.calls[0][1].body as string).content.text;
  expect(text).toContain('hostname=unit-test-host agent_id=agent-unit-001');
  expect(text).toMatch(/300\s+\u5206\u949f/);expect(text).not.toContain('300.75');
});

it('propagates scanner database failure instead of fabricating a successful structure', async () => {
  const pool = (await import('../../db')).default;
  vi.mocked(pool.query).mockRejectedValueOnce(new Error('owned scanner DB failure'));
  await expect(scanAndAlert()).rejects.toThrow('owned scanner DB failure');
});
