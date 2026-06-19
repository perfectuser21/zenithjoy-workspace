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
