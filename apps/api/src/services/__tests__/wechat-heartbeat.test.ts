/**
 * TDD — 微信监听心跳记录 + 断线告警服务（进程守护 sub-item 1+5）。
 *
 * listen_chat.py 每分钟上报心跳；中台记录最后心跳时间，断 3 分钟无心跳 → 飞书告警。
 *
 * RED：wechat-heartbeat 模块不存在 → import 失败。
 * GREEN：实现 recordHeartbeat / getHeartbeat / findStaleListeners / checkStaleListenersAndAlert。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordHeartbeat,
  getHeartbeat,
  findStaleListeners,
  checkStaleListenersAndAlert,
  listHeartbeats,
  STALE_THRESHOLD_MS,
  REMOVE_THRESHOLD_MS,
  _resetHeartbeats,
} from '../wechat-heartbeat';

describe('wechat-heartbeat 服务 [BEHAVIOR]', () => {
  beforeEach(() => _resetHeartbeats());

  it('recordHeartbeat 后 getHeartbeat 能查到记录（最后心跳时间）', () => {
    const now = 1_000_000;
    recordHeartbeat({ agent_id: 'a1', wechat_id: 'wx1' }, now);
    const rec = getHeartbeat({ agent_id: 'a1', wechat_id: 'wx1' });
    expect(rec).toBeDefined();
    expect(rec?.ts).toBe(now);
    expect(rec?.agent_id).toBe('a1');
    expect(rec?.wechat_id).toBe('wx1');
  });

  it('同一监听重复上报 → 刷新最后心跳时间', () => {
    recordHeartbeat({ agent_id: 'a1', wechat_id: 'wx1' }, 1000);
    recordHeartbeat({ agent_id: 'a1', wechat_id: 'wx1' }, 9999);
    expect(getHeartbeat({ agent_id: 'a1', wechat_id: 'wx1' })?.ts).toBe(9999);
  });

  it('findStaleListeners 找出超阈值（3min）无心跳的监听', () => {
    const t0 = 1_000_000;
    recordHeartbeat({ agent_id: 'fresh', wechat_id: 'wx' }, t0);
    recordHeartbeat({ agent_id: 'stale', wechat_id: 'wx' }, t0 - STALE_THRESHOLD_MS - 1000);
    const stale = findStaleListeners(t0);
    expect(stale.map((s) => s.agent_id)).toContain('stale');
    expect(stale.map((s) => s.agent_id)).not.toContain('fresh');
  });

  it('checkStaleListenersAndAlert：有断线 + 配了 FEISHU_ALERT_WEBHOOK → POST 飞书告警', async () => {
    const t0 = 5_000_000;
    recordHeartbeat({ agent_id: 'dead', wechat_id: 'wx' }, t0 - STALE_THRESHOLD_MS - 1);
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
    process.env.FEISHU_ALERT_WEBHOOK = 'https://open.feishu.cn/hook/x';
    try {
      const r = await checkStaleListenersAndAlert(t0);
      expect(r.stale.length).toBe(1);
      expect(r.alerted).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.FEISHU_ALERT_WEBHOOK;
      vi.unstubAllGlobals();
    }
  });

  it('checkStaleListenersAndAlert：无断线 → 不发告警', async () => {
    const t0 = 5_000_000;
    recordHeartbeat({ agent_id: 'alive', wechat_id: 'wx' }, t0);
    const r = await checkStaleListenersAndAlert(t0);
    expect(r.stale.length).toBe(0);
    expect(r.alerted).toBe(false);
  });

  it('checkStaleListenersAndAlert：有断线但未配 webhook → 仅 log 不发（alerted=false）', async () => {
    const t0 = 5_000_000;
    recordHeartbeat({ agent_id: 'dead', wechat_id: 'wx' }, t0 - STALE_THRESHOLD_MS - 1);
    delete process.env.FEISHU_ALERT_WEBHOOK;
    const r = await checkStaleListenersAndAlert(t0);
    expect(r.stale.length).toBe(1);
    expect(r.alerted).toBe(false);
  });

  it('checkStaleListenersAndAlert：超过 REMOVE_THRESHOLD_MS 的条目被自动清除（防永久告警循环）', async () => {
    // 模拟 unknown:unknown 场景：有条目超过 30 分钟没有心跳
    const t0 = 10_000_000;
    recordHeartbeat({ agent_id: undefined, wechat_id: undefined }, t0 - REMOVE_THRESHOLD_MS - 1);
    recordHeartbeat({ agent_id: 'alive', wechat_id: 'wx' }, t0);

    delete process.env.FEISHU_ALERT_WEBHOOK;
    await checkStaleListenersAndAlert(t0);

    // 超过 30 分钟的 unknown:unknown 条目应被移除
    expect(getHeartbeat({ agent_id: undefined, wechat_id: undefined })).toBeUndefined();
    // 正常条目不受影响
    expect(getHeartbeat({ agent_id: 'alive', wechat_id: 'wx' })).toBeDefined();
  });

  it('recordHeartbeat 带 diag → getHeartbeat / listHeartbeats 取回扫描诊断（中台看板数据源）', () => {
    recordHeartbeat(
      {
        agent_id: 'a1',
        wechat_id: 'wx',
        diag: {
          main_window_found: false,
          login_present: true,
          sessions_seen: 0,
          unread_count: 2,
          unread_senders: ['张三', '李四'],
          replied_count: 1,
          last_error: 'boom',
        },
      },
      1000,
    );
    const rec = getHeartbeat({ agent_id: 'a1', wechat_id: 'wx' });
    expect(rec?.diag?.login_present).toBe(true);
    expect(rec?.diag?.unread_senders).toEqual(['张三', '李四']);
    expect(rec?.diag?.replied_count).toBe(1);
    expect(listHeartbeats().some((x) => x.diag?.last_error === 'boom')).toBe(true);
  });
});
