import http from 'node:http';
import { once } from 'node:events';
import { expect, it } from 'vitest';
it('default API setup uses fresh client connections across short-lived requests', async () => {
  const server = http.createServer((req, res) => res.end(req.headers.connection));
  let connections = 0; server.on('connection', () => { connections++; });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address() as { port: number };
    const get = () => new Promise<string>((resolve, reject) => {
      http.get(`http://127.0.0.1:${address.port}`, res => {
        let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve(body));
      }).on('error', reject);
    });
    expect(await get()).toBe('close'); expect(await get()).toBe('close');
    expect(connections).toBe(2);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
