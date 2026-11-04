import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = fileURLToPath(new URL('../../../../scripts/sessions/check-health.js', import.meta.url));
const cookieEnvs = ['DOUYIN_COOKIES', 'DOUYIN_SUB_1', 'DOUYIN_SUB_2', 'DOUYIN_SUB_3',
  'KUAISHOU_COOKIES', 'KUAISHOU_SUB_1', 'KUAISHOU_SUB_2', 'KUAISHOU_SUB_3',
  'XIAOHONGSHU_COOKIES', 'XIAOHONGSHU_SUB_1', 'XIAOHONGSHU_SUB_2', 'XIAOHONGSHU_SUB_3',
  'SHIPINHAO_COOKIES', 'SHIPINHAO_SUB_1', 'SHIPINHAO_SUB_2', 'SHIPINHAO_SUB_3',
  'TOUTIAO_COOKIES', 'TOUTIAO_SUB_1', 'TOUTIAO_SUB_2', 'TOUTIAO_SUB_3',
  'WEIBO_COOKIES', 'WEIBO_SUB_1', 'WEIBO_SUB_2', 'WEIBO_SUB_3',
  'ZHIHU_COOKIES', 'ZHIHU_SUB_1', 'ZHIHU_SUB_2', 'ZHIHU_SUB_3',
  'GONGZHONGHAO_COOKIES', 'GONGZHONGHAO_SUB_1', 'GONGZHONGHAO_SUB_2', 'GONGZHONGHAO_SUB_3'];

function runHealth(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'session-health-test-'));
  try {
    const preload = join(root, 'http-fixture.mjs');
    // Intercept transports before executing the real CLI: no remote platform,
    // notification service, credential store, or database is contacted.
    writeFileSync(preload, `
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { appendFileSync } from 'node:fs';
const config = JSON.parse(process.env.HEALTH_FIXTURE);
function response(status, body = '', headers = {}) {
  const result = new EventEmitter();
  result.statusCode = status; result.headers = headers; result.resume = () => {};
  process.nextTick(() => { result.emit('data', body); result.emit('end'); });
  return result;
}
function get(options, callback) {
  const request = new EventEmitter(); request.destroy = () => {};
  process.nextTick(() => {
    if (typeof options === 'string') {
      appendFileSync('notifications.jsonl', JSON.stringify({ channel: 'bark' }) + '\\n');
      callback(response(config.barkStatus ?? config.alertStatus ?? 200));
    } else if (config.networkError) request.emit('error', new Error('fixture network error'));
    else callback(response(config.status ?? 200,
      config.body ?? '{"status_code":0,"result":1,"code":0,"success":true}',
      config.headers ?? {}));
  });
  return request;
}
function post(options, callback) {
  const request = new EventEmitter(); let body = '';
  request.write = chunk => { body += chunk; };
  request.end = () => process.nextTick(() => {
    if (options.hostname === 'fixture-db.invalid') {
      appendFileSync('db-updates.jsonl', body + '\\n');
      if (config.dbNetworkError) { request.emit('error', new Error('fixture DB network error')); return; }
    }
    else appendFileSync('notifications.jsonl', JSON.stringify({ channel: 'feishu' }) + '\\n');
    callback(response(options.hostname === 'fixture-db.invalid' ? config.dbStatus ?? 200 : config.feishuStatus ?? config.alertStatus ?? 200));
  });
  return request;
}
http.get = https.get = get;
http.request = https.request = post;
`);
    const cookies = options.cookieJson ?? JSON.stringify([{ name: 'sessionid', value: 'fixture', expires: Math.floor(Date.now() / 1000) + 86400 }]);
    const env = { ...process.env, ...Object.fromEntries(cookieEnvs.map(name => [name, cookies])),
      FEISHU_API_KEY: 'fixture', NOTION_API_KEY: 'fixture', WECOM_API_KEY: 'fixture',
      BARK_URL: 'https://fixture-alert.invalid/bark', FEISHU_BOT_WEBHOOK: options.feishu ? 'https://fixture-feishu.invalid/webhook' : '',
      OPERATOR_API_URL: options.missingApiUrl ? '' : 'http://fixture-db.invalid', INTERNAL_API_SECRET: options.missingInternalAuth ? '' : 'fixture',
      FORCE_NOTIFY: String(options.forceNotify ?? false), SKIP_HTTP_CHECK: 'false',
      HEALTH_FIXTURE: JSON.stringify(options) };
    const result = spawnSync(process.execPath, ['--import', preload, script], {
      cwd: root, env, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.error, undefined);
    const readJsonl = file => {
      try { return readFileSync(join(root, file), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    };
    let report;
    try { report = JSON.parse(readFileSync(join(root, 'session-health-report.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; report = null; }
    return { ...result, report,
      updates: readJsonl('db-updates.jsonl').flatMap(row => row.updates),
      notifications: readJsonl('notifications.jsonl') };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

for (const [name, options] of [
  ['HTTP 500', { status: 500 }],
  ['HTTP 429', { status: 429 }],
  ['unrecognized redirect', { status: 302, headers: { location: '/unknown' } }],
  ['network failure', { networkError: true }],
]) test(`session patrol reports and alerts ${name} without marking cookies active`, () => {
  const result = runHealth(options);
  assert.equal(result.report.filter(row => row.status === 'unknown').length, 32);
  assert.equal(result.updates.filter(row => !row.platform.endsWith('API Key')).length, 0);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.notifications.length > 0, 'uncertain session health must trigger an alert');
  assert.doesNotMatch(result.stdout, /全部正常/);
});

test('session patrol rejects a successful HTTP response with failed platform validation', () => {
  const result = runHealth({ body: '{"status_code":1,"result":0,"code":-1,"success":false}' });
  assert.equal(result.report.find(row => row.platform === '抖音主号').status, 'unknown');
  assert.equal(result.report.find(row => row.platform === '快手主号').status, 'unknown');
  assert.equal(result.report.find(row => row.platform === '小红书主号').status, 'unknown');
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.notifications.length > 0);
});

test('session patrol keeps valid HTTP health results active', () => {
  const result = runHealth();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.filter(row => row.status === 'ok').length, 35);
  assert.equal(result.updates.length, 35);
  assert.equal(result.notifications.length, 0);
});

test('session patrol preserves expired-session failure and alert', () => {
  const result = runHealth({ status: 401 });
  assert.equal(result.report.filter(row => row.status === 'expired').length, 32);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.notifications.length > 0);
});

test('session patrol fails when a required alert receives HTTP 500', () => {
  const result = runHealth({ forceNotify: true, alertStatus: 500 });
  assert.equal(result.report.filter(row => row.status === 'ok').length, 35);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /告警|通知/);
});

for (const [name, options] of [
  ['HTTP 500', { dbStatus: 500 }], ['HTTP 401', { dbStatus: 401 }],
  ['HTTP redirect', { dbStatus: 302 }], ['network error', { dbNetworkError: true }],
]) test(`session patrol fails when status writeback receives ${name}`, () => {
  const result = runHealth(options);
  assert.equal(result.report.filter(row => row.status === 'ok').length, 35);
  assert.equal(result.updates.length, 35);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /回写/);
  assert.doesNotMatch(result.stdout, /全部正常/);
  assert.equal(result.notifications.length, 0, 'writeback failure does not expand notification policy');
});

test('status writeback failure still preserves expired-session alert delivery', () => {
  const result = runHealth({ status: 401, dbStatus: 500 });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /回写/);
  assert.equal(result.report.filter(row => row.status === 'expired').length, 32);
  assert.ok(result.notifications.length > 0);
});

test('session patrol accepts producer Playwright storageState cookies without losing valid health', () => {
  const cookieJson = JSON.stringify({ cookies: [{ name: 'sessionid', value: 'fixture' }],
    origins: [{ origin: 'https://fixture.invalid', localStorage: [{ name: 'state', value: 'keep-me' }] }] });
  const result = runHealth({ cookieJson });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report?.filter(row => row.status === 'ok').length, 35);
  assert.equal(result.updates.length, 35);
  assert.equal(result.notifications.length, 0);
});

for (const cookieJson of ['null', '{}', '[null]', '["cookie"]', '[{}]',
  '[{"name":"","value":"fixture"}]', '[{"name":"sessionid","value":1}]',
  '{"cookies":[null],"origins":[]}', '[{"name":"sessionid","value":"fixture"},null]']) {
  test(`session patrol reports malformed cookie entries as invalid: ${cookieJson}`, () => {
    const result = runHealth({ cookieJson });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.report?.filter(row => row.status === 'invalid').length, 32);
    assert.equal(result.updates.filter(row => !row.platform.endsWith('API Key')).length, 0);
    assert.ok(result.notifications.length > 0);
  });
}

for (const [feishuStatus, expectedExit] of [[500, 1], [200, 0]]) {
  test(`session patrol preserves Feishu ${feishuStatus} delivery result when Bark succeeds`, () => {
    const result = runHealth({ forceNotify: true, feishu: true, barkStatus: 200, feishuStatus });
    assert.equal(result.status, expectedExit, result.stdout + result.stderr);
    assert.deepEqual(result.notifications.map(row => row.channel).sort(), ['bark', 'feishu']);
  });
}

for (const [name, options] of [
  ['OPERATOR_API_URL', { missingApiUrl: true }],
  ['INTERNAL_API_SECRET', { missingInternalAuth: true }],
]) test(`missing ${name} refuses database transport and reports configuration failure`, () => {
  const result = runHealth(options);
  assert.notEqual(result.status, 0);
  assert.equal(result.updates.length, 0, 'missing configuration must cause zero status writes');
  assert.match(result.stderr, new RegExp(`missing required writeback configuration:.*${name}`));
});
