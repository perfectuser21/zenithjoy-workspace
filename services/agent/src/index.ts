// services/agent/src/index.ts
import WebSocket from 'ws';
import crypto from 'crypto';

const API_URL = process.env.ZENITHJOY_API_URL || 'ws://localhost:5200/agent-ws';
const TOKEN = process.env.AGENT_TOKEN || '';
const AGENT_ID = process.env.AGENT_ID || `agent-${crypto.randomBytes(4).toString('hex')}`;
const VERSION = '0.1.0';
const CAPABILITIES = ['wechat'];

const startTime = Date.now();
let backoff = 1000;
const MAX_BACKOFF = 30000;

function makeMsg(type: string, payload: any, taskId?: string) {
  return {
    v: 1, type, msgId: crypto.randomUUID(),
    ...(taskId ? { taskId } : {}),
    ts: Date.now(), payload,
  };
}

function connect() {
  const url = `${API_URL}?token=${encodeURIComponent(TOKEN)}`;
  console.log(`[agent] connecting to ${API_URL}...`);
  const ws = new WebSocket(url);

  let heartbeatTimer: NodeJS.Timeout | null = null;

  ws.on('open', () => {
    console.log(`[agent] connected as ${AGENT_ID}`);
    backoff = 1000; // reset
    ws.send(JSON.stringify(makeMsg('hello', {
      agentId: AGENT_ID, version: VERSION, capabilities: CAPABILITIES,
    })));
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(makeMsg('heartbeat', {
          uptime: Date.now() - startTime, busy: false,
        })));
      }
    }, 15000);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      console.log(`[agent] received:`, msg.type, msg.taskId || '');
      // Task 5 实现 publish_request 处理
    } catch (err) {
      console.warn('[agent] invalid message:', err);
    }
  });

  ws.on('close', (code) => {
    console.log(`[agent] closed: ${code}, reconnecting in ${backoff}ms`);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF);
  });

  ws.on('error', (err) => {
    console.warn('[agent] error:', err.message);
  });
}

connect();
