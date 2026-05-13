export interface WechatRpaTask {
  type: 'wechat_qr_bind' | 'wechat_moments_send' | 'wechat_private_chat_send';
  payload: Record<string, unknown>;
  pythonStub?: string;
}

export interface WechatRpaResult {
  ok: boolean;
  receipt?: Record<string, unknown>;
  error?: string;
}

export async function handleWechatRpa(_task: WechatRpaTask): Promise<WechatRpaResult> {
  throw new Error('handleWechatRpa not implemented (skeleton)');
}
