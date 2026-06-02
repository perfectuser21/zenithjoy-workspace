/**
 * iLink HTTP JSON 协议客户端 — Path 4 Step 1（移植自腾讯官方 openclaw-weixin）
 *
 * 个人微信号通过腾讯官方 iLink（智联）协议收发消息，合规、不挂 Windows、不 hook。
 * 域名 ilinkai.weixin.qq.com，固定请求头：
 *   - AuthorizationType: ilink_bot_token
 *   - Authorization: Bearer <token>（扫码登录后获得）
 *   - X-WECHAT-UIN: base64(uint32)
 *
 * 协议参考：github.com/Tencent/openclaw-weixin（src/api/api.ts / types.ts）。
 * 本 client 只实现第一刀所需：getupdates(长轮询收) / sendmessage(发) +
 * 纯函数 parseUpdates / buildSendMessageBody / isSessionTimeoutError（便于单测注入）。
 */

const ILINK_BASE_URL = process.env.ILINK_BASE_URL || 'https://ilinkai.weixin.qq.com';

/** 登录后保存在服务端的会话凭据（token 等）。 */
export interface ILinkSession {
  id: string;
  token: string;
  uin: string;
  wxid: string;
}

/** 解析后的私聊文字消息（只保留单聊 text）。 */
export interface ParsedMessage {
  from_user_id: string;
  to_user_id?: string;
  text: string;
  context_token: string;
  received_at?: string;
}

/** getupdates 返回结构。 */
export interface GetUpdatesResponse {
  updates?: any[];
  get_updates_buf?: string;
  errcode?: number;
  errmsg?: string;
}

/**
 * 从 getupdates 响应里只挑出「单聊 + 文字」的私聊消息。
 * 群聊（scene !== 'single'）、媒体（type !== 'text'）、系统通知（type='sys'）全部过滤掉
 * —— 第一刀只处理 1 对 1 私聊文字（iLink 也不支持群聊）。
 */
export function parseUpdates(resp: GetUpdatesResponse): ParsedMessage[] {
  const updates = (resp && resp.updates) || [];
  return updates
    .filter((u: any) => u && u.type === 'text' && u.scene === 'single')
    .map((u: any) => ({
      from_user_id: u.from_user_id,
      to_user_id: u.to_user_id,
      text: u.text,
      context_token: u.context_token,
      received_at: u.received_at,
    }));
}

export interface SendMessageInput {
  to_user_id: string;
  context_token: string;
  text: string;
}

/** 构造 sendmessage 请求体：单条 text item，必须带回 context_token 维持会话关联。 */
export function buildSendMessageBody(input: SendMessageInput) {
  return {
    to_user_id: input.to_user_id,
    context_token: input.context_token,
    item_list: [{ type: 'text', text: input.text }],
  };
}

/** errcode=-14 表示 iLink 会话超时（token 失效），需要重新扫码绑定。 */
export function isSessionTimeoutError(resp: { errcode?: number } | null | undefined): boolean {
  return !!resp && resp.errcode === -14;
}

function ilinkHeaders(session: ILinkSession): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    Authorization: `Bearer ${session.token}`,
    'X-WECHAT-UIN': Buffer.from(String(session.uin)).toString('base64'),
  };
}

async function ilinkPost(path: string, session: ILinkSession, body: unknown): Promise<any> {
  const res = await fetch(`${ILINK_BASE_URL}/${path}`, {
    method: 'POST',
    headers: ilinkHeaders(session),
    body: JSON.stringify(body),
  });
  return res.json();
}

/** 长轮询拉新消息；cursor 为上一轮返回的 get_updates_buf，首次传空串。 */
export async function getupdates(session: ILinkSession, cursor = ''): Promise<GetUpdatesResponse> {
  return ilinkPost('getupdates', session, { get_updates_buf: cursor });
}

/** 发送一条文字消息。 */
export async function sendmessage(session: ILinkSession, input: SendMessageInput): Promise<any> {
  return ilinkPost('sendmessage', session, { msg: buildSendMessageBody(input) });
}
