import dotenv from 'dotenv';
import http from 'http';
import app from './app';
import { attachAgentWS } from './services/agent-ws';

dotenv.config();

const PORT = process.env.PORT || 5200;

const server = http.createServer(app);
attachAgentWS(server);
server.listen(PORT, () => {
  console.log(`🚀 Works Management API + Agent WS running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   API docs: http://localhost:${PORT}/api/works`);
  console.log(`   Agent WS: ws://localhost:${PORT}/agent-ws`);
  // 选题池 v1 阶段2：老 pipeline-scheduler 已废除，改由 topic-worker.py LaunchAgent 每日 09:00 触发
});
