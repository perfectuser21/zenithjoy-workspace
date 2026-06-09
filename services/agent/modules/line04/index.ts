// modules/line04/index.ts
//
// line04 微信AI客服模块 — 被 core 通过 child_process.fork() 拉起的入口。
// 与 core 通过 process.send/process.on('message') 做 IPC：
//   core → 本模块：{ type:'config', agentId, apiBase } / { type:'incoming_message', data }
//   本模块 → core：{ type:'ready' } / { type:'status', ok, reason } / { type:'draft_reply', messageId, draft }

import { startWechatListener } from './handlers/wechat-rpa';

export interface ModuleConfig {
  agentId: string;
  apiBase: string;
}

export interface IncomingMessage {
  messageId?: string;
  [k: string]: unknown;
}

type Send = (msg: unknown) => void;

// 模块运行时状态（由 config 消息初始化）。
const state: { agentId?: string; apiBase?: string; ready: boolean } = { ready: false };

// 收到 config：初始化身份 + 启动微信监听（Windows），回 ready。
export function handleConfig(cfg: ModuleConfig, send: Send): void {
  state.agentId = cfg.agentId;
  state.apiBase = cfg.apiBase;
  state.ready = true;
  // Windows 上拉起 listen_chat.py 常驻监听；非 Windows 内部自动跳过。
  if (cfg.apiBase) {
    startWechatListener(cfg.apiBase, cfg.agentId || undefined);
  }
  send({ type: 'ready' });
}

// 收到 incoming_message：thin 阶段先回执已接收（draft 生成由后续加厚接入 LLM）。
export function handleMessage(data: IncomingMessage, send: Send): void {
  if (!state.ready) {
    send({ type: 'status', ok: false, reason: '模块尚未初始化（未收到 config）' });
    return;
  }
  send({ type: 'status', ok: true, reason: `已接收消息 ${data?.messageId ?? '(no id)'}` });
}

// 注册 IPC 监听。core fork 后即生效。
export function registerIpc(send: Send = (m) => process.send?.(m)): void {
  process.on('message', (msg: { type?: string; data?: IncomingMessage } & Partial<ModuleConfig>) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'config') {
      handleConfig({ agentId: msg.agentId ?? '', apiBase: msg.apiBase ?? '' }, send);
    } else if (msg.type === 'incoming_message') {
      handleMessage(msg.data ?? {}, send);
    }
  });
}

export function start(): void {
  registerIpc();
  console.log('[line04] 模块已启动，等待 core config…');
}

// 仅在被 core fork（作为入口运行）时注册 IPC；被 import（如测试）时不副作用。
if (require.main === module) {
  start();
}
