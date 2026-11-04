import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { validateQrNotification } from './validate-qr-notification.mjs';
const { sendFeishuQrCard } = createRequire(import.meta.url)('../../services/agent/publishers/qr-notification.cjs');
const env = { FEISHU_APP_ID: 'fixture', FEISHU_APP_SECRET: 'fixture', ZENITHJOY_FEISHU_WEBHOOK: 'https://fixture.invalid' };
const response = data => ({ ok: true, json: async () => data });
test('real notification implementation checks HTTP200 business rejection and preserves image identity', async () => {
  const calls = []; let responses = [response({ code: 0, tenant_access_token: 'fixture-tenant-token' }), response({ code: 0, data: { image_key: 'img-fixture' } }), response({ code: 19001 })];
  const fetchFn = async (...args) => { calls.push(args); return responses.shift(); };
  assert.equal((await sendFeishuQrCard('douyin', Buffer.from('fixture'), { env, fetchFn })).status, 'failed');
  assert.equal(calls[0][0], 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal');
  assert.equal(calls[1][1].headers.Authorization, 'Bearer fixture-tenant-token');
  assert.equal(JSON.parse(calls[2][1].body).card.elements[0].img_key, 'img-fixture');
  responses = [response({ code: 0, tenant_access_token: 'fixture-tenant-token' }), response({ code: 0, data: { image_key: 'img-fixture' } }), response({ code: 0 })];
  const accepted = await sendFeishuQrCard('douyin', Buffer.from('fixture'), { env, fetchFn });
  assert.equal(accepted.status, 'api_accepted'); assert.equal(accepted.delivery_verified, false);
});
test('missing notification configuration makes no external call and does not report success', async () => {
  const result = await sendFeishuQrCard('douyin', Buffer.alloc(0), { env: {}, fetchFn: () => assert.fail('must not call network') });
  assert.equal(result.status, 'missing_configuration');
});
test('actual receipt validator rejects missing/mismatched run, uncropped image, provider failure and generic crash', () => {
  const receipt = { status: 'api_accepted', api_code: 0, image_key: 'img-fixture', platform: 'douyin', run_id: 'run-1', capture: { kind: 'element', width: 180, height: 180 } };
  const input = { receipt, result: { ok: false, platform: 'douyin', error: '扫码超时（150000ms）' }, exitCode: 1, runId: 'run-1', platform: 'douyin' };
  assert.equal(validateQrNotification(input).delivery_verified, false);
  for (const change of [{ platform: 'xiaohongshu' }, { runId: 'run-2' }, { result: { ok: false, error: 'browser crashed' } }, { receipt: { ...receipt, status: 'failed' } }, { receipt: { ...receipt, capture: { kind: 'page', width: 1200, height: 900 } } }, { receipt: { ...receipt, api_code: 1 } }]) assert.throws(() => validateQrNotification({ ...input, ...change }));
});

test('an app token response cannot be used to upload IM images', async () => {
  let calls = 0;
  const result = await sendFeishuQrCard('douyin', Buffer.from('fixture'), { env,
    fetchFn: async url => { calls++; assert.equal(url, 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'); return response({ code: 0, app_access_token: 'wrong-scope-token' }); },
  });
  assert.equal(result.status, 'failed'); assert.equal(calls, 1);
});
