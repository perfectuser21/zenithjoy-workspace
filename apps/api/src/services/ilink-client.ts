/**
 * iLink HTTP JSON 协议客户端 — Path 4 Step 1
 * 对齐腾讯官方 openclaw-weixin 真实协议（github.com/Tencent/openclaw-weixin
 * src/api/api.ts · types.ts · auth/login-qr.ts）。
 *
 * 个人微信号通过腾讯官方 iLink（智联）协议收发，合规、不挂 Windows、不 hook。
 * 域名 ilinkai.weixin.qq.com，所有端点前缀 `ilink/bot/`。
 * 鉴权头：Content-Type / AuthorizationType: ilink_bot_token /
 *         X-WECHAT-UIN: base64(random uint32) / Authorization: Bearer <bot_token>（有 token 时）。
 */

import crypto from 'node:crypto';

const ILINK_BASE_URL = process.env.ILINK_BASE_URL || 'https://ilinkai.weixin.qq.com';

/** 官方 channel build 固定 bot_type。 */
export const DEFAULT_ILINK_BOT_TYPE = '3';

/** 消息类型：1=用户发来，2=机器人自己发出。 */
export const MessageType = { NONE: 0, USER: 1, BOT: 2 } as const;
/** item 类型：1=文字，2=图片，3=语音，4=文件，5=视频。 */
export const MessageItemType = { NONE: 0, TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 } as const;

/** 登录后保存在服务端的会话凭据。 */
export interface ILinkSession {
  id: string;
  token: string;
  uin: string;
  wxid: string;
}

export interface TextItem {
  text?: string;
}
export interface MessageItem {
  type?: number;
  text_item?: TextItem;
}
/** 统一消息（proto: WeixinMessage）。 */
export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  create_time_ms?: number;
  message_type?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
}

/** 解析后的私聊文字消息。 */
export interface ParsedMessage {
  from_user_id: string;
  to_user_id?: string;
  text: string;
  context_token: string;
  received_at?: string;
}

/**
 * 从 getupdates 响应的 msgs 里只挑出「用户发来的文字私聊」。
 * 过滤 BOT 自己的消息（message_type=2）、非文字 item（图片/语音/视频/文件）。
 * iLink 不支持群聊，故无需 scene 过滤。
 */
export function parseUpdates(resp: GetUpdatesResp): ParsedMessage[] {
  const msgs = resp?.msgs ?? [];
  const out: ParsedMessage[] = [];
  for (const m of msgs) {
    if (m.message_type !== MessageType.USER) continue;
    const textItem = (m.item_list ?? []).find(
      (it) => it.type === MessageItemType.TEXT && typeof it.text_item?.text === 'string',
    );
    if (!textItem) continue;
    out.push({
      from_user_id: String(m.from_user_id),
      to_user_id: m.to_user_id,
      text: String(textItem.text_item?.text),
      context_token: String(m.context_token),
      received_at: m.create_time_ms ? new Date(m.create_time_ms).toISOString() : undefined,
    });
  }
  return out;
}

export interface SendMessageInput {
  to_user_id: string;
  context_token: string;
  text: string;
}

/** 构造一条 WeixinMessage（单条 text item）；sendmessage 会包成 { msg }。 */
export function buildSendMessageBody(input: SendMessageInput): WeixinMessage {
  return {
    to_user_id: input.to_user_id,
    context_token: input.context_token,
    item_list: [{ type: MessageItemType.TEXT, text_item: { text: input.text } }],
  };
}

/** errcode=-14 表示 iLink 会话超时（token 失效），需要重新扫码绑定。 */
export function isSessionTimeoutError(resp: { errcode?: number } | null | undefined): boolean {
  return !!resp && resp.errcode === -14;
}

// ─── HTTP 封装（对齐官方 buildHeaders / apiPostFetch / apiGetFetch）──────────────

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
  };
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  return headers;
}

function endpointUrl(endpoint: string): string {
  const base = ILINK_BASE_URL.endsWith('/') ? ILINK_BASE_URL : `${ILINK_BASE_URL}/`;
  return new URL(endpoint, base).toString();
}

async function ilinkPost(endpoint: string, token: string | undefined, body: unknown): Promise<unknown> {
  const res = await fetch(endpointUrl(endpoint), {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  });
  return res.json();
}

async function ilinkGet(endpoint: string, token?: string): Promise<unknown> {
  const res = await fetch(endpointUrl(endpoint), { method: 'GET', headers: buildHeaders(token) });
  return res.json();
}

// ─── 收发 ────────────────────────────────────────────────────────────────────

/** 长轮询拉新消息；cursor 为上一轮返回的 get_updates_buf，首次传空串。 */
export async function getupdates(session: ILinkSession, cursor = ''): Promise<GetUpdatesResp> {
  return (await ilinkPost('ilink/bot/getupdates', session.token, {
    get_updates_buf: cursor,
  })) as GetUpdatesResp;
}

/** 发送一条文字消息。 */
export async function sendmessage(session: ILinkSession, input: SendMessageInput): Promise<unknown> {
  return ilinkPost('ilink/bot/sendmessage', session.token, { msg: buildSendMessageBody(input) });
}

// ─── 扫码登录 ──────────────────────────────────────────────────────────────────

export interface QrCodeResponse {
  qrcode?: string;
  qrcode_img_content?: string;
}
export interface QrStatusResponse {
  status?: 'wait' | 'scaned' | 'confirmed' | 'expired' | string;
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  nickname?: string;
}

/** 拉二维码（无 token）；返回 qrcode（轮询句柄）+ qrcode_img_content（展示用）。 */
export async function getBotQrcode(botType: string = DEFAULT_ILINK_BOT_TYPE): Promise<QrCodeResponse> {
  return (await ilinkPost(
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    undefined,
    { local_token_list: [] },
  )) as QrCodeResponse;
}

/** 长轮询扫码状态；status='confirmed' 时返回 bot_token。 */
export async function pollQrStatus(qrcode: string): Promise<QrStatusResponse> {
  return (await ilinkGet(
    `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
  )) as QrStatusResponse;
}
