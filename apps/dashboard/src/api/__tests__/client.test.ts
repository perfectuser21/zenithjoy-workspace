/**
 * Sprint B · WS3 — apiClient 自动注入 X-Feishu-User-Id
 *
 * 验证从 localStorage/cookie 取 user 然后注入到 axios 请求 header。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getFeishuUserIdFromStorage } from '../client';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('client.getFeishuUserIdFromStorage', () => {
  it('localStorage user.feishu_user_id 优先返回', () => {
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 'ou_alice', feishu_user_id: 'ou_alice_feishu' })
    );
    expect(getFeishuUserIdFromStorage()).toBe('ou_alice_feishu');
  });

  it('localStorage user.id fallback', () => {
    localStorage.setItem('user', JSON.stringify({ id: 'ou_alice' }));
    expect(getFeishuUserIdFromStorage()).toBe('ou_alice');
  });

  it('localStorage 无 user 返回空串', () => {
    expect(getFeishuUserIdFromStorage()).toBe('');
  });

  it('localStorage user 无效 JSON 返回空串', () => {
    localStorage.setItem('user', '{invalid json');
    expect(getFeishuUserIdFromStorage()).toBe('');
  });
});
