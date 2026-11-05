import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  const request = new EventEmitter(); let body = ''; request.setTimeout = () => request; request.destroy = () => {};
  request.write = chunk => { body += chunk; };
  request.end = () => process.nextTick(() => {
    if (options.hostname === 'fixture-db.invalid') {
      appendFileSync('db-updates.jsonl', body + '\\n');
      if (config.dbNetworkError) { request.emit('error', new Error('fixture DB network error')); return; }
    }
    else appendFileSync('notifications.jsonl', JSON.stringify({ channel: 'feishu' }) + '\\n');
    if (options.hostname === 'fixture-db.invalid') {
      const authorized = options.headers['X-Internal-Token'] === 'fixture' && !options.headers['x-internal-secret'];
      callback(response(authorized ? config.dbStatus ?? 200 : 401,
        config.dbBody ?? JSON.stringify({ ok: true, updated: JSON.parse(body).updates.length })));
    } else callback(response(config.feishuStatus ?? config.alertStatus ?? 200));
  });
  return request;
}
http.get = https.get = get;
http.request = https.request = post;
`);
    const cookies = options.cookieJson ?? JSON.stringify([{ name: 'sessionid', value: 'fixture', expires: Math.floor(Date.now() / 1000) + 86400 }]);
    const env = { ...process.env, ...Object.fromEntries(cookieEnvs.map(name => [name, cookies])),
      FEISHU_API_KEY: 'fixture', NOTION_API_KEY: 'fixture', WECOM_API_KEY: 'fixture',
      BARK_URL: options.noAlerts ? '' : 'https://fixture-alert.invalid/bark', FEISHU_BOT_WEBHOOK: options.feishu ? 'https://fixture-feishu.invalid/webhook' : '',
      OPERATOR_API_URL: options.missingApiUrl ? '' : 'http://fixture-db.invalid', ZENITHJOY_INTERNAL_TOKEN: options.missingInternalAuth ? '' : 'fixture',
      FORCE_NOTIFY: String(options.forceNotify ?? false), SKIP_HTTP_CHECK: 'false',
      HEALTH_FIXTURE: JSON.stringify(options) };
    if (options.apiKeysMissing) for (const name of ['FEISHU_API_KEY','NOTION_API_KEY','WECOM_API_KEY']) env[name] = '';
    delete env.SESSION_HEALTH_REQUIRED_ACCOUNTS;
    if (options.required !== undefined) env.SESSION_HEALTH_REQUIRED_ACCOUNTS = options.required;
    if (options.configuredCookies) for (const name of cookieEnvs) if (!options.configuredCookies.includes(name)) env[name] = '';
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
  assert.equal(result.updates.length, 0);
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
  assert.equal(result.updates.length, 8);
  assert.equal(result.notifications.length, 0);
  assert.deepEqual(result.updates.map(row => row.platform).sort(), ['douyin','gongzhonghao','kuaishou','shipinhao','toutiao','weibo','xiaohongshu','zhihu']);
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
  assert.equal(result.updates.length, 8);
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
  assert.equal(result.updates.length, 8);
  assert.equal(result.notifications.length, 0);
});

for (const cookieJson of ['null', '{}', '[null]', '["cookie"]', '[{}]',
  '[{"name":"","value":"fixture"}]', '[{"name":"sessionid","value":1}]',
  '{"cookies":[null],"origins":[]}', '[{"name":"sessionid","value":"fixture"},null]']) {
  test(`session patrol reports malformed cookie entries as invalid: ${cookieJson}`, () => {
    const result = runHealth({ cookieJson });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.report?.filter(row => row.status === 'invalid').length, 32);
    assert.equal(result.updates.length, 0);
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
  ['ZENITHJOY_INTERNAL_TOKEN', { missingInternalAuth: true }],
]) test(`missing ${name} refuses database transport and reports configuration failure`, () => {
  const result = runHealth(options);
  assert.notEqual(result.status, 0);
  assert.equal(result.updates.length, 0, 'missing configuration must cause zero status writes');
  assert.match(result.stderr, new RegExp(`missing required writeback configuration:.*${name}`));
});

for (const dbBody of ['', '<html>wrong route</html>', '{"ok":false,"updated":8}', '{"ok":true,"updated":0}']) {
  test('status writeback rejects incomplete or malformed HTTP 200 acknowledgement: '+dbBody, () => {
    const result = runHealth({ dbBody });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /回写/);
  });
}

const requiredAccounts = ['DOUYIN_COOKIES','KUAISHOU_COOKIES','TOUTIAO_COOKIES','ZHIHU_COOKIES'];
test('explicit required accounts preserve 35-slot report and optional missing without inventing health or notifications', () => {
 const result = runHealth({ required: requiredAccounts.join(','), configuredCookies: requiredAccounts, noAlerts: true, apiKeysMissing: true });
 assert.equal(result.status, 0, result.stderr);
 assert.equal(result.report.length, 35);
 assert.equal(result.report.filter(row => row.status === 'missing').length, 31);
 assert.equal(result.updates.length, 4);
 assert.equal(result.notifications.length, 0);
 assert.match(result.stdout, /optional_missing=31/);
});
for (const required of ['', 'UNKNOWN', 'DOUYIN_COOKIES,DOUYIN_COOKIES', 'DOUYIN_COOKIES,']) {
 test('invalid explicit required-account profile fails before transport: '+required, () => {
  const result = runHealth({ required, noAlerts: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SESSION_HEALTH_REQUIRED_ACCOUNTS/);
  assert.equal(result.updates.length, 0); assert.equal(result.notifications.length, 0);
 });
}
test('required missing remains fatal with no configured notification channel', () => {
 const result = runHealth({ required: requiredAccounts.join(','), configuredCookies: ['DOUYIN_COOKIES'], noAlerts: true });
 assert.notEqual(result.status, 0); assert.equal(result.notifications.length, 0);
 assert.equal(result.report.find(row => row.secretEnv === 'ZHIHU_COOKIES').status, 'missing');
});
test('API-key presence alone cannot yield a successful health patrol', () => {
 const result = runHealth({ required: 'DOUYIN_COOKIES', configuredCookies: [], noAlerts: true });
 assert.notEqual(result.status, 0); assert.equal(result.updates.length, 0);
 assert.match(result.stderr, /没有任何账号/); assert.doesNotMatch(result.stdout, /全部正常/);
});
for (const status of [401, 500]) test('configured required profile keeps expired/uncertain fatal: '+status, () => {
 const result = runHealth({ required: requiredAccounts.join(','), configuredCookies: requiredAccounts, noAlerts: true, status });
 assert.notEqual(result.status, 0); assert.equal(result.notifications.length, 0);
});


// Execute both real operator CLIs with only the browser transport replaced.
// Every state/cookie is synthetic, all filesystem writes stay in owned scratch,
// and a child preload rejects HTTP/HTTPS/fetch so no alert can leave the fixture.
function runOperatorOracle(platform, responses = [], concurrent = false) {
  const root = mkdtempSync(join(tmpdir(), 'operator-oracle-contract-'));
  try {
    const sessions = join(root, 'scripts', 'sessions');
    const dependency = join(root, 'services', 'agent', 'node_modules', 'playwright');
    const temporary = join(root, 'tmp');
    for (const dir of [sessions, dependency, temporary]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    writeFileSync(join(dependency, 'package.json'), '{"main":"index.cjs","type":"commonjs"}');
    const producer = `verify-operator-${platform}.js`;
    writeFileSync(join(sessions, producer), readFileSync(new URL('../../../../scripts/sessions/' + producer, import.meta.url)));
    const preload = join(root, 'deny-network.mjs');
    writeFileSync(preload, `import http from 'node:http';import https from 'node:https';
const deny=()=>{throw Error('OPERATOR_FIXTURE_NETWORK_FORBIDDEN')};
http.request=deny;http.get=deny;https.request=deny;https.get=deny;globalThis.fetch=deny;`);
    writeFileSync(join(dependency, 'index.cjs'), `
const config=JSON.parse(process.env.OPERATOR_ORACLE_FIXTURE);
let listener;const pending=[];
const page={
 async goto(){
  for(const item of config.responses){
   const response={url:()=>item.url,status:()=>item.status??200,
    json:async()=>{if(item.delayMs)await new Promise(resolve=>setTimeout(resolve,item.delayMs));if(item.invalidJSON)throw Error('fixture invalid JSON');return item.body;}};
   const outcome=listener?.(response);if(config.concurrent)pending.push(outcome);else await outcome;
  }
 },async waitForTimeout(){await Promise.all(pending);},url:()=>config.finalUrl,async screenshot(){}
};
const context={on:(name,handler)=>{if(name==='response')listener=handler;},newPage:async()=>page};
module.exports={chromium:{launch:async()=>({newContext:async()=>context,close:async()=>{}})}};
`);
    const state = JSON.stringify({ cookies: [
      { name: 'sessionid', value: 'synthetic-fixture-only' },
      { name: 'galaxy_creator_session_info', value: 'synthetic-fixture-only' },
    ], origins: [] });
    const finalUrl = platform === 'douyin' ? 'https://creator.douyin.com/creator-micro/home' : 'https://creator.xiaohongshu.com/publish/publish';
    const result = spawnSync(process.execPath, ['--import', preload, join(sessions, producer)], {
      cwd: root, encoding: 'utf8', timeout: 5000,
      env: { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        TMPDIR: temporary, TMP: temporary, TEMP: temporary,
        DOUYIN_OPERATOR_SESSION: state, XIAOHONGSHU_COOKIES: state,
        OPERATOR_ORACLE_FIXTURE: JSON.stringify({ finalUrl, responses, concurrent }),
      },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    return result;
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const operatorEndpoints = {
  douyin: 'https://creator.douyin.com/web/api/base/creator/user/info/',
  xiaohongshu: 'https://creator.xiaohongshu.com/api/galaxy/creator/home/cre_info',
};
const operatorSuccess = { douyin: { status_code: 0 }, xiaohongshu: { code: 0 } };
for (const platform of Object.keys(operatorEndpoints)) {
  const url = operatorEndpoints[platform];
  const positive = operatorSuccess[platform];
  const negative = platform === 'douyin' ? { status_code: 401 } : { code: 401, success: false };
  for (const [name, responses] of [
    ['missing account API', []],
    ['unrelated API', [{ url: 'https://example.invalid/unrelated', body: positive }]],
    ['HTTP200 invalid JSON', [{ url, invalidJSON: true }]],
    ['HTTP200 business failure', [{ url, body: negative }]],
    ['HTTP503 positive-looking body', [{ url, status: 503, body: positive }]],
    ['null JSON body', [{ url, body: null }]],
    ['array JSON body', [{ url, body: [] }]],
    ['later business failure after earlier success', [{ url, body: positive }, { url, body: negative }]],
  ]) test(`operator ${platform} rejects ${name} through actual CLI`, () => {
    const result = runOperatorOracle(platform, responses);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /PASS:/);
  });
  test(`operator ${platform} ignores a stale earlier success finishing after a newer failure`, () => {
    const result = runOperatorOracle(platform, [{ url, body: positive, delayMs: 30 }, { url, body: negative }], true);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /PASS:/);
  });
  const positives = platform === 'douyin'
    ? [{ status_code: 0 }, { user_info: { uid: 'fixture' } }, { creator_info: { id: 'fixture' } }]
    : [{ code: 0 }, { success: true }];
  for (const [index, body] of positives.entries()) test(`operator ${platform} retains valid business success ${index}`, () => {
    const result = runOperatorOracle(platform, [{ url, body }]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS:/);
  });
}

for (const [name, body, configuredCookies] of [
  ['Douyin rejects explicit failure with user_info', '{"status_code":8,"user_info":{"uid":"fixture"}}', ['DOUYIN_COOKIES']],
  ['Douyin rejects explicit failure with creator_info', '{"status_code":8,"creator_info":{"uid":"fixture"}}', ['DOUYIN_COOKIES']],
  ['Kuaishou rejects explicit failure with data', '{"result":0,"data":{"userId":"fixture"}}', ['KUAISHOU_COOKIES']],
  ['XHS rejects failed code with success true', '{"code":-1,"success":true}', ['XIAOHONGSHU_COOKIES']],
  ['XHS rejects success false with code zero', '{"code":0,"success":false}', ['XIAOHONGSHU_COOKIES']],
]) test('session patrol business failure veto: '+name, () => {
  const result = runHealth({ body, configuredCookies, required: configuredCookies.join(','), apiKeysMissing: true, noAlerts: true });
  assert.equal(result.report.find(row => row.secretEnv === configuredCookies[0]).status, 'unknown');
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.updates.length, 0, 'conflicting business response must not mark a session active');
  assert.doesNotMatch(result.stdout, /全部正常|已检查账号通过/);
});

for (const [name, body, configuredCookies] of [
  ['Douyin status_code zero', '{"status_code":0}', ['DOUYIN_COOKIES']],
  ['Douyin legacy user_info', '{"user_info":{"uid":"fixture"}}', ['DOUYIN_COOKIES']],
  ['Douyin legacy creator_info', '{"creator_info":{"uid":"fixture"}}', ['DOUYIN_COOKIES']],
  ['Kuaishou result one', '{"result":1}', ['KUAISHOU_COOKIES']],
  ['Kuaishou legacy data', '{"data":{"userId":"fixture"}}', ['KUAISHOU_COOKIES']],
  ['XHS code zero', '{"code":0}', ['XIAOHONGSHU_COOKIES']],
  ['XHS success true', '{"success":true}', ['XIAOHONGSHU_COOKIES']],
]) test('session patrol preserves affirmative response: '+name, () => {
  const result = runHealth({ body, configuredCookies, required: configuredCookies.join(','), apiKeysMissing: true, noAlerts: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.find(row => row.secretEnv === configuredCookies[0]).status, 'ok');
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].status, 'active');
});
