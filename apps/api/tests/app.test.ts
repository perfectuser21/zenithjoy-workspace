/**
 * app.ts 入口测试 — 仅冒烟（health + 关键路由挂载）
 *
 * 触发原因：v1.2 license PR 在 app.ts 加了 adminLicenseRouter 挂载，
 * lint-test-pairing 要求 src 文件配套测试。这里只做冒烟，业务测试在路由测试文件里。
 */

import request from 'supertest';
import { vi, describe, it, expect } from 'vitest';
import app from '../src/app';
import { registerRealProvidersFromEnv } from '../src/services/payment/provider-registry';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn(), connect: vi.fn() },
}));

describe('app.ts entry', () => {
  it('GET /health 返回 ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /health 携带 payment.providerInitErrors 字段（C-1，不改变既有字段）', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    // 既有字段保持不变
    expect(res.body.status).toBe('ok');
    expect(res.body.config).toHaveProperty('ok');
    expect(res.body.config).toHaveProperty('missing');
    expect(res.body.build).toBeDefined();
    // 新字段
    expect(Array.isArray(res.body.payment?.providerInitErrors)).toBe(true);
  });

  it('GET /health、/api/health 在支付 provider 初始化失败时绝不透传文件系统路径（N-1：该端点无鉴权）', async () => {
    const FAKE_PATH = '/etc/zenithjoy/certs/wx-apiclient-key.pem';
    const WECHAT_ENV_KEYS = [
      'WX_PAY_MCHID', 'WX_PAY_SERIAL_NO', 'WX_PAY_V3_KEY',
      'WX_PAY_PRIVATE_KEY_PATH', 'WX_PAY_PLATFORM_CERT_PATH',
      'WX_PAY_APPID', 'PAYMENT_NOTIFY_BASE_URL',
    ];
    const saved: Record<string, string | undefined> = {};
    for (const k of WECHAT_ENV_KEYS) saved[k] = process.env[k];

    process.env.WX_PAY_MCHID = '1234567890';
    process.env.WX_PAY_SERIAL_NO = 'ABC123';
    process.env.WX_PAY_V3_KEY = '0123456789abcdef0123456789abcdef';
    process.env.WX_PAY_PRIVATE_KEY_PATH = FAKE_PATH; // 文件不存在 → ENOENT，触发 fail-open 分支
    process.env.WX_PAY_PLATFORM_CERT_PATH = '/etc/zenithjoy/certs/wx-platform-cert.json';
    process.env.WX_PAY_APPID = 'wxtestappid';
    process.env.PAYMENT_NOTIFY_BASE_URL = 'https://example.com';

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      registerRealProvidersFromEnv();

      for (const path of ['/health', '/api/health']) {
        const res = await request(app).get(path);
        expect(res.status).toBe(200);

        const serialized = JSON.stringify(res.body);
        expect(serialized).not.toContain(FAKE_PATH);
        expect(serialized).not.toContain('.pem');
        expect(serialized).not.toContain('/etc/');

        // 信号仍需响亮可见：provider 名 + 错误类型必须能看到，否则退化成聋子健康检查
        const errors = res.body.payment?.providerInitErrors;
        expect(errors).toHaveLength(1);
        expect(errors[0].provider).toBe('wechat');
        expect(typeof errors[0].errorType).toBe('string');
        expect(errors[0].errorType.length).toBeGreaterThan(0);
      }
    } finally {
      errSpy.mockRestore();
      for (const k of WECHAT_ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      registerRealProvidersFromEnv(); // 复位共享单例状态，避免污染后续测试
    }
  });

  it('未挂载路径返回 404', async () => {
    const res = await request(app).get('/api/this-route-does-not-exist');
    expect(res.status).toBe(404);
  });

  it('/api/admin/license 路由已挂载（不会 404）', async () => {
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
    // 不带 body，期望被路由 handler 接管返回 400 INVALID_TIER（而不是 404）
    const res = await request(app).post('/api/admin/license').send({});
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_TIER');
  });

  it('/api/agent/register 路由已挂载', async () => {
    const res = await request(app).post('/api/agent/register').send({});
    // 缺 license_key → BAD_REQUEST 400（不是 404）
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });
});
