/**
 * regression(2026-06-30): POST /api/agent/burner/sessions/invalidate
 * Agent 检测到 Douyin session 过期时调此端点，把 burner session 标记为 needs_rebind
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// mock DB pool
const mockQuery = vi.fn();
vi.mock('../db/connection', () => ({ default: { query: mockQuery } }));

// mock agentContext middleware
vi.mock('../middleware/agent-context', () => ({
  agentContext: (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
    (req as import('express').Request & { agentId?: string | null }).agentId = (req.headers['x-agent-id'] as string) || null;
    next();
  },
}));

const { default: burnerRouter } = await import('./agent-burner');
const app = express();
app.use(express.json());
app.use('/api/agent/burner', burnerRouter);

describe('POST /api/agent/burner/sessions/invalidate', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('成功标记 active burner session 为 needs_rebind', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ account_label: 'medical-burner' }] });

    const res = await request(app)
      .post('/api/agent/burner/sessions/invalidate')
      .set('x-agent-id', 'agent-123')
      .send({ reason: 'DOUYIN_SESSION_EXPIRED' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.invalidated).toBe(1);
    expect(res.body.data.reason).toBe('DOUYIN_SESSION_EXPIRED');

    // 验证 SQL 正确 UPDATE 了 status
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'needs_rebind'"),
      ['agent-123'],
    );
  });

  it('缺 agent 上下文时返回 401', async () => {
    const res = await request(app)
      .post('/api/agent/burner/sessions/invalidate')
      .send({ reason: 'DOUYIN_SESSION_EXPIRED' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NO_AGENT');
  });
});
