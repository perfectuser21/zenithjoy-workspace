import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVideoToolsRouter } from '../video-tools';

vi.mock('../../auth', () => ({ auth: { api: { getSession: async () => null } } }));
const projectId = '11111111-1111-4111-8111-111111111111';
const segmentId = '22222222-2222-4222-8222-222222222222';
const token = 'only-this-test-instance-token-1234567890';
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'comfy-project-permission-'));
  vi.stubEnv('CREATIVE_CANVAS_SERVICE_TOKENS', JSON.stringify({ alice: token }));
  vi.stubEnv('CREATIVE_CANVAS_INSTANCES', JSON.stringify({ alice: 'http://alice-canvas:8188' }));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
function app() { const value = express(); value.use(express.json()); value.use('/tools', createVideoToolsRouter({ directory })); return value; }
describe('Comfy原生项目节点的受限实例权限', () => {
  it('只开放原生节点所需项目动作，所有记录仍按绑定员工隔离', async () => {
    const server = app();
    expect((await request(server).post('/tools/projects').set('X-Creative-Instance-Token', token).send({ sourceAssetId: 'invalid' })).status).toBe(400);
    for (const path of [`/projects/${projectId}`, `/projects/${projectId}/download`]) {
      expect((await request(server).get('/tools' + path).set('X-Creative-Instance-Token', token)).status).toBe(404);
    }
    expect((await request(server).patch(`/tools/projects/${projectId}`).set('X-Creative-Instance-Token', token).send({ confirmed: true })).status).toBe(404);
    expect((await request(server).patch(`/tools/projects/${projectId}/segments/${segmentId}`).set('X-Creative-Instance-Token', token).send({ expectedRevision: 0 })).status).toBe(404);
    for (const action of ['split', 'assemble']) expect((await request(server).post(`/tools/projects/${projectId}/${action}`).set('X-Creative-Instance-Token', token).send({})).status).toBe(404);
  });
  it('拒绝错误令牌、目录枚举、素材上传及不支持的方法', async () => {
    const server = app();
    expect((await request(server).get(`/tools/projects/${projectId}`).set('X-Creative-Instance-Token', 'wrong')).status).toBe(401);
    for (const path of ['/projects', '/config', '/uploads/presign', '/projects/invalid']) expect((await request(server).get('/tools' + path).set('X-Creative-Instance-Token', token)).status).toBe(403);
    expect((await request(server).delete(`/tools/projects/${projectId}`).set('X-Creative-Instance-Token', token)).status).toBe(403);
    expect((await request(server).post('/tools/uploads').set('X-Creative-Instance-Token', token).send({})).status).toBe(403);
  });
});
