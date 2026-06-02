import { describe, it, expect } from 'vitest';

/**
 * Path 4 Step 1 — ilink-poller 边界路径 TDD Red
 *
 * 补充两个 PRD 边界分支：
 *   1. sendmessage 非-14 失败 → skip writeLead（数据完整性：飞书不写虚假"AI已回"记录）
 *   2. getupdates 5xx 网络错误 → session NOT 标 needs_rebind（退避重试，区别于 -14 session timeout）
 * Generator 实现前必须 FAIL（函数不存在或分支逻辑未实现）。
 */

describe('ilink-poller 边界路径 [BEHAVIOR]', () => {
  it('sendmessage 非-14 失败（风控/违规/参数错）→ writeLead 不调用，poller 继续（skipped+1）', async () => {
    const mod = await import('../ilink-poller');
    expect(typeof (mod as any).runPollerOnce).toBe('function');

    const calls: any = { writeLead: 0 };
    const result = await (mod as any).runPollerOnce({
      session: { id: 'sess-edge-1', token: 'tok', uin: 'uin-1', wxid: 'wxid-1' },
      ilink: {
        getupdates: async () => ({
          updates: [{
            type: 'text', scene: 'single',
            from_user_id: 'wxA', to_user_id: 'wxid-1',
            text: '报价', context_token: 'ctx-edge-1',
            received_at: '2026-06-02T09:00:00Z',
          }],
          get_updates_buf: 'cEdge',
        }),
        sendmessage: async () => {
          const err: any = new Error('content blocked');
          err.errcode = 300001;
          throw err;
        },
      },
      openrouter: async () => ({ content: 'AI 回复' }),
      writeLead: async () => { calls.writeLead++; },
    });

    // writeLead 不应被调用：消息实际未发出，飞书不能出现虚假记录
    expect(calls.writeLead).toBe(0);
    // poller 不停（非 session timeout，继续轮询）
    expect(result.stopped).toBe(false);
    // 本条计入 skipped
    expect(result.skipped).toBe(1);
  });

  it('getupdates 5xx 网络错误 → session NOT 标 needs_rebind（退避重试语义）', async () => {
    const mod = await import('../ilink-poller');

    let markedNeedsRebind = false;
    const result = await (mod as any).runPollerOnce({
      session: { id: 'sess-edge-2', token: 'tok', uin: 'uin-1', wxid: 'wxid-1' },
      ilink: {
        getupdates: async () => { throw new Error('503 Service Unavailable'); },
        sendmessage: async () => { throw new Error('不应调用'); },
      },
      openrouter: async () => { throw new Error('不应调用'); },
      writeLead: async () => { throw new Error('不应调用'); },
      markSessionNeedsRebind: async (_sid: string) => { markedNeedsRebind = true; },
    });

    // 5xx ≠ session timeout，不改 session 状态
    expect(markedNeedsRebind).toBe(false);
    // poller 不彻底停止（错误由上层退避重试逻辑处理）
    expect(result.stopped).toBe(false);
    // 应携带可重试标记（便于上层退避）
    expect(result.networkError).toBe(true);
  });
});
