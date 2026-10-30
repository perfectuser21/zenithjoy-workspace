import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import dotenv from 'dotenv';
import type { Duplex } from 'node:stream';

const PREFIX = '/api/creative-canvas/';
type Options = { authenticate: (request: IncomingMessage) => Promise<string | null>; instances: Record<string, string>; allowedOrigins: string[]; staticTimeoutMs?: number };
export function createCanvasGateway(options: Options) {
  const targets = new Map<string, URL>();
  const used = new Set<string>();
  for (const [user, address] of Object.entries(options.instances)) {
    const target = new URL(address);
    if (target.protocol !== 'http:' || target.username || target.password || target.pathname !== '/' || target.search || target.hash || used.has(target.origin)) throw new Error('Invalid or duplicate canvas instance');
    used.add(target.origin); targets.set(user, target);
  }
  const allowOrigin = (req: IncomingMessage, ws = false) => {
    const origin = req.headers.origin;
    if (!origin) return !ws && (req.method === 'GET' || req.method === 'HEAD');
    return options.allowedOrigins.includes(origin);
  };
  async function authorize(req: IncomingMessage, ws = false): Promise<{ target?: URL; status: number }> {
    if (!allowOrigin(req, ws)) return { status: 403 };
    const user = await options.authenticate(req);
    if (!user) return { status: 401 };
    const target = targets.get(user);
    return target ? { target, status: 200 } : { status: 503 };
  }
  function request(req: IncomingMessage, target: URL) {
    const headers = { ...req.headers };
    delete headers.cookie; delete headers.authorization; delete headers['proxy-authorization']; delete headers['comfy-user'];
    return http.request({ hostname: target.hostname, port: target.port || 80, method: req.method, path: '/' + (req.url || '').slice(PREFIX.length), headers });
  }
  async function handleHttp(req: IncomingMessage, res: ServerResponse) {
    if (!(req.url || '').startsWith(PREFIX)) { res.writeHead(404).end(); return; }
    try {
      const { target, status } = await authorize(req);
      if (req.aborted || res.destroyed) return;
      if (req.method === 'GET' && req.url === `${PREFIX}status`) {
        if (status === 401 || status === 403) { res.writeHead(status).end(); return; }
        if (!target) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ available: false })); return; }
        const probe = http.get({ hostname: target.hostname, port: target.port || 80, path: '/system_stats', timeout: 2000 }, reply => {
          reply.resume(); res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ available: reply.statusCode === 200 }));
        });
        probe.on('timeout', () => probe.destroy());
        probe.on('error', () => { if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ available: false })); });
        return;
      }
      if (!target) { res.writeHead(status).end(); return; }
      const upstream = request(req, target);
      let timedOut = false;
      // Only immutable frontend assets receive a short inactivity timeout;
      // jobs, uploads and other potentially long-lived operations remain unchanged.
      const pathname = (req.url || '').split('?', 1)[0];
      const isStatic = (req.method === 'GET' || req.method === 'HEAD') &&
        /^\/api\/creative-canvas\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css|woff2)$/.test(pathname);
      if (isStatic) upstream.setTimeout(options.staticTimeoutMs ?? 15000, () => {
        timedOut = true;
        upstream.destroy(new Error('Canvas static asset timed out'));
      });
      // A closed client must not leave an upstream response consuming resources.
      res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
      req.on('aborted', () => upstream.destroy());
      upstream.on('response', incoming => {
        if (res.destroyed) { incoming.destroy(); return; }
        incoming.on('error', () => { if (!res.destroyed) res.destroy(); });
        incoming.on('aborted', () => { if (!res.destroyed) res.destroy(); });
        incoming.on('end', () => { if (isStatic) upstream.setTimeout(0); });
        delete incoming.headers['set-cookie'];
        // Only immutable build-fingerprinted frontend files are shareable by a
        // browser. Never cache API responses, user media, errors or templates.
        if ((req.method === 'GET' || req.method === 'HEAD') && incoming.statusCode === 200 && /^\/api\/creative-canvas\/assets\/[a-zA-Z0-9_.-]+-[a-zA-Z0-9_-]{8,}\.(?:js|css|woff2)$/.test(pathname)) {
          incoming.headers['cache-control'] = 'private, max-age=604800, immutable';
          const vary = incoming.headers.vary;
          incoming.headers.vary = vary ? `${vary}, Cookie` : 'Cookie';
        }
        res.writeHead(incoming.statusCode || 502, incoming.headers); incoming.pipe(res);
      });
      upstream.on('error', () => {
        if (res.destroyed) return;
        if (res.headersSent) { res.destroy(); return; }
        res.writeHead(timedOut ? 504 : 502).end();
      });
      req.pipe(upstream);
    } catch { if (!res.destroyed && !res.headersSent) res.writeHead(503).end(); else if (!res.destroyed) res.destroy(); }
  }
  function attachWebSocket(server: Server) {
    server.on('upgrade', async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!(req.url || '').startsWith(PREFIX)) return;
      try {
        const { target, status } = await authorize(req, true);
        if (!target) { socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`); return; }
        const upstream = request(req, target);
        upstream.on('upgrade', (response, remote, remoteHead) => {
          const lines: string[] = [];
          for (let i = 0; i < response.rawHeaders.length; i += 2) if (response.rawHeaders[i].toLowerCase() !== 'set-cookie') lines.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i+1]}`);
          socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`);
          if (head.length) remote.write(head); if (remoteHead.length) socket.write(remoteHead);
          socket.pipe(remote).pipe(socket);
          socket.on('error', () => remote.destroy()); remote.on('error', () => socket.destroy());
        });
        upstream.on('response', () => socket.destroy()); upstream.on('error', () => socket.destroy()); upstream.end();
      } catch { socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); }
    });
  }
  return { handleHttp, attachWebSocket };
}

// Operators provision one private instance per employee. An empty or invalid map
// fails closed; it never falls back to a shared instance.
export function configuredCanvasGateway() {
  // app.ts is imported before index.ts calls dotenv.config().
  dotenv.config();
  let instances: Record<string, string> = {};
  try {
    const value: unknown = JSON.parse(process.env.CREATIVE_CANVAS_INSTANCES || '{}');
    if (!value || Array.isArray(value) || typeof value !== 'object' || Object.values(value).some(v => typeof v !== 'string')) throw Error('invalid mapping');
    instances = value as Record<string, string>;
  } catch { console.error('[creative-canvas] invalid instance mapping; disabled'); }
  const origins = [process.env.BETTER_AUTH_URL || '', ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS || '').split(','), ...(process.env.CREATIVE_CANVAS_ALLOWED_ORIGINS || '').split(',')].map(s => s.trim()).filter(Boolean);
  return { instances, allowedOrigins: origins };
}
