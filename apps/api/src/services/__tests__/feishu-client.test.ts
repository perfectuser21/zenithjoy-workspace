/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 飞书轻客户端契约。刀5b Task2——feishu-orchestrator worker 专用（与 feishu-token.ts
 * 的多租户 OAuth 路线隔离，这里走全局 env FEISHU_APP_ID/SECRET 单租户路线）。
 *
 * 最重要的两条：
 *  1. token 模块级缓存——同一批请求不重复换 token；expire 前 5min（REFRESH_THRESHOLD_MS）
 *     内主动刷新，照 feishu-token.ts 阈值惯例。
 *  2. 错误纪律同 notion-client——绝不把 app_secret / token 字面量带进错误消息或日志；
 *     业务码 1254290（TooManyRequest）→ 抛 name='FeishuRateLimitError' 供 worker 识别跳轮。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => ({ default: { post: vi.fn(), request: vi.fn() } }));
import axios from 'axios';
import {
  feishuRequest,
  getTenantToken,
  _resetTokenCache,
  FeishuRateLimitError,
} from '../feishu-client';

const FAKE_SECRET = `secret_test_${Math.floor(Math.random() * 90000) + 10000}`;

beforeEach(() => {
  vi.clearAllMocks();
  _resetTokenCache();
  process.env.FEISHU_APP_ID = 'cli_test_app';
  process.env.FEISHU_APP_SECRET = FAKE_SECRET;
});
afterEach(() => {
  delete process.env.FEISHU_APP_ID;
  delete process.env.FEISHU_APP_SECRET;
  delete process.env.FEISHU_API_BASE;
  _resetTokenCache();
});

function mockTokenResp(token: string, expireSec = 7200) {
  (axios.post as any).mockResolvedValue({
    data: { code: 0, tenant_access_token: token, expire: expireSec },
  });
}

describe('getTenantToken — 模块级缓存', () => {
  it('两次调用只换一次 token（缓存命中）', async () => {
    mockTokenResp('t-cache-1');
    const a = await getTenantToken();
    const b = await getTenantToken();
    expect(a).toBe('t-cache-1');
    expect(b).toBe('t-cache-1');
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('token 即将到期（剩余 < 5min 阈值）→ 下次调用刷新', async () => {
    // expire=60s < REFRESH_THRESHOLD_MS(5min) — 拿到手就已经"临期"，下次必须重新换
    (axios.post as any)
      .mockResolvedValueOnce({ data: { code: 0, tenant_access_token: 't-old', expire: 60 } })
      .mockResolvedValueOnce({ data: { code: 0, tenant_access_token: 't-new', expire: 7200 } });

    const first = await getTenantToken();
    const second = await getTenantToken();

    expect(first).toBe('t-old');
    expect(second).toBe('t-new');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('_resetTokenCache 后强制重新换 token', async () => {
    mockTokenResp('t-a');
    await getTenantToken();
    _resetTokenCache();
    mockTokenResp('t-b');
    const token = await getTenantToken();
    expect(token).toBe('t-b');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});

describe('feishuRequest — 请求封装', () => {
  it('请求带 Authorization 头，method/path 拼装正确', async () => {
    mockTokenResp('t-req');
    (axios.request as any).mockResolvedValue({ data: { code: 0, data: { ok: 1 } } });

    const r = await feishuRequest('post', '/open-apis/bitable/v1/apps/x/tables/y/records', {
      fields: { a: 1 },
    });
    expect(r).toEqual({ code: 0, data: { ok: 1 } });

    const cfg = (axios.request as any).mock.calls[0][0];
    expect(cfg.method).toBe('post');
    expect(cfg.url).toContain('/open-apis/bitable/v1/apps/x/tables/y/records');
    expect(cfg.headers.Authorization).toBe('Bearer t-req');
  });

  it('FEISHU_API_BASE 可注入（CI fake-server 惯例）', async () => {
    process.env.FEISHU_API_BASE = 'http://127.0.0.1:9999';
    mockTokenResp('t-base');
    (axios.request as any).mockResolvedValue({ data: { code: 0 } });
    await feishuRequest('get', '/open-apis/bitable/v1/apps/x');
    const cfg = (axios.request as any).mock.calls[0][0];
    expect(cfg.url).toBe('http://127.0.0.1:9999/open-apis/bitable/v1/apps/x');
  });

  it('HTTP 层报错 → 消息含 status 与 body，绝不含 secret/token 字面量', async () => {
    mockTokenResp('t-err');
    (axios.request as any).mockRejectedValue({
      message: 'Request failed with status code 400',
      response: { status: 400, data: { code: 99999, msg: 'invalid param' } },
      config: { headers: { Authorization: `Bearer t-err` } },
    });

    const err = await feishuRequest('post', '/open-apis/bitable/v1/apps').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('400');
    expect(err.message).toContain('invalid param');
    expect(err.message).not.toContain(FAKE_SECRET);
    expect(err.message).not.toContain('t-err');
  });

  it('业务码非 0（HTTP 200）→ 抛错且不含 secret', async () => {
    mockTokenResp('t-biz');
    (axios.request as any).mockResolvedValue({
      data: { code: 12345, msg: '参数错误' },
    });
    const err = await feishuRequest('post', '/open-apis/bitable/v1/apps').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('12345');
    expect(err.message).toContain('参数错误');
    expect(err.message).not.toContain(FAKE_SECRET);
  });

  it('业务码 1254290（频控）→ 抛 FeishuRateLimitError 供 worker 识别跳轮', async () => {
    mockTokenResp('t-rate');
    (axios.request as any).mockResolvedValue({
      data: { code: 1254290, msg: 'TooManyRequest' },
    });
    const err = await feishuRequest('post', '/open-apis/bitable/v1/apps/x/tables/y/records/search').catch(
      (e) => e
    );
    expect(err).toBeInstanceOf(FeishuRateLimitError);
    expect(err.name).toBe('FeishuRateLimitError');
  });

  it('1254290 出现在 HTTP 层错误体里也能识别为频控', async () => {
    mockTokenResp('t-rate2');
    (axios.request as any).mockRejectedValue({
      message: 'Request failed with status code 429',
      response: { status: 429, data: { code: 1254290, msg: 'TooManyRequest' } },
    });
    const err = await feishuRequest('post', '/open-apis/bitable/v1/apps').catch((e) => e);
    expect(err).toBeInstanceOf(FeishuRateLimitError);
  });

  it('app_id/secret 未配置 → 抛错且不发请求', async () => {
    delete process.env.FEISHU_APP_SECRET;
    await expect(feishuRequest('get', '/open-apis/bitable/v1/apps/x')).rejects.toThrow(
      /FEISHU_APP_ID|FEISHU_APP_SECRET/
    );
    expect(axios.request).not.toHaveBeenCalled();
  });
});
