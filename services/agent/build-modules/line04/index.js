"use strict";
// modules/line04/index.ts
//
// line04 微信AI客服模块 — 被 core 通过 child_process.fork() 拉起的入口。
// 与 core 通过 process.send/process.on('message') 做 IPC：
//   core → 本模块：{ type:'config', agentId, apiBase } / { type:'incoming_message', data }
//   本模块 → core：{ type:'ready' } / { type:'status', ok, reason } / { type:'draft_reply', messageId, draft }
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportHealthOnce = reportHealthOnce;
exports.handleConfig = handleConfig;
exports.handleMessage = handleMessage;
exports.registerIpc = registerIpc;
exports.start = start;
const wechat_rpa_1 = require("./handlers/wechat-rpa");
// 模块运行时状态（由 config 消息初始化）。
const state = { ready: false };
// 自愈件4：模块健康自检上报间隔（合成 listen_chat 真实健康 → IPC 上报 core → 随心跳上报中台）。
const HEALTH_REPORT_INTERVAL_MS = 30000;
// 自检一次：合成 listen_chat 真实健康（进程在不在 / 微信窗口找到没 / 最近一次成功送达）→ IPC status。
function reportHealthOnce(send) {
    const health = (0, wechat_rpa_1.collectListenerHealth)({ listenerAlive: (0, wechat_rpa_1.isListenerAlive)() });
    send((0, wechat_rpa_1.buildHealthStatusMessage)(health));
}
// 收到 config：初始化身份 + 启动微信监听（Windows），回 ready，并启动健康自检上报 loop。
function handleConfig(cfg, send) {
    state.agentId = cfg.agentId;
    state.apiBase = cfg.apiBase;
    state.ready = true;
    // Windows 上拉起 listen_chat.py 常驻监听；非 Windows 内部自动跳过。
    if (cfg.apiBase) {
        (0, wechat_rpa_1.startWechatListener)(cfg.apiBase, cfg.agentId || undefined);
    }
    send({ type: 'ready' });
    // 自愈件4：周期性把 listen_chat 真实健康上报 core（管理员/诊断页看模块"实际健康"）。
    if (!state.healthTimer) {
        reportHealthOnce(send);
        state.healthTimer = setInterval(() => reportHealthOnce(send), HEALTH_REPORT_INTERVAL_MS);
        state.healthTimer.unref?.();
    }
}
// 收到 incoming_message：thin 阶段先回执已接收（draft 生成由后续加厚接入 LLM）。
function handleMessage(data, send) {
    if (!state.ready) {
        send({ type: 'status', ok: false, reason: '模块尚未初始化（未收到 config）' });
        return;
    }
    send({ type: 'status', ok: true, reason: `已接收消息 ${data?.messageId ?? '(no id)'}` });
}
// 注册 IPC 监听。core fork 后即生效。
function registerIpc(send = (m) => process.send?.(m)) {
    process.on('message', (msg) => {
        if (!msg || typeof msg !== 'object')
            return;
        if (msg.type === 'config') {
            handleConfig({ agentId: msg.agentId ?? '', apiBase: msg.apiBase ?? '' }, send);
        }
        else if (msg.type === 'incoming_message') {
            handleMessage(msg.data ?? {}, send);
        }
    });
}
function start() {
    registerIpc();
    console.log('[line04] 模块已启动，等待 core config…');
}
// 仅在被 core fork（作为入口运行）时注册 IPC；被 import（如测试）时不副作用。
if (require.main === module) {
    start();
}
