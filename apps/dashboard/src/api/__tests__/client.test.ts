/**
 * Sprint B · WS3 — apiClient 自动注入 X-Feishu-User-Id
 *
 * 验证从 cookie 取 user 然后通过 getFeishuUserIdFromStorage 返回。
 * 用 cookie（vitest jsdom localStorage 在 setup 阶段不稳定）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getFeishuUserIdFromStorage } from '../client';

function setUserCookie(user: object | string) {
  const value = typeof user === 'string' ? user : JSON.stringify(user);
  document.cookie = `user=${encodeURIComponent(value)}; path=/`;
}

function clearCookie() {
  document.cookie = 'user=; path=/; max-age=0';
}

beforeEach(() => {
  clearCookie();
});

describe('client.getFeishuUserIdFromStorage', () => {
  it('cookie user.feishu_user_id 优先返回', () => {
    setUserCookie({ id: 'ou_alice', feishu_user_id: 'ou_alice_feishu' });
    expect(getFeishuUserIdFromStorage()).toBe('ou_alice_feishu');
  });

  it('cookie user.id fallback', () => {
    setUserCookie({ id: 'ou_alice' });
    expect(getFeishuUserIdFromStorage()).toBe('ou_alice');
  });

  it('cookie 无 user 返回空串', () => {
    expect(getFeishuUserIdFromStorage()).toBe('');
  });

  it('cookie user 无效 JSON 返回空串', () => {
    setUserCookie('{invalid json');
    expect(getFeishuUserIdFromStorage()).toBe('');
  });
});
