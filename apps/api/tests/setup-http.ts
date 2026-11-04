/** Default API test transport only. No DB, model, auth or product mocks.
 * Node 20 enables keep-alive on globalAgent; supertest(app) often creates a
 * short-lived server per request. Do not reuse sockets across those lifetimes. */
import http from 'node:http';
import https from 'node:https';
for (const agent of [http.globalAgent, https.globalAgent]) {
  Object.assign(agent, { keepAlive: false });
  agent.options.keepAlive = false;
  agent.destroy();
}

import { afterAll, vi } from 'vitest';
const lifetime = vi.hoisted(() => ({ adapters: [] as Array<{ close(): Promise<void> }> }));
vi.mock('supertest', async () => {
  const actual = await vi.importActual<typeof import('supertest')>('supertest');
  const { createSupertestTransport } = await import('./helpers/supertest-transport');
  const adapter = createSupertestTransport(actual.default);
  lifetime.adapters.push(adapter);
  return { ...actual, default: adapter.request, agent: adapter.request.agent };
});
afterAll(async () => {
  // Only servers created from Express functions by this suite's adapter.
  // Explicit Server/URL inputs and all external DB/auth/provider state are untouched.
  const adapters = lifetime.adapters.splice(0);
  await Promise.all(adapters.map(adapter => adapter.close()));
});
