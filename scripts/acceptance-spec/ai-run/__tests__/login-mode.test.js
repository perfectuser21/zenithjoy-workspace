import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCredentials, buildRunSummary } from '../login.mjs';

test('凭据解析：命令行参数优先于环境变量', () => {
  const c = resolveCredentials(
    { email: 'cli@x.test', password: 'cliPass' },
    { ACCEPTANCE_EMAIL: 'env@x.test', ACCEPTANCE_PASSWORD: 'envPass' }
  );
  assert.equal(c.email, 'cli@x.test');
  assert.equal(c.password, 'cliPass');
  assert.equal(c.source, 'cli');
});

test('凭据解析：无命令行参数时回落环境变量', () => {
  const c = resolveCredentials({}, { ACCEPTANCE_EMAIL: 'env@x.test', ACCEPTANCE_PASSWORD: 'envPass' });
  assert.equal(c.email, 'env@x.test');
  assert.equal(c.source, 'env');
});

test('凭据解析：两者都无 → D2 返回 ai_incomplete 整轮退出（不再 signup 回落）', () => {
  const c = resolveCredentials({}, {});
  assert.equal(c.mode, 'ai_incomplete');
  assert.equal(c.ai_incomplete, true);
  assert.equal(c.email, null);
});

test('凭据解析：只给邮箱不给密码 → 报错点名缺失项，不静默降级', () => {
  assert.throws(
    () => resolveCredentials({ email: 'x@y.test' }, {}),
    /密码/,
    '缺密码应报错并点名'
  );
});

test('凭据解析：登录模式下 mode=login', () => {
  const c = resolveCredentials({ email: 'a@b.test', password: 'p' }, {});
  assert.equal(c.mode, 'login');
});

test('运行摘要：登录模式必须记录账号与租户来源，且不含密码', () => {
  const s = buildRunSummary({
    mode: 'login',
    email: 'ai-acceptance@zenithjoy.test',
    password: 'SuperSecret123',
    staging: 'https://staging.example',
    machinesOnline: 4,
  });
  assert.equal(s.mode, 'login');
  assert.equal(s.account, 'ai-acceptance@zenithjoy.test');
  assert.equal(s.machines_online, 4);
  const dumped = JSON.stringify(s);
  assert.ok(!dumped.includes('SuperSecret123'), '摘要绝不能含密码明文');
});

test('运行摘要：注册模式记录 signup 且账号为本轮新建', () => {
  const s = buildRunSummary({ mode: 'signup', email: 'ai-table-123@zenithjoy.test', staging: 'https://s', machinesOnline: 0 });
  assert.equal(s.mode, 'signup');
  assert.equal(s.machines_online, 0);
});
