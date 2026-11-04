import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/db/connection', () => ({ default: { query: db.query, end: vi.fn() } }));
vi.mock('../../src/auth', () => ({ auth: { api: { getSession: vi.fn().mockResolvedValue(null) } } }));
import app from '../../src/app';
beforeEach(() => { db.query.mockReset().mockResolvedValue({ rows: [{ id: 'old-local-row' }] }); vi.stubEnv('ZENITHJOY_INTERNAL_TOKEN', 'isolated-brain-contract'); });
afterEach(() => vi.unstubAllEnvs());
it.each([
  ['post', '/api/brain/sprint-state', { journey_id: 'old-local', sprint_id: 'old-local', snapshot: {} }],
  ['post', '/api/brain/journey-steps', { journey_id: 'old-local', step_id: 'old-local', step_order: 1, status: 'done' }],
  ['get', '/api/brain/journey-steps?journey_id=old-local', {}],
] as const)('local compatibility %s %s is retired without touching stored rows', async (method, path, body) => {
  const response = await request(app)[method](path).set('X-Internal-Token', 'isolated-brain-contract').send(body);
  expect(response.status).toBe(404); expect(db.query).not.toHaveBeenCalled();
});
it('production and staging Brain URLs continue to target the separate central Brain service', () => {
  for (const filename of ['nginx.conf', 'nginx.staging.conf']) {
    const config = readFileSync(`../../deploy/${filename}`, 'utf8').replace(/#.*$/gm, '');
    expect(config).toMatch(/location\s+\/api\/brain\/\s*\{\s*proxy_pass\s+http:\/\/[^;]+:5221\/api\/brain\//);
  }
});
