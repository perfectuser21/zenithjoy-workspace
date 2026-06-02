import { describe, it, expect } from 'vitest';

/**
 * Path 4 Step 1 — ilink-poller 端到端 TDD Red
 *
 * 验证 poller 拉到一条 mock 私聊后跑完 B→C→D→E 链路，并在收到 -14 后切 needs_rebind。
 * Generator 实现前必须 FAIL（模块/函数不存在）。
 */

describe('ilink-poller 闭环 [BEHAVIOR]', () => {
  it('一条 mock 私聊跑完 B→C→D→E：sendmessage + llm_audit + lead-writer 各被调用一次', async () => {
    const mod = await import('../../../apps/api/src/services/ilink-poller');
    expect(typeof (mod as any).runPollerOnce).toBe('function');

    // runPollerOnce 接收注入的 deps（便于 unit 测试不依赖 HTTP）
    const calls: any = { sendmessage: 0, openrouter: 0, writeLead: 0 };
    const result = await (mod as any).runPollerOnce({
      session: { id: 'sess-1', token: 'tok', uin: 'uin-1', wxid: 'wxid-1' },
      ilink: {
        getupdates: async () => ({
          updates: [{
            type: 'text', scene: 'single',
            from_user_id: 'wxA', to_user_id: 'wxid-1',
            text: '你好', context_token: 'ctx-1',
            received_at: '2026-06-02T08:30:00Z',
          }],
          get_updates_buf: 'c2',
        }),
        sendmessage: async () => { calls.sendmessage++; return { message_id: 'm1' }; },
      },
      openrouter: async (args: any) => {
        calls.openrouter++;
        expect(args.purpose).toBe('wechat_ilink_chat_reply');
        return { content: 'AI 回复一句' };
      },
      writeLead: async (rec: any) => {
        calls.writeLead++;
        expect(rec.from_user_id).toBe('wxA');
        expect(rec.context_token).toBe('ctx-1');
      },
    });

    expect(calls.sendmessage).toBe(1);
    expect(calls.openrouter).toBe(1);
    expect(calls.writeLead).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.nextCursor).toBe('c2');
  });

  it('errcode=-14 触发 markSessionNeedsRebind + 停止循环', async () => {
    const mod = await import('../../../apps/api/src/services/ilink-poller');
    let marked = false;
    const result = await (mod as any).runPollerOnce({
      session: { id: 'sess-1', token: 'tok', uin: 'uin-1', wxid: 'wxid-1' },
      ilink: {
        getupdates: async () => ({ errcode: -14, errmsg: 'session timeout' }),
        sendmessage: async () => { throw new Error('不应被调用'); },
      },
      openrouter: async () => { throw new Error('不应被调用'); },
      writeLead: async () => { throw new Error('不应被调用'); },
      markSessionNeedsRebind: async (sid: string) => {
        expect(sid).toBe('sess-1');
        marked = true;
      },
    });
    expect(marked).toBe(true);
    expect(result.stopped).toBe(true);
    expect(result.reason).toBe('session_timeout');
  });

  it('DeepSeek 调用失败不阻塞下一轮（catch + log + skip）', async () => {
    const mod = await import('../../../apps/api/src/services/ilink-poller');
    const calls: any = { sendmessage: 0 };
    const result = await (mod as any).runPollerOnce({
      session: { id: 'sess-1', token: 'tok', uin: 'uin-1', wxid: 'wxid-1' },
      ilink: {
        getupdates: async () => ({
          updates: [{
            type: 'text', scene: 'single',
            from_user_id: 'wxA', to_user_id: 'wxid-1',
            text: 'hi', context_token: 'ctx-x',
            received_at: '2026-06-02T08:30:00Z',
          }],
          get_updates_buf: 'cN',
        }),
        sendmessage: async () => { calls.sendmessage++; return {}; },
      },
      openrouter: async () => { throw new Error('openrouter 5xx'); },
      writeLead: async () => { throw new Error('不应被调用'); },
    });
    expect(calls.sendmessage).toBe(0);
    expect(result.stopped).toBe(false);
    expect(result.skipped).toBe(1);
  });
});
