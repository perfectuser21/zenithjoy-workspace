import dotenv from 'dotenv';
import http from 'http';
import app from './app';
import { attachAgentWS } from './services/agent-ws';
import { startStaleListenerMonitor } from './services/wechat-heartbeat';
import { runStartupConfigCheck } from './startup-check';

dotenv.config();

// 启动早期自检关键 env（哨兵）：缺 key 大声打红日志但不崩进程。
// 治根 2026-06-19 生产漏 TOAPI_API_KEY → 客服静默不回。
runStartupConfigCheck();

// 进程级安全网：单个路由的未捕获 Promise rejection（Node 15+ 默认行为）会杀死整个进程，
// 拖垮同机所有其它无关请求/CI smoke（2026-07-09 PR#1207 实测：cookie-health 一次未捕获异常
// 打崩整个 apps/api，级联导致同一 CI job 后续所有 smoke 脚本连 000 connection refused）。
// 只打红日志不退出，路由自身的 500 由各自 handler/Express 默认错误中间件处理。
process.on('unhandledRejection', (reason) => {
  console.error('🔴 [unhandledRejection] 未捕获的 Promise 拒绝，已拦截，进程不退出:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('🔴 [uncaughtException] 未捕获的异常，已拦截，进程不退出:', err);
});

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
attachAgentWS(server);
server.listen(PORT, () => {
  console.log(`🚀 Works Management API + Agent WS running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   API docs: http://localhost:${PORT}/api/works`);
  console.log(`   Agent WS: ws://localhost:${PORT}/agent-ws`);
  // 选题池 v1 阶段2：老 pipeline-scheduler 已废除，改由 topic-worker.py LaunchAgent 每日 09:00 触发
  // 进程守护：每分钟检查微信监听心跳，断 3 分钟无心跳 → 飞书告警（FEISHU_ALERT_WEBHOOK）
  startStaleListenerMonitor();
});
