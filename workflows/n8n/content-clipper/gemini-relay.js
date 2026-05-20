/**
 * Gemini Relay Service (runs on us-mac)
 * POST /transcribe  multipart with "audio" field (binary MP4)
 * OR   POST /transcribe  {"audio_b64": "...", "mime_type": "video/mp4"}
 */

const http = require('http');
const https = require('https');
const fs = require('fs');

const PORT = 7789;
const OPENROUTER_KEY = process.env.OPENROUTER_KEY || '';

function callGemini(audioB64, mimeType) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '请将这段视频/音频内容完整转写成文字。直接输出转写内容，不要加任何说明或注释。' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${audioB64}` } }
        ]
      }]
    });
    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'HTTP-Referer': 'https://cecelia.app',
        'X-Title': 'Cecelia Relay'
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(d);
          if (r.choices && r.choices[0]) resolve(r.choices[0].message.content);
          else reject(new Error('Gemini: ' + JSON.stringify(r).slice(0, 300)));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('Gemini timeout')); });
    req.write(payload);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', service: 'gemini-relay', port: PORT }));
    return;
  }

  if (req.method === 'POST' && req.url === '/transcribe') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const { audio_b64, mime_type = 'video/mp4' } = body;
        if (!audio_b64) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing audio_b64' })); return; }
        console.log(`[${new Date().toISOString()}] Transcribing ${(audio_b64.length * 3/4 / 1024 / 1024).toFixed(2)} MB`);
        const t = Date.now();
        const transcript = await callGemini(audio_b64, mime_type);
        const sec = ((Date.now() - t) / 1000).toFixed(1);
        console.log(`  Done: ${transcript.length} chars in ${sec}s`);
        res.writeHead(200);
        res.end(JSON.stringify({ transcript, time_s: parseFloat(sec) }));
      } catch (e) {
        console.error('Error:', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Gemini Relay on port ${PORT}`);
});

process.on('uncaughtException', e => console.error('Uncaught:', e.message));
