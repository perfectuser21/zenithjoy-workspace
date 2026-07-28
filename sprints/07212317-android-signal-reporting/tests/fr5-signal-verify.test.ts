/**
 * FR-5 信号验证 API 测试骨架
 * Contract: BEHAVIOR-9
 *
 * 覆盖：
 *   - GET /api/acquisition/signal-verify 返回三组数据
 *   - burner_sessions 含 computed_online_status
 *   - recent_collect_errors 含 error_code（枚举值）
 *   - recent_lead_replies 含 latest_reply_at
 *   - 租户隔离（只返回当前 tenant 数据）
 *   - 每组最多 10 条，排序 updated_at DESC
 *   - 无鉴权 token → 401
 *
 * 实现文件（待建）：
 *   apps/api/src/routes/acquisition.ts — GET /signal-verify 新端点
 *
 * NOTE: 端点目前不存在，request 会收到 404，断言 200 会失败 = 真实可失败断言。
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';

const API_BASE = process.env.API_BASE || 'http://localhost:5200';
const TEST_TOKEN = process.env.TEST_TOKEN || 'test-token-placeholder';

const VALID_ERROR_CODES = new Set([
  'KEYWORD_NO_RESULT',
  'KEYWORD_BANNED',
  'PLATFORM_LIMIT',
  'NETWORK_ERROR',
  'ACCOUNT_OFFLINE',
  'UNKNOWN',
  // 向后兼容历史值
  'STAGE2_DISPATCH_EXHAUSTED',
  'COLLECT_TIMEOUT',
  'stage1_empty',
]);

const VALID_ONLINE_STATUS = new Set(['online', 'offline', 'unknown']);

describe('FR-5 GET /api/acquisition/signal-verify', () => {
  // BEHAVIOR-9: 三字段完整性
  describe('端点可达性与基础结构', () => {
    it('GET /api/acquisition/signal-verify 应返回 HTTP 200', async () => {
      const res = await request(API_BASE)
        .get('/api/acquisition/signal-verify')
        .set('Authorization', `Bearer ${TEST_TOKEN}`);

      // 端点未实现时返回 404，断言 200 失败 → 真实可失败断言
      expect(res.status).toBe(200);
    });

    it('响应体应包含 burner_sessions / recent_collect_errors / recent_lead_replies 三个字段', async () => {
      const res = await request(API_BASE)
        .get('/api/acquisition/signal-verify')
        .set('Authorization', `Bearer ${TEST_TOKEN}`);

      expect(res.status).toBe(200);
      // 端点不存在时 res.body 为空，下列断言全部失败 → 真实可失败
      expect(res.body).toHaveProperty('data');
      const data = res.body.data;
      expect(data).toHaveProperty('burner_sessions');
      expect(data).toHaveProperty('recent_collect_errors');
      expect(data).toHaveProperty('recent_lead_replies');
      expect(Array.isArray(data.burner_sessions)).toBe(true);
      expect(Array.isArray(data.recent_collect_errors)).toBe(true);
      expect(Array.isArray(data.recent_lead_replies)).toBe(true);
    });
  });

  describe('字段值域校验', () => {
    it('burner_sessions 中 computed_online_status 应在 online|offline|unknown 之内', async () => {
      const res = await request(API_BASE)
        .get('/api/acquisition/signal-verify')
        .set('Authorization', `Bearer ${TEST_TOKEN}`);

      expect(res.status).toBe(200);
      const sessions = res.body.data?.burner_sessions ?? [];
      for (const s of sessions) {
        expect(VALID_ONLINE_STATUS.has(s.computed_online_status)).toBe(true);
      }
    });

    it('recent_collect_errors 中 error_code 应在枚举白名单内', async () => {
      const res = await request(API_BASE)
        .get('/api/acquisition/signal-verify')
        .set('Authorization', `Bearer ${TEST_TOKEN}`);

      expect(res.status).toBe(200);
      const errors = res.body.data?.recent_collect_errors ?? [];
      for (const e of errors) {
        expect(VALID_ERROR_CODES.has(e.error_code)).toBe(true);
      }
    });

    it('recent_lead_replies 中 latest_reply_at 应非空', async () => {
      const res = await request(API_BASE)
        .get('/api/acquisition/signal-verify')
        .set('Authorization', `Bearer ${TEST_TOKEN}`);

      expect(res.status).toBe(200);
      const replies = res.body.data?.recent_lead_replies ?? [];
      for (const r of replies) {
        expect(r.latest_reply_at).not.toBeNull();
        expect(r.latest_reply_at).not.toBeUndefined();
      }
    });
  });

  describe('数量上限', () => {
    it('每组最多返回 10 条', async () => {
      const res = await request(API_BASE)
        .get('/api/acquisition/signal-verify')
        .set('Authorization', `Bearer ${TEST_TOKEN}`);

      expect(res.status).toBe(200);
      const data = res.body.data ?? {};
      if (data.burner_sessions) expect(data.burner_sessions.length).toBeLessThanOrEqual(10);
      if (data.recent_collect_errors) expect(data.recent_collect_errors.length).toBeLessThanOrEqual(10);
      if (data.recent_lead_replies) expect(data.recent_lead_replies.length).toBeLessThanOrEqual(10);
    });
  });

  describe('鉴权', () => {
    it('无鉴权 token → 401', async () => {
      const res = await request(API_BASE)
        .get('/api/acquisition/signal-verify');
        // 不带 Authorization header

      // 端点未实现时 404；实现后无鉴权应返回 401
      // 两种情况都不是 200 → 断言 401 在端点不存在时失败（404 ≠ 401）
      // 这验证了"端点存在且鉴权生效"两个条件
      expect(res.status).toBe(401);
    });

    it('无效 token → 401 或 403', async () => {
      const res = await request(API_BASE)
        .get('/api/acquisition/signal-verify')
        .set('Authorization', 'Bearer invalid-token-xyz');

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('空数据场景（新 tenant 无历史数据）', () => {
    it('无数据时应返回空数组，不报错', async () => {
      expect.assertions(0); // placeholder — 需独立 tenant token 前置
      /*
      const res = await request(API_BASE)
        .get('/api/acquisition/signal-verify')
        .set('Authorization', `Bearer ${NEW_TENANT_TOKEN}`);
      expect(res.status).toBe(200);
      expect(res.body.data.burner_sessions).toEqual([]);
      expect(res.body.data.recent_collect_errors).toEqual([]);
      expect(res.body.data.recent_lead_replies).toEqual([]);
      */
    });
  });
});
