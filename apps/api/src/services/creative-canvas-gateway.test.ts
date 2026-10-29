import { describe, it, expect, afterEach, vi } from 'vitest';
import dotenv from 'dotenv';
import http, { type Server } from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { createCanvasGateway, configuredCanvasGateway } from './creative-canvas-gateway';
const servers: Server[] = [];
async function listen(server: Server): Promise<number> { servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw Error('bad address'); return address.port; }
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => s.close(() => resolve())))); });
async function backend(label: string) { const s = http.createServer((req,res) => { res.setHeader('Content-Type', 'application/json'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.end(JSON.stringify({ label, path: req.url, cookie: req.headers.cookie })); }); const w = new WebSocketServer({ server: s }); w.on('connection', ws => ws.send(label)); return await listen(s); }
function openWs(url: string, cookie?: string, origin = 'http://example.test'): Promise<string> { return new Promise(resolve => { const ws = new WebSocket(url, { headers: { ...(cookie ? { cookie } : {}), origin } }); ws.on('message', data => { const result = data.toString(); ws.close(); resolve(result); }); ws.on('unexpected-response', (_, res) => { resolve(String(res.statusCode)); ws.terminate(); }); ws.on('error', () => resolve('error')); }); }
describe('creative canvas gateway', () => {
  it('isolates staff HTTP and WebSocket traffic, strips cookies and rejects other origins', async () => {
    const a = await backend('alice'), b = await backend('bob');
    const gateway = createCanvasGateway({ authenticate: async req => req.headers.cookie === 'session=alice' ? 'alice' : req.headers.cookie === 'session=bob' ? 'bob' : null, instances: { alice: `http://127.0.0.1:${a}`, bob: `http://127.0.0.1:${b}` }, allowedOrigins: ['http://example.test'] });
    const server = http.createServer(gateway.handleHttp); gateway.attachWebSocket(server); const port = await listen(server);
    const base = `http://127.0.0.1:${port}/api/creative-canvas/`;
    expect((await fetch(base)).status).toBe(401);
    expect(await (await fetch(base+'status', {headers:{cookie:'session=alice'}})).json()).toEqual({available:true});
    const alice = await (await fetch(base+'history', { headers: {cookie:'session=alice'} })).json();
    const bob = await (await fetch(base+'history', { headers: {cookie:'session=bob'} })).json();
    expect(alice).toEqual({ label:'alice', path:'/history' }); expect(bob).toEqual({label:'bob', path:'/history'});
    expect((await fetch(base, {headers:{cookie:'session=alice',origin:'https://evil.example'}})).status).toBe(403);
    const ws = `ws://127.0.0.1:${port}/api/creative-canvas/ws`;
    expect(await openWs(ws)).toBe('401'); expect(await openWs(ws,'session=alice')).toBe('alice'); expect(await openWs(ws,'session=bob')).toBe('bob'); expect(await openWs(ws,'session=alice','https://evil.example')).toBe('403');
  });
  it('reports an unprovisioned staff canvas as unavailable', async () => {
    const gateway = createCanvasGateway({ authenticate: async () => 'alice', instances: {}, allowedOrigins: [] });
    const server = http.createServer(gateway.handleHttp); gateway.attachWebSocket(server); const port = await listen(server);
    const base = `http://127.0.0.1:${port}/api/creative-canvas/`;
    expect(await (await fetch(base+'status')).json()).toEqual({available:false});
    expect((await fetch(base)).status).toBe(503);
  });
  it('loads dotenv before capturing instance settings', () => {
    const previous = process.env.CREATIVE_CANVAS_INSTANCES;
    delete process.env.CREATIVE_CANVAS_INSTANCES;
    const loader = vi.spyOn(dotenv, 'config').mockImplementation(() => {
      process.env.CREATIVE_CANVAS_INSTANCES = '{"alice":"http://127.0.0.1:18188"}';
      return { parsed: {} };
    });
    try { expect(configuredCanvasGateway().instances).toEqual({alice:'http://127.0.0.1:18188'}); expect(loader).toHaveBeenCalled(); }
    finally { loader.mockRestore(); if (previous === undefined) delete process.env.CREATIVE_CANVAS_INSTANCES; else process.env.CREATIVE_CANVAS_INSTANCES = previous; }
  });
  it('rejects configurations that route two employees to the same instance', () => { expect(() => createCanvasGateway({ authenticate: async () => 'alice', instances: {alice:'http://127.0.0.1:18188', bob:'http://127.0.0.1:18188'}, allowedOrigins: [] })).toThrow(); });
});
