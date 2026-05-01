import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';

// Mock agent-registry and license.service — agent routes depend on both
vi.mock('../src/services/agent-registry', () => ({
  agentRegistry: {
    list: vi.fn(() => []),
    pickFor: vi.fn(() => null),
  },
}));

vi.mock('../src/services/license.service', () => ({
  registerAgent: vi.fn(),
  isValidLicenseKeyFormat: vi.fn((key: string) => /^ZJ-[A-Z]+-[A-Z0-9]+$/.test(key)),
}));

vi.mock('../src/services/agent-ws', () => ({
  sendToAgent: vi.fn(() => false),
}));

import { agentRegistry } from '../src/services/agent-registry';
import { registerAgent } from '../src/services/license.service';
import { sendToAgent } from '../src/services/agent-ws';

const mockRegistry = agentRegistry as any;
const mockRegisterAgent = registerAgent as ReturnType<typeof vi.fn>;
const mockSendToAgent = sendToAgent as ReturnType<typeof vi.fn>;

describe('Agent API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/agent/register', () => {
    it('returns 400 for invalid license_key format', async () => {
      const res = await request(app)
        .post('/api/agent/register')
        .send({ license_key: 'INVALID', machine_id: 'machine-001' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('returns 400 for machine_id too short', async () => {
      const res = await request(app)
        .post('/api/agent/register')
        .send({ license_key: 'ZJ-PRO-ABCD1234', machine_id: 'ab' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('returns 200 with ws_token on valid registration', async () => {
      mockRegisterAgent.mockResolvedValueOnce({
        ok: true,
        license_id: 'lic-uuid-1',
        tier: 'pro',
        max_machines: 5,
        registered_machine_id: 'machine-001',
        ws_token: 'ws-tok-abc123',
      });
      const res = await request(app)
        .post('/api/agent/register')
        .send({ license_key: 'ZJ-PRO-ABCD1234', machine_id: 'machine-001' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.ws_token).toBeDefined();
    });

    it('returns 401 for invalid license', async () => {
      mockRegisterAgent.mockResolvedValueOnce({ ok: false, code: 'INVALID_LICENSE' });
      const res = await request(app)
        .post('/api/agent/register')
        .send({ license_key: 'ZJ-PRO-BADKEY00', machine_id: 'machine-001' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_LICENSE');
    });

    it('returns 403 for quota exceeded', async () => {
      mockRegisterAgent.mockResolvedValueOnce({ ok: false, code: 'QUOTA_EXCEEDED' });
      const res = await request(app)
        .post('/api/agent/register')
        .send({ license_key: 'ZJ-PRO-QUOTA000', machine_id: 'machine-001' });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/agent/status', () => {
    it('returns empty agents list when no agents connected', async () => {
      mockRegistry.list.mockReturnValueOnce([]);
      const res = await request(app).get('/api/agent/status');
      expect(res.status).toBe(200);
      expect(res.body.agents).toEqual([]);
    });

    it('returns agent list with online status', async () => {
      mockRegistry.list.mockReturnValueOnce([{
        agentId: 'agent-001',
        meta: { capabilities: ['wechat'], version: '1.0.0' },
        connectedAt: Date.now() - 5000,
        lastHeartbeat: Date.now() - 1000,
        busy: false,
      }]);
      const res = await request(app).get('/api/agent/status');
      expect(res.status).toBe(200);
      expect(res.body.agents).toHaveLength(1);
      expect(res.body.agents[0].online).toBe(true);
    });
  });

  describe('POST /api/agent/test-publish', () => {
    it('returns 503 when no agent available', async () => {
      mockRegistry.pickFor.mockReturnValueOnce(null);
      const res = await request(app).post('/api/agent/test-publish').send({});
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('no agent online');
    });

    it('dispatches publish request when agent available', async () => {
      mockRegistry.pickFor.mockReturnValueOnce({ agentId: 'agent-001' });
      mockSendToAgent.mockReturnValueOnce(true);
      const res = await request(app).post('/api/agent/test-publish').send({});
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.taskId).toBeDefined();
    });
  });
});
