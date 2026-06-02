/**
 * iLink 长轮询闭环 — Path 4 Step 1
 *
 * runPollerOnce 跑一轮 B→C→D→E：
 *   B 拉一批私聊（注入的 ilink.getupdates）
 *   C 每条丢给 DeepSeek 生成回复（注入的 openrouter，purpose=wechat_ilink_chat_reply）
 *   D 回复经 ilink.sendmessage 自动发回（带 context_token）
 *   E 交互写飞书 Lead（注入的 writeLead）
 *
 * 纪律：
 *   - getupdates 返回 errcode=-14（会话超时）→ markSessionNeedsRebind + 停止本轮（stopped）
 *   - DeepSeek 调用失败 → catch + log + skip 该条，不发消息不写 lead，但不阻塞其余消息
 *
 * 所有外部依赖通过 deps 注入，单测无需真实 HTTP / DB。
 */

import {
  parseUpdates,
  isSessionTimeoutError,
  type GetUpdatesResponse,
  type SendMessageInput,
} from './ilink-client';

export interface RunPollerOnceDeps {
  session: { id: string; token: string; uin: string; wxid: string };
  ilink: {
    getupdates: (cursor?: string) => Promise<GetUpdatesResponse>;
    sendmessage: (input: SendMessageInput) => Promise<unknown>;
  };
  openrouter: (args: { purpose: string; prompt: string }) => Promise<{ content: string }>;
  writeLead: (rec: {
    from_user_id: string;
    to_user_id?: string;
    text: string;
    reply: string;
    context_token: string;
    received_at?: string;
  }) => Promise<void>;
  markSessionNeedsRebind?: (sessionId: string) => Promise<void>;
}

export interface RunPollerOnceResult {
  processed: number;
  skipped: number;
  nextCursor?: string;
  stopped: boolean;
  reason?: string;
}

export async function runPollerOnce(deps: RunPollerOnceDeps): Promise<RunPollerOnceResult> {
  const { session, ilink, openrouter, writeLead, markSessionNeedsRebind } = deps;

  const resp = await ilink.getupdates();

  // F: 会话超时 → 标记需重新扫码并停止
  if (isSessionTimeoutError(resp)) {
    if (markSessionNeedsRebind) {
      await markSessionNeedsRebind(session.id);
    }
    return { processed: 0, skipped: 0, stopped: true, reason: 'session_timeout' };
  }

  const messages = parseUpdates(resp);
  let processed = 0;
  let skipped = 0;

  for (const msg of messages) {
    // C: DeepSeek 生成回复 —— 失败不阻塞下一条
    let reply: { content: string };
    try {
      reply = await openrouter({
        purpose: 'wechat_ilink_chat_reply',
        prompt: msg.text,
      });
    } catch (err) {
      console.error(
        `[ilink-poller] openrouter failed for context_token=${msg.context_token}, skip`,
        err,
      );
      skipped++;
      continue;
    }

    // D: 自动回复（client.sendmessage 内部会 buildSendMessageBody）
    await ilink.sendmessage({
      to_user_id: msg.from_user_id,
      context_token: msg.context_token,
      text: reply.content,
    });

    // E: 写飞书 Lead
    await writeLead({
      from_user_id: msg.from_user_id,
      to_user_id: msg.to_user_id,
      text: msg.text,
      reply: reply.content,
      context_token: msg.context_token,
      received_at: msg.received_at,
    });

    processed++;
  }

  return {
    processed,
    skipped,
    nextCursor: resp.get_updates_buf,
    stopped: false,
  };
}
