import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { buildJsonFrame, buildAudioFrame, parseFrame, EventSend } from './doubao-protocol.js';
import { computeTurnLatency } from './latency-tracker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 8092;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REALTIME_MODEL = process.env.REALTIME_MODEL || 'gpt-realtime-2.1-mini';
const REALTIME_VOICE = process.env.REALTIME_VOICE || 'marin';
const INSTRUCTIONS = '你是一位中文AI助手。所有回答使用普通话。回答保持自然。不要太长。控制在20秒以内。';

const VOLC_APP_ID = process.env.VOLC_APP_ID;
const VOLC_ACCESS_KEY = process.env.VOLC_ACCESS_KEY;
// 火山引擎公开文档固定值（非密钥，所有开发者共用，写在部署 .env 里）
const VOLC_APP_KEY = process.env.VOLC_APP_KEY;
const VOLC_RESOURCE_ID = 'volc.speech.dialog';
const VOLC_WS_URL = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue';
const VOLC_VOICE = process.env.VOLC_VOICE || 'zh_female_vv_jupiter_bigtts';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function createRealtimeSession() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      session: {
        type: 'realtime',
        model: REALTIME_MODEL,
        instructions: INSTRUCTIONS,
        audio: { output: { voice: REALTIME_VOICE } },
      },
    });
    const req = https.request(
      {
        hostname: 'api.openai.com',
        path: '/v1/realtime/client_secrets',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`OpenAI ${res.statusCode}: ${data}`));
          resolve(JSON.parse(data));
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * 国内版语音管线：浏览器 WS ⇄ 服务器 ⇄ 豆包 Realtime Dialogue WS
 * 浏览器发 JSON 控制消息（start/stop）+ 二进制 PCM16 16kHz 单声道音频块
 * 服务器发 JSON 状态/日志消息 + 二进制 PCM16 24kHz 单声道音频块（AI 回复语音）
 */
function handleDomesticConnection(browserWs) {
  let doubaoWs = null;
  let sessionId = null;
  let lastAsrAt = null;
  let chatStartAt = null;
  let firstTtsAt = null;
  let turnIndex = 0;

  const send = (obj) => {
    if (browserWs.readyState === WebSocket.OPEN) browserWs.send(JSON.stringify(obj));
  };
  const log = (message) => send({ type: 'log', message });
  const status = (state) => send({ type: 'status', state });

  function startDoubaoSession() {
    if (!VOLC_APP_ID || !VOLC_ACCESS_KEY || !VOLC_APP_KEY) {
      send({ type: 'error', message: 'VOLC_APP_ID/VOLC_ACCESS_KEY/VOLC_APP_KEY not configured' });
      return;
    }
    sessionId = `sess-${randomUUID()}`;
    status('connecting');
    log('连接豆包 Realtime Dialogue...');

    doubaoWs = new WebSocket(VOLC_WS_URL, {
      headers: {
        'X-Api-App-ID': VOLC_APP_ID,
        'X-Api-Access-Key': VOLC_ACCESS_KEY,
        'X-Api-Resource-Id': VOLC_RESOURCE_ID,
        'X-Api-App-Key': VOLC_APP_KEY,
      },
    });

    doubaoWs.on('open', () => {
      doubaoWs.send(buildJsonFrame(EventSend.StartConnection, null, {}));
    });

    doubaoWs.on('message', (data) => {
      const parsed = parseFrame(Buffer.isBuffer(data) ? data : Buffer.from(data));
      switch (parsed.eventName) {
        case 'ConnectionStarted':
          doubaoWs.send(
            buildJsonFrame(EventSend.StartSession, sessionId, {
              dialog: { bot_name: '豆包', system_role: INSTRUCTIONS },
              tts: {
                speaker: VOLC_VOICE,
                audio_config: { channel: 1, format: 'pcm_s16le', sample_rate: 24000 },
              },
              asr: { audio_info: { format: 'pcm', sample_rate: 16000, channel: 1 } },
            })
          );
          break;
        case 'SessionStarted':
          log(`Session 建立成功，dialog_id=${parsed.payload.dialog_id || ''}`);
          status('connected');
          break;
        case 'ASRInfo':
          status('listening');
          log('检测到用户开始说话');
          break;
        case 'ASRResponse': {
          const text = (parsed.payload.results || []).map((r) => r.text).join('');
          if (text) {
            log(`识别中: ${text}`);
            lastAsrAt = Date.now();
          }
          break;
        }
        case 'ChatResponse':
          status('speaking');
          if (chatStartAt === null) chatStartAt = Date.now();
          break;
        case 'TTSResponse':
          if (parsed.audio && parsed.audio.length && browserWs.readyState === WebSocket.OPEN) {
            if (firstTtsAt === null) firstTtsAt = Date.now();
            browserWs.send(parsed.audio, { binary: true });
          }
          break;
        case 'ChatEnded': {
          status('connected');
          log('AI 回复结束');
          if (lastAsrAt !== null) {
            turnIndex += 1;
            const latency = computeTurnLatency({
              lastAsrAt,
              chatStartAt,
              firstTtsAt,
              chatEndedAt: Date.now(),
            });
            console.log(JSON.stringify({ event: 'voice_latency', sessionId, turn: turnIndex, ...latency }));
          }
          lastAsrAt = null;
          chatStartAt = null;
          firstTtsAt = null;
          break;
        }
        case 'DialogCommonError':
          send({ type: 'error', message: JSON.stringify(parsed.payload) });
          break;
        default:
          break;
      }
      if (parsed.messageType === 0b1111 && parsed.eventName !== 'DialogCommonError') {
        send({ type: 'error', message: `豆包错误: ${JSON.stringify(parsed.payload)}` });
      }
    });

    doubaoWs.on('error', (err) => {
      log(`豆包连接错误: ${err.message}`);
      send({ type: 'error', message: err.message });
    });

    doubaoWs.on('close', () => {
      status('');
      log('豆包连接已关闭');
    });
  }

  browserWs.on('message', (data, isBinary) => {
    if (isBinary) {
      if (doubaoWs && doubaoWs.readyState === WebSocket.OPEN && sessionId) {
        doubaoWs.send(buildAudioFrame(sessionId, Buffer.isBuffer(data) ? data : Buffer.from(data)));
      }
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    if (msg.type === 'start') startDoubaoSession();
    else if (msg.type === 'stop') {
      if (doubaoWs && doubaoWs.readyState === WebSocket.OPEN && sessionId) {
        doubaoWs.send(buildJsonFrame(EventSend.FinishSession, sessionId, {}));
      }
      doubaoWs?.close();
    }
  });

  browserWs.on('close', () => {
    doubaoWs?.close();
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/session') {
      if (!OPENAI_API_KEY) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }));
        return;
      }
      try {
        const session = await createRealtimeSession();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          client_secret: session.value,
          expires_at: session.expires_at,
          model: REALTIME_MODEL,
          voice: REALTIME_VOICE,
        }));
      } catch (err) {
        console.error('[session] error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'GET') {
      let filePath = req.url === '/' ? '/index.html' : req.url;
      filePath = path.join(__dirname, 'public', path.normalize(filePath).replace(/^(\.\.[/\\])+/, ''));
      const ext = path.extname(filePath);
      fs.readFile(filePath, (err, content) => {
        if (err) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(content);
      });
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });
}

function attachDomesticWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', handleDomesticConnection);
  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws/domestic') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
    } else {
      socket.destroy();
    }
  });
  return wss;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const server = createServer();
  attachDomesticWebSocket(server);
  server.listen(PORT, () => console.log(`realtime-mvp listening on :${PORT}, model=${REALTIME_MODEL}`));
}

export { createServer, createRealtimeSession, attachDomesticWebSocket };
