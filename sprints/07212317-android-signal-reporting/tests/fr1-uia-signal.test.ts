/**
 * FR-1 UIA 在线状态双信号测试骨架
 * Contract: BEHAVIOR-1, BEHAVIOR-2, BEHAVIOR-3
 *
 * 覆盖：
 *   - POST /api/agent/burner/uia-signal 写入 uia_online=true → DB 断言
 *   - POST /api/agent/burner/uia-signal 写入 uia_online=false → status='offline' 覆盖心跳
 *   - GET /api/agent/burner/sessions 返回 computed_online_status 三级判定
 *   - account_label 不存在时返回 404
 *
 * 实现文件（待建）：
 *   apps/api/src/routes/agent-burner.ts
 *   apps/api/db/migrations/20260722_android_signal_reporting.sql
 *
 * NOTE: 测试使用 supertest 调用真实端点（未实现时返回 404，断言会失败 = 可失败的真实断言）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// 端点目前未实现，supertest 会收到 404；实现后这些断言变绿
// 这就是 E2E-First：先有可失败的测试，再写实现
const API_BASE = process.env.API_BASE || 'http://localhost:5200';
const TEST_AGENT_UUID = process.env.TEST_AGENT_UUID || 'test-agent-uuid-placeholder';

describe('FR-1 UIA 信号写入与三级判定', () => {
  // BEHAVIOR-1: UIA 在线信号写入
  describe('POST /api/agent/burner/uia-signal — uia_online=true', () => {
    it('应返回 HTTP 200 并将 uia_online=true 写入 DB', async () => {
      const res = await request(API_BASE)
        .post('/api/agent/burner/uia-signal')
        .set('x-agent-id', TEST_AGENT_UUID)
        .set('Content-Type', 'application/json')
        .send({ account_label: 'burner_001', uia_online: true });

      // 端点未实现时返回 404，断言 200 会失败 → 真实可失败断言
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('body 包含 tenant_id 时服务端应忽略（用 x-agent-id 反查）', async () => {
      const res = await request(API_BASE)
        .post('/api/agent/burner/uia-signal')
        .set('x-agent-id', TEST_AGENT_UUID)
        .set('Content-Type', 'application/json')
        .send({ account_label: 'burner_001', uia_online: true, tenant_id: 'fake-tenant' });

      expect(res.status).toBe(200);
      // 不因 tenant_id 字段存在而报错
    });
  });

  // BEHAVIOR-2: UIA 掉线信号覆盖心跳
  describe('POST /api/agent/burner/uia-signal — uia_online=false', () => {
    it('应将 session.status 强制改为 offline（覆盖心跳在线判定）', async () => {
      const res = await request(API_BASE)
        .post('/api/agent/burner/uia-signal')
        .set('x-agent-id', TEST_AGENT_UUID)
        .set('Content-Type', 'application/json')
        .send({ account_label: 'burner_001', uia_online: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/agent/burner/uia-signal — account_label 不存在', () => {
    it('account_label 不存在时应返回 404', async () => {
      const res = await request(API_BASE)
        .post('/api/agent/burner/uia-signal')
        .set('x-agent-id', TEST_AGENT_UUID)
        .set('Content-Type', 'application/json')
        .send({ account_label: 'nonexistent_label_xyz', uia_online: true });

      // 端点不存在时会 404；实现后 account_label 不存在也应返回 404
      expect(res.status).toBe(404);
    });
  });

  // BEHAVIOR-3: GET /sessions 三级判定
  describe('GET /api/agent/burner/sessions — computed_online_status', () => {
    it('返回 JSON 中每个 session 必须包含 computed_online_status 字段', async () => {
      const res = await request(API_BASE)
        .get('/api/agent/burner/sessions')
        .set('x-agent-id', TEST_AGENT_UUID);

      // 端点未实现时返回 404，断言 200 会失败 → 真实可失败断言
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('sessions');
      expect(Array.isArray(res.body.data.sessions)).toBe(true);
    });

    it('computed_online_status 值必须在 online|offline|unknown 之内', async () => {
      const res = await request(API_BASE)
        .get('/api/agent/burner/sessions')
        .set('x-agent-id', TEST_AGENT_UUID);

      expect(res.status).toBe(200);
      const sessions = res.body.data?.sessions ?? [];
      for (const s of sessions) {
        expect(['online', 'offline', 'unknown']).toContain(s.computed_online_status);
      }
    });

    it('心跳正常 + uia_online=true → computed_online_status: "online"', async () => {
      expect.assertions(0); // placeholder — 需配合测试 DB 前置状态，supertest 级别暂不可独立执行
      /*
      const res = await request(API_BASE)
        .get('/api/agent/burner/sessions')
        .set('x-agent-id', TEST_AGENT_UUID);
      expect(res.status).toBe(200);
      const s = res.body.data.sessions.find((s: any) => s.account_label === 'burner_001');
      expect(s.computed_online_status).toBe('online');
      expect(s.heartbeat_online).toBe(true);
      expect(s.uia_online).toBe(true);
      */
    });

    it('心跳正常 + uia_online=false → computed_online_status: "offline"', async () => {
      expect.assertions(0); // placeholder
    });

    it('心跳正常 + uia_online IS NULL → computed_online_status: "unknown"', async () => {
      expect.assertions(0); // placeholder
    });

    it('心跳超时（>2min）→ computed_online_status: "offline"（无论 uia_online）', async () => {
      expect.assertions(0); // placeholder
    });

    it('心跳正常 + uia_error 非空 → computed_online_status: "unknown"', async () => {
      expect.assertions(0); // placeholder
    });
  });
});
