import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { once } from 'node:events';

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock('../auth', () => ({ auth: { api: { getSession: async () => session.user ? { user: session.user } : null } } }));
vi.mock('../staff-directory', () => ({ parseFlatDirectory: () => new Set(['staff@example.com']) }));

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('configured creative canvas authentication', () => {
  it('requires staff and reports an unprovisioned employee instance', async () => {
    vi.stubEnv('CREATIVE_CANVAS_INSTANCES', '{}');
    const { creativeCanvasGateway } = await import('./creative-canvas-configured');
    const server = http.createServer(creativeCanvasGateway.handleHttp).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw Error('bad address');
    const url = `http://127.0.0.1:${address.port}/api/creative-canvas/status`;
    try {
      session.user = null;
      expect((await fetch(url)).status).toBe(401);
      session.user = { id:'other', email:'other@example.com' };
      expect((await fetch(url)).status).toBe(401);
      session.user = { id:'alice', email:'STAFF@example.com' };
      expect(await (await fetch(url)).json()).toEqual({ available:false });
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); session.user = null; }
  });
});
