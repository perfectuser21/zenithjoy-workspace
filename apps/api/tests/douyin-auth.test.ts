import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';

// axios.post 调用抖音 OAuth 外部接口 — mock 掉
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

import axios from 'axios';
const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;

describe('Douyin Auth Callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DOUYIN_CLIENT_KEY', 'test-client-key');
    vi.stubEnv('DOUYIN_CLIENT_SECRET', 'test-client-secret');
  });

  describe('GET /api/douyin-auth/callback', () => {
    it('returns 400 HTML when code param is missing', async () => {
      const res = await request(app).get('/api/douyin-auth/callback');
      expect(res.status).toBe(400);
      expect(res.text).toContain('缺少 code');
    });

    it('returns success HTML when OAuth exchange succeeds', async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: {
          data: {
            access_token: 'act_token_abc123',
            open_id: 'open_id_xyz',
            scope: 'user_info',
          },
        },
      });
      const res = await request(app).get('/api/douyin-auth/callback?code=valid-code-123');
      expect(res.status).toBe(200);
      expect(res.text).toContain('授权成功');
    });

    it('returns failure HTML when OAuth exchange returns no access_token', async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: { data: { error_code: 10010, description: 'invalid code' } },
      });
      const res = await request(app).get('/api/douyin-auth/callback?code=bad-code');
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/失败|错误|error/i);
    });

    it('returns error HTML when axios throws', async () => {
      mockAxiosPost.mockRejectedValueOnce(new Error('network error'));
      const res = await request(app).get('/api/douyin-auth/callback?code=code-that-throws');
      expect(res.status).toBe(500);
    });

    it('passes correct params to Douyin OAuth endpoint', async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: { data: { access_token: 'tok', open_id: 'oid', scope: 's' } },
      });
      await request(app).get('/api/douyin-auth/callback?code=test-code-abc');
      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.stringContaining('douyin.com'),
        null,
        expect.objectContaining({
          params: expect.objectContaining({ code: 'test-code-abc' }),
        })
      );
    });
  });
});
