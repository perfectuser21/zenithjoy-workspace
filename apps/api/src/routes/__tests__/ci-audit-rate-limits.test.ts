import { afterEach, expect, it, vi } from 'vitest';
import express, { type Router } from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), session: vi.fn().mockResolvedValue(null) }));
vi.mock('../../db/connection', () => ({ default: { query: mocks.query, end: vi.fn() } }));
vi.mock('../../auth', () => ({ auth: { api: { getSession: mocks.session } } }));

afterEach(() => vi.unstubAllEnvs());

const cases: Array<{ name: string; module: string; exported: string; method: 'get'|'post'|'put'; path: string; max: number }> = [
  { name: 'publish read', module: '../publish', exported: 'default', method: 'get', path: '/works/one/publish-logs', max: 120 },
  { name: 'publish create', module: '../publish', exported: 'default', method: 'post', path: '/works/one/publish-logs', max: 120 },
  { name: 'publish update', module: '../publish', exported: 'default', method: 'put', path: '/publish-logs/one', max: 120 },
  { name: 'task create', module: '../tasks', exported: 'tasksRouter', method: 'post', path: '/', max: 120 },
  { name: 'task list', module: '../tasks', exported: 'tasksRouter', method: 'get', path: '/', max: 120 },
  { name: 'task detail', module: '../tasks', exported: 'tasksRouter', method: 'get', path: '/one', max: 120 },
  { name: 'operator patrol', module: '../operator-sessions', exported: 'operatorSessionsRouter', method: 'post', path: '/status', max: 60 },
  { name: 'collect SSE', module: '../acquisition', exported: 'acquisitionRouter', method: 'get', path: '/collect/not-a-uuid/sse', max: 120 },
];

for (const entry of cases) it(`${entry.name}: real limiter blocks before authentication/DB and ignores spoofed forwarding headers`, async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('ZENITHJOY_INTERNAL_TOKEN', 'ci-rate-limit-fixture-only');
  const module = await import(entry.module) as Record<string, Router>;
  const app = express().use(express.json()).use('/', module[entry.exported]);
  const call = (index: number) => request(app)[entry.method](entry.path)
    .set('X-Forwarded-For', `198.51.100.${index % 250 + 1}`).send({});
  for (let index=0; index<entry.max; index++) expect((await call(index)).status).toBe(401);
  const sessionsBefore = mocks.session.mock.calls.length;
  const blocked = await call(entry.max);
  expect(blocked.status).toBe(429);
  expect(blocked.body.error.code).toBe('RATE_LIMITED');
  expect(blocked.headers['retry-after']).toBeDefined();
  expect(mocks.session).toHaveBeenCalledTimes(sessionsBefore);
  expect(mocks.query).not.toHaveBeenCalled();
}, 15_000);

for (const token of [undefined, '', '  ']) for (const route of [
  { module: '../operator-sessions', exported: 'operatorSessionsRouter', path: '/status', body: {updates:[{platform:'douyin',status:'active'}]} },
  { module: '../agent-offline-scan', exported: 'default', path: '/', body: {} },
]) it(`${route.module}: missing or blank server token ${JSON.stringify(token)} refuses production writes`, async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({rows:[],rowCount:1});
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('ZENITHJOY_INTERNAL_TOKEN', token);
  const module = await import(route.module) as Record<string, Router>;
  const app = express().use(express.json()).use('/', module[route.exported]);
  const response = await request(app).post(route.path).send(route.body);
  expect(response.status).toBe(503);
  expect(response.body.error.code).toBe('INTERNAL_AUTH_UNAVAILABLE');
  expect(mocks.query).not.toHaveBeenCalled();
});

for (const header of ['Authorization', 'X-Internal-Token']) for (const route of [
  { module: '../operator-sessions', exported: 'operatorSessionsRouter', path: '/status', body: {updates:[{platform:'douyin',status:'active'}]} },
  { module: '../agent-offline-scan', exported: 'default', path: '/', body: {} },
]) it(`${route.module}: configured ${header} retains authenticated access`, async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({rows:[],rowCount:1});
  vi.stubEnv('ZENITHJOY_INTERNAL_TOKEN', 'ci-sensitive-route-fixture');
  const module = await import(route.module) as Record<string, Router>;
  const app = express().use(express.json()).use('/', module[route.exported]);
  const value = header==='Authorization' ? 'Bearer ci-sensitive-route-fixture' : 'ci-sensitive-route-fixture';
  const response = await request(app).post(route.path).set(header,value).send(route.body);
  expect(response.status).toBe(200);
  expect(mocks.query).toHaveBeenCalled();
});
