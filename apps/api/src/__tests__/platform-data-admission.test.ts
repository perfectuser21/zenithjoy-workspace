/** Actual production Express app, not a standalone router or copied platform constant. */
import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import request from 'supertest';
import { listenLoopback, closeLoopback } from '../../tests/helpers/loopback-server';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db/connection', () => ({ default: { query, connect: vi.fn(), end: vi.fn() } }));
import app from '../app';
let server: Server;
beforeAll(async () => { server = await listenLoopback(app); });
afterAll(async () => { await closeLoopback(server); });
beforeEach(() => query.mockReset());
it('current PlatformDataPage snapshots URL reaches the actual app and database boundary', async () => {
  query.mockResolvedValueOnce({ rows: [{ title: 'fixture' }], rowCount: 1 });
  const response = await request(server).get('/api/snapshots/douyin');
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ success: true, platform: 'douyin', count: 1, data: [{ title: 'fixture' }] });
  expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM zenithjoy.daily_snapshots'), ['douyin', 50]);
});
it('legacy raw-data endpoint is not silently opened on the current API app', async () => {
  expect((await request(server).get('/api/media/platform-data/douyin')).status).toBe(404);
  expect(query).not.toHaveBeenCalled();
});
