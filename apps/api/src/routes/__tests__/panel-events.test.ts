/* eslint-disable @typescript-eslint/no-explicit-any -- 测试注入 mock */
/**
 * 同目录单测（CI lint-test-pairing 配对）— /api/panel/events 路由契约。
 *
 * 作战窗刀1薄写入端点：mock service 层，只验路由层——
 * 租户解析(X-Tenant-Id)、缺租户 400、字段校验、事件类型校验、成功回显。
 * PrepPRD: sprints/07280929-agent-panel-knife1/prep-prd.md
 */
import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../services/panel/panel-events-service', () => ({
  writePanelEvent: vi.fn(),
}));

import { writePanelEvent } from '../../services/panel/panel-events-service';
import { panelEventsRouter } from '../panel-events';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/panel', panelEventsRouter);
  return app;
}

const app = makeApp();

beforeEach(() => vi.clearAllMocks());

const VALID_BODY = {
  event: 'task_started',
  task_id: 't1',
  line: 'line04',
  device: 'xian-pc',
  title: '回复客户张三',
};

describe('POST /api/panel/events', () => {
  it('缺 X-Tenant-Id → 400 MISSING_TENANT，不调 service', async () => {
    const r = await request(app).post('/api/panel/events').send(VALID_BODY);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('MISSING_TENANT');
    expect(writePanelEvent).not.toHaveBeenCalled();
  });

  it('缺必填字段(event/task_id/line/device/title) → 400 MISSING_FIELDS', async () => {
    const r = await request(app)
      .post('/api/panel/events')
      .set('X-Tenant-Id', 'tenantA')
      .send({ event: 'task_started', task_id: 't1' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('MISSING_FIELDS');
  });

  it('event 不是合法的 6 种类型之一 → 400 INVALID_EVENT', async () => {
    const r = await request(app)
      .post('/api/panel/events')
      .set('X-Tenant-Id', 'tenantA')
      .send({ ...VALID_BODY, event: 'bogus' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('INVALID_EVENT');
  });

  it('正常写入 → 200 ok，透传 tenant_id 给 service', async () => {
    (writePanelEvent as any).mockResolvedValue({ id: 'row-1' });
    const r = await request(app)
      .post('/api/panel/events')
      .set('X-Tenant-Id', 'tenantA')
      .send(VALID_BODY);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, id: 'row-1' });
    expect(writePanelEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenantA', event: 'task_started', taskId: 't1' }),
    );
  });

  it('service 抛异常 → 500 INTERNAL，不泄漏堆栈给客户端', async () => {
    (writePanelEvent as any).mockRejectedValue(new Error('db down'));
    const r = await request(app)
      .post('/api/panel/events')
      .set('X-Tenant-Id', 'tenantA')
      .send(VALID_BODY);
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('INTERNAL');
  });

  it('detail/progress/severity 是可选字段，不给也能正常写入', async () => {
    (writePanelEvent as any).mockResolvedValue({ id: 'row-2' });
    const r = await request(app)
      .post('/api/panel/events')
      .set('X-Tenant-Id', 'tenantA')
      .send(VALID_BODY);
    expect(r.status).toBe(200);
  });
});
