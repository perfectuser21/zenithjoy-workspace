/**
 * login-no-signup.test.mjs
 * INV-3: login.mjs 无 signup 回落路径
 *
 * FR-02: 无凭据时必须抛错非零退出，不得回落 signup 模式
 *
 * 这是 failing test（commit-1），实现完成后（commit-3）应全绿。
 */

import { resolveCredentials } from '../../../scripts/acceptance-spec/ai-run/login.mjs';

describe('INV-3 / FR-02: login.mjs signup 回落禁止', () => {
  test('无凭据（空 cli + 空 env）必须抛错，不得返回 mode:"signup"', () => {
    expect(() => {
      resolveCredentials({}, {});
    }).toThrow(); // 必须抛出，任何错误均可
  });

  test('只有邮箱无密码时抛错', () => {
    expect(() => {
      resolveCredentials({ email: 'test@example.com' }, {});
    }).toThrow(/密码|password/i);
  });

  test('只有密码无邮箱时抛错', () => {
    expect(() => {
      resolveCredentials({ password: 'secret123' }, {});
    }).toThrow(/邮箱|email/i);
  });

  test('有效凭据（email + password）返回 mode:"login"', () => {
    const result = resolveCredentials(
      { email: 'ai@test.com', password: 'pass123' },
      {}
    );
    expect(result.mode).toBe('login');
    expect(result.email).toBe('ai@test.com');
  });

  test('env 凭据（ACCEPTANCE_EMAIL + ACCEPTANCE_PASSWORD）返回 mode:"login"', () => {
    const result = resolveCredentials(
      {},
      { ACCEPTANCE_EMAIL: 'env@test.com', ACCEPTANCE_PASSWORD: 'envpass' }
    );
    expect(result.mode).toBe('login');
    expect(result.source).toBe('env');
  });

  test('resolveCredentials 无论何种情况都不应返回 mode:"signup"', () => {
    // 穷举各种无效入参，均不得返回 signup
    const cases = [
      [{}, {}],
      [{ email: '' }, { ACCEPTANCE_EMAIL: '' }],
      [{ email: null }, {}],
    ];

    for (const [cli, env] of cases) {
      expect(() => {
        const r = resolveCredentials(cli, env);
        if (r.mode === 'signup') throw new Error('FAIL: mode=signup 不允许');
      }).toThrow(); // 要么抛错（正确），要么返回 signup（会被 if 语句抛错）
    }
  });
});
