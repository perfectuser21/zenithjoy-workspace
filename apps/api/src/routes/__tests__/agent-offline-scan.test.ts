/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock scanAndAlert，避免真实 DB/Webhook 调用
vi.mock('../../services/agent-offline-monitor', () => ({
  scanAndAlert: vi.fn(),
}));

import request from 'supertest';
import * as monitorSvc from '../../services/agent-offline-monitor';

describe('POST /api/internal/agent-offline-scan', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = (await import('../../app')).default;
  });

  it('扫描无告警 → 返回 200 success=true + scanned/alerted/recovered', async () => {
    (monitorSvc.scanAndAlert as any).mockResolvedValue({
      scanned: 3,
      alerted: 0,
      recovered: 0,
    });

    const res = await request(app).post('/api/internal/agent-offline-scan').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ scanned: 3, alerted: 0, recovered: 0 });
    expect(res.body.timestamp).toBeDefined();
  });

  it('send_errors 非空 → 返回 200 但 success=false（INV-01 proven-to-fire）', async () => {
    (monitorSvc.scanAndAlert as any).mockResolvedValue({
      scanned: 2,
      alerted: 1,
      recovered: 0,
      send_errors: ['webhook timeout'],
    });

    const res = await request(app).post('/api/internal/agent-offline-scan').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('webhook');
    expect(res.body.data.send_errors).toHaveLength(1);
  });

  it('scanAndAlert 抛出异常 → 返回 500 success=false', async () => {
    (monitorSvc.scanAndAlert as any).mockRejectedValue(new Error('DB 连接失败'));

    const res = await request(app).post('/api/internal/agent-offline-scan').send({});
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('DB 连接失败');
  });

  it('threshold_hours body 参数透传给 scanAndAlert', async () => {
    (monitorSvc.scanAndAlert as any).mockResolvedValue({
      scanned: 0,
      alerted: 0,
      recovered: 0,
    });

    await request(app)
      .post('/api/internal/agent-offline-scan')
      .send({ threshold_hours: 2 });

    expect(monitorSvc.scanAndAlert).toHaveBeenCalledWith(
      expect.objectContaining({ thresholdHours: 2 })
    );
  });
});
