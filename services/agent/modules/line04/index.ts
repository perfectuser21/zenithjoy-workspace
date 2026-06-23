// modules/line04/index.ts
//
// line04 微信AI客服模块 — 被 core 通过 child_process.fork() 拉起的入口。
// 与 core 通过 process.send/process.on('message') 做 IPC：
//   core → 本模块：{ type:'config', agentId, apiBase } / { type:'incoming_message', data }
//   本模块 → core：{ type:'ready' } / { type:'status', ok, reason } / { type:'draft_reply', messageId, draft }

import {
  startWechatListener,
  isListenerAlive,
  collectListenerHealth,
  buildHealthStatusMessage,
} from './handlers/wechat-rpa';

export interface ModuleConfig {
  agentId: string;
  apiBase: string;
  // 本机 machine_id：listen_chat 按它向中台拉「自己那份」每客服配置（决策 143f5d00）
  machineId?: string;
}

export interface IncomingMessage {
  messageId?: string;
  [k: string]: unknown;
}

type Send = (msg: unknown) => void;

// 模块运行时状态（由 config 消息初始化）。
const state: {
  agentId?: string;
  apiBase?: string;
  machineId?: string;
  ready: boolean;
  healthTimer?: ReturnType<typeof setInterval>;
} = { ready: false };

// 自愈件4：模块健康自检上报间隔（合成 listen_chat 真实健康 → IPC 上报 core → 随心跳上报中台）。
const HEALTH_REPORT_INTERVAL_MS = 30_000;

// 自检一次：合成 listen_chat 真实健康（进程在不在 / 微信窗口找到没 / 最近一次成功送达）→ IPC status。
export function reportHealthOnce(send: Send): void {
  const health = collectListenerHealth({ listenerAlive: isListenerAlive() });
  send(buildHealthStatusMessage(health));
}

// 收到 config：初始化身份 + 启动微信监听（Windows），回 ready，并启动健康自检上报 loop。
export function handleConfig(cfg: ModuleConfig, send: Send): void {
  state.agentId = cfg.agentId;
  state.apiBase = cfg.apiBase;
  state.machineId = cfg.machineId;
  state.ready = true;
  // Windows 上拉起 listen_chat.py 常驻监听；非 Windows 内部自动跳过。
  // machineId 下发给 listener → 按它拉「自己那份」每客服配置（真发跟随中台 auto_agent 开关）。
  if (cfg.apiBase) {
    startWechatListener(cfg.apiBase, cfg.agentId || undefined, cfg.machineId || undefined);
  }
  send({ type: 'ready' });
  // 自愈件4：周期性把 listen_chat 真实健康上报 core（管理员/诊断页看模块"实际健康"）。
  if (!state.healthTimer) {
    reportHealthOnce(send);
    state.healthTimer = setInterval(() => reportHealthOnce(send), HEALTH_REPORT_INTERVAL_MS);
    (state.healthTimer as unknown as { unref?: () => void }).unref?.();
  }
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
      handleConfig(
        { agentId: msg.agentId ?? '', apiBase: msg.apiBase ?? '', machineId: msg.machineId },
        send,
      );
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
