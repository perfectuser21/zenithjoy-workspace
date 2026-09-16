/**
 * preview 门禁回归（PR#1845）
 *
 * 独立于 meta-publishing.test.ts —— 后者是已落盘的合同测试，
 * 受 lint-contract-test-immutability 保护，不可修改。新增覆盖另开文件。
 *
 * 锁住的行为：preview 不需要 Meta 凭据（否则凭据到位前无法做内容审批），
 * 但真实发布路径的门禁一个不能少。
 */
import { describe, expect, it, vi } from 'vitest';

import type { MetaEnv, MetaIdempotencyStore, StoredAttemptRecord } from '../../../apps/geoai/functions/api/meta/_lib';
import { onRequestPost as publishPost } from '../../../apps/geoai/functions/api/meta/publish';

const TOKEN = 'test-page-token-not-a-secret';
const API_KEY = 'internal-publish-api-key';

function memStore(
  initial: Record<string, StoredAttemptRecord> = {},
): MetaIdempotencyStore & { values: Map<string, StoredAttemptRecord> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    read: vi.fn(async (k: string) => values.get(k) ?? null),
    claim: vi.fn(async (k: string, a: StoredAttemptRecord) => {
      const e = values.get(k);
      if (e) return { claimed: false as const, existing: e };
      values.set(k, a);
      return { claimed: true as const };
    }),
    update: vi.fn(async (k: string, a: StoredAttemptRecord) => { values.set(k, a); }),
  };
}

const fullEnv = (extra: Partial<MetaEnv> = {}): MetaEnv => ({
  META_GRAPH_API_VERSION: 'v24.0',
  META_PAGE_ID: '61594139321850',
  META_INSTAGRAM_BUSINESS_ACCOUNT_ID: '17841400000000000',
  META_PAGE_ACCESS_TOKEN: TOKEN,
  META_PUBLISH_API_KEY: API_KEY,
  META_PUBLISH_ENABLED: 'false',
  ...extra,
});

/** 只配本端点 API key，Meta 凭据全缺 —— 模拟凭据到位前的真实状态 */
const envNoCreds = (): MetaEnv => ({ META_PUBLISH_API_KEY: API_KEY });

const req = (body: Record<string, unknown>) =>
  new Request('https://www.zenithjoyai.com/api/meta/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });

describe('preview 门禁', () => {
  it('凭据未配置时 preview 仍可用，且不触碰 Graph API', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await publishPost({
      request: req({ platform: 'facebook', message: '待审内容', idempotencyKey: 'pv-001' }),
      env: envNoCreds(),
    } as any);
    expect(res.status).toBe(200);
    expect((await res.json() as any).mode).toBe('preview');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('凭据未配置时真实发布仍被 503 挡住', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await publishPost({
      request: req({
        platform: 'facebook', message: 'x', mode: 'publish',
        confirm: 'PUBLISH', idempotencyKey: 'pv-002',
      }),
      env: envNoCreds(),
    } as any);
    expect(res.status).toBe(503);
    expect((await res.json() as any).error).toBe('not_configured');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('凭据齐全但 META_PUBLISH_ENABLED=false 时，真实发布仍被 403 挡住', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await publishPost({
      request: req({
        platform: 'facebook', message: 'x', mode: 'publish',
        confirm: 'PUBLISH', idempotencyKey: 'pv-003',
      }),
      env: fullEnv({ META_IDEMPOTENCY: memStore() }),
    } as any);
    expect(res.status).toBe(403);
    expect((await res.json() as any).error).toBe('publishing_not_confirmed');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('未授权请求在任何分支之前就被 401 拦下', async () => {
    const res = await publishPost({
      request: new Request('https://www.zenithjoyai.com/api/meta/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'facebook', message: 'x' }),
      }),
      env: envNoCreds(),
    } as any);
    expect(res.status).toBe(401);
  });

  it('preview 响应不回显任何密钥', async () => {
    const res = await publishPost({
      request: req({ platform: 'facebook', message: 'x', idempotencyKey: 'pv-004' }),
      env: fullEnv({ META_IDEMPOTENCY: memStore() }),
    } as any);
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(API_KEY);
  });
});
