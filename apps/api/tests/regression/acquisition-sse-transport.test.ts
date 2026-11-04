import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
const fixtures = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/db/connection', () => ({ default: { query: fixtures.query, end: vi.fn() } }));
vi.mock('../../src/auth', () => ({ auth: { api: { getSession: vi.fn().mockResolvedValue(null) } } }));
import app from '../../src/app';
import { sseService } from '../../src/services/sse.service';
beforeEach(() => {
  fixtures.query.mockReset().mockImplementation(async (_sql: string, values: string[]) => ({ rows: values?.[0] === 'isolated-license'
    ? [{ id: 'isolated-license-id', license_key: 'isolated-license', tenant_id: 'isolated-tenant', status: 'active', expires_at: '2099-01-01T00:00:00Z' }] : [] }));
});
afterEach(() => { sseService.close('agent-tasks:isolated-tenant'); });
it('actual licensed task-stream returns SSE headers, connected event and only its tenant events', async () => {
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const unauthenticated = await fetch(`${base}/api/acquisition/agent/task-stream`);
    expect(unauthenticated.status).toBe(401);
    const invalid = await fetch(`${base}/api/acquisition/agent/task-stream`, { headers: { 'x-license-key': 'wrong' } });
    expect(invalid.status).toBe(401);
    const response = await fetch(`${base}/api/acquisition/agent/task-stream`, {
      headers: { 'x-license-key': 'isolated-license' }, signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const reader = response.body!.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    expect(initial).toBe('data: {"type":"connected","tenant_id":"isolated-tenant"}\n\n');
    sseService.emit('agent-tasks:other-tenant', { type: 'private-task', id: 'foreign' });
    sseService.emit('agent-tasks:isolated-tenant', { type: 'task', id: 'owned' });
    const pushed = new TextDecoder().decode((await reader.read()).value);
    expect(pushed).toBe('data: {"type":"task","id":"owned"}\n\n');
    expect(fixtures.query.mock.calls.some(([, values]) => values?.[0] === 'isolated-license')).toBe(true);
    await reader.cancel();
  } finally {
    clearTimeout(timeout); controller.abort();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
