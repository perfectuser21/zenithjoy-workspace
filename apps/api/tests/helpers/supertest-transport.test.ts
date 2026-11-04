import express from 'express';
import http from 'node:http';
import { once } from 'node:events';
import { expect, it, vi } from 'vitest';
import request from 'supertest';
import { createSupertestTransport } from './supertest-transport';

it('actual TCP adapter reuses one listener per app, isolates apps/status, retains real agent cookies and closes only owned servers', async () => {
  const actual = await vi.importActual<typeof import('supertest')>('supertest');
  const transport = createSupertestTransport(actual.default);
  const app = express();
  app.get('/port', (req, res) => res.json({ port: req.socket.localPort }));
  app.get('/failure', (_req, res) => res.status(418).json({ error: 'real-teapot' }));
  app.post('/login', (_req, res) => res.cookie('session', 'fixture-cookie').sendStatus(204));
  app.get('/cookie', (req, res) => res.json({ cookie: req.headers.cookie ?? null }));
  const other = express(); other.get('/port', (req, res) => res.json({ port: req.socket.localPort, app: 'other' }));
  const external = http.createServer((_req, res) => { res.statusCode = 409; res.end('external'); });
  external.listen(0); await once(external, 'listening');
  const externalPort = (external.address() as { port: number }).port;
  let owned: http.Server[] = [];
  try {
    const first = await transport.request(app).get('/port').expect(200);
    const second = await transport.request(app).get('/port').expect(200);
    expect(second.body.port).toBe(first.body.port);
    expect(transport.servers.size).toBe(1);
    const isolated = await transport.request(other).get('/port').expect(200);
    expect(isolated.body.port).not.toBe(first.body.port); expect(isolated.body.app).toBe('other');
    expect((await transport.request(app).get('/failure').expect(418)).body).toEqual({ error: 'real-teapot' });
    const agent = transport.request.agent(app);
    await agent.post('/login').expect(204);
    expect((await agent.get('/cookie').expect(200)).body.cookie).toContain('session=fixture-cookie');
    expect((await transport.request.agent(app).get('/cookie').expect(200)).body.cookie).toBeNull();
    await transport.request(external).get('/').expect(409, 'external');
    await transport.request(`http://127.0.0.1:${externalPort}`).get('/').expect(409, 'external');
    expect(transport.servers.size).toBe(2);
    owned = [...transport.servers] as http.Server[];
    await transport.close();
    expect(owned.every(server => !server.listening)).toBe(true);
    expect(external.listening).toBe(true);
    await transport.request(external).get('/').expect(409, 'external');
  } finally {
    await transport.close();
    await new Promise<void>((resolve, reject) => external.close(error => error ? reject(error) : resolve()));
  }
});
it('default setup transparently routes repeated request(app) calls to the same real server', async () => {
  const app = express(); app.get('/', (req, res) => res.json({ port: req.socket.localPort }));
  expect((await request(app).get('/')).body.port).toBe((await request(app).get('/')).body.port);
});
