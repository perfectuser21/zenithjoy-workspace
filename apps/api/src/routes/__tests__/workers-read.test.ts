/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../../services/worker-tasks-service', () => ({ listWorkers: vi.fn(), getActivity: vi.fn(), agentBelongsToTenant: vi.fn() }));
vi.mock('../../services/worker-live', () => ({
  workerLive: {
    latest: vi.fn(() => ({ seq: 1, at: Date.now(), bytes: Buffer.from('JPEG1') })),
    subscribe: vi.fn(),
  },
}));
vi.mock('../../services/worker-shots', () => ({ shotPath: vi.fn((ref: string) => {
  if (ref === 't/a/1.jpg') return '/tmp/x.jpg';
  // 刻意指向一个不存在的文件，用来触发 createReadStream 的 error 事件（流错误兜底路径）
  if (ref === 't/a/missing.jpg') return '/tmp/zenithjoy-worker-shots-test-missing-file.jpg';
  return null;
}) }));
vi.mock('../../middleware/tenant-context', () => ({
  tenantContextOptional: (req: any, _res: any, next: any) => { req.tenantId = req.headers['x-tenant-id'] || ''; next(); },
}));
import { listWorkers, getActivity, agentBelongsToTenant } from '../../services/worker-tasks-service';
import { workerLive } from '../../services/worker-live';
import { workersReadRouter } from '../workers-read';
function makeApp() { const app = express(); app.use('/api/workers', workersReadRouter); return app; }
const app = makeApp();
beforeEach(() => vi.clearAllMocks());

describe('GET /api/workers', () => {
  it('缺租户 → 401', async () => { const r = await request(app).get('/api/workers'); expect(r.status).toBe(401); });
  it('返回卡片数据（os_type/status/running 摘要/completed_today）', async () => {
    (listWorkers as any).mockResolvedValue([{ id: 'a1', agent_id: 'ag', hostname: 'MAA-AN00', nickname: null, machine_role: 'main', os_type: 'android',
      owner_type: 'customer', version: '2.1', last_seen: new Date().toISOString(), status: 'online',
      running_task_id: 't1', running_title: '发布', current_step: 3, steps_total: 10, completed_today: '2' }]);
    const r = await request(app).get('/api/workers').set('X-Tenant-Id', 'tenant-a');
    expect(r.status).toBe(200);
    const w = r.body.data[0];
    expect(w.os_type).toBe('android'); expect(w.status).toBe('online');
    expect(w.running).toEqual({ task_id: 't1', title: '发布', current_step: 3, steps_total: 10 });
    expect(w.completed_today).toBe(2);
  });
});
describe('GET /api/workers/:agentId/activity', () => {
  it('跨租户/不存在 → 404', async () => {
    (getActivity as any).mockResolvedValue(null);
    const r = await request(app).get('/api/workers/a9/activity').set('X-Tenant-Id', 'tenant-b'); expect(r.status).toBe(404);
  });
  it('screenshot_ref 转成可访问 URL', async () => {
    (getActivity as any).mockResolvedValue({
      current: { id: 't1', title: '发布', status: 'running', steps_total: 2, current_step: 1, started_at: 'x', lease_until: 'y', executor_id: 'ex' },
      steps: [{ step_index: 0, title: '打开抖音', status: 'done', screenshot_ref: 't/a/1.jpg' }], history: [] });
    const r = await request(app).get('/api/workers/a1/activity').set('X-Tenant-Id', 'tenant-a');
    expect(r.status).toBe(200); expect(r.body.data.steps[0].screenshot_url).toBe('/api/workers/shots/t/a/1.jpg');
  });
});
describe('GET /api/workers/:agentId/live', () => {
  it('跨租户 → 404', async () => {
    (agentBelongsToTenant as any).mockResolvedValue(false);
    const r = await request(app).get('/api/workers/a1/live').set('X-Tenant-Id', 'tenant-b'); expect(r.status).toBe(404);
  });
  it('multipart/x-mixed-replace 且首帧立即输出', async () => {
    (agentBelongsToTenant as any).mockResolvedValue(true);
    (workerLive.subscribe as any).mockReturnValue(vi.fn());
    const r = await request(app).get('/api/workers/a1/live').set('X-Tenant-Id', 'tenant-a')
      .buffer(true).parse((res, cb) => { let d = ''; res.on('data', (c: Buffer) => { d += c.toString('latin1'); if (d.includes('JPEG1')) { res.destroy(); cb(null, d); } }); });
    expect(r.headers['content-type']).toMatch(/multipart\/x-mixed-replace; boundary=frame/);
    expect(r.body).toContain('Content-Type: image/jpeg'); expect(r.body).toContain('JPEG1');
  });
  it('客户端断连后 unsubscribe(off) 被调用（req/res close 退订）', async () => {
    (agentBelongsToTenant as any).mockResolvedValue(true);
    const off = vi.fn();
    (workerLive.subscribe as any).mockReturnValue(off);
    await request(app).get('/api/workers/a1/live').set('X-Tenant-Id', 'tenant-a')
      .buffer(true).parse((res, cb) => { let d = ''; res.on('data', (c: Buffer) => { d += c.toString('latin1'); if (d.includes('JPEG1')) { res.destroy(); cb(null, d); } }); });
    // 服务端 req/res 的 'close' 事件是异步触发的，给事件循环一个 tick
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(off).toHaveBeenCalled();
  });
});
describe('GET /api/workers/shots/:ref', () => {
  it('非法 ref → 400/404', async () => {
    const r = await request(app).get('/api/workers/shots/..%2F..%2Fetc%2Fpasswd').set('X-Tenant-Id', 'tenant-a'); expect([400, 404]).toContain(r.status);
  });
  it('ref 租户前缀不匹配 → 404', async () => {
    const r = await request(app).get('/api/workers/shots/t/a/1.jpg').set('X-Tenant-Id', 'other'); expect(r.status).toBe(404);
  });
  it('shotPath 合法但文件不存在 → 404（createReadStream error 兜底，不再靠 existsSync 预判）', async () => {
    const r = await request(app).get('/api/workers/shots/t/a/missing.jpg').set('X-Tenant-Id', 't');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, error: 'NOT_FOUND', message: '截图不存在' });
  });
});
