import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 8092;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REALTIME_MODEL = process.env.REALTIME_MODEL || 'gpt-realtime-2.1-mini';
const REALTIME_VOICE = process.env.REALTIME_VOICE || 'marin';
const INSTRUCTIONS = '你是一位中文AI助手。所有回答使用普通话。回答保持自然。不要太长。控制在20秒以内。';

// 部分出口 IP（如香港）被 OpenAI 判定 unsupported_country_region_territory，
// 用 OPENAI_PROXY_HOST/PORT 把 TCP 连接转走美国出口；SNI/Host 仍指向 api.openai.com，
// TLS 证书校验不受影响（隧道只做透明字节转发）。
const OPENAI_PROXY_HOST = process.env.OPENAI_PROXY_HOST || '';
const OPENAI_PROXY_PORT = process.env.OPENAI_PROXY_PORT || '';

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
        hostname: OPENAI_PROXY_HOST || 'api.openai.com',
        port: OPENAI_PROXY_PORT || 443,
        servername: 'api.openai.com',
        path: '/v1/realtime/client_secrets',
        method: 'POST',
        headers: {
          Host: 'api.openai.com',
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

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  createServer().listen(PORT, () => console.log(`realtime-mvp listening on :${PORT}, model=${REALTIME_MODEL}`));
}

export { createServer, createRealtimeSession };
