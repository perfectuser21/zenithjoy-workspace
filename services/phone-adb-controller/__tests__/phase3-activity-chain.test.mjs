import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { scoreComments } = require('../comment-activities.js');
const { deliverRawComments } = require('../raw-comment-delivery.js');
const { createRawCommentDeps } = require('../raw-comment-storage.js');
const { createDeliveryDeps, receiptMarker } = require('../comment-delivery-storage.js');
const { RAW_COMMENT_FIELDS } = require('../raw-comment-activities.js');
const { routeOf } = require('../line-routes.js');
const { DECISIONS_ENDPOINT } = require('../judge-comment.js');

const videoId = '7412345678901234567';
const runTag = 'phase3-chain-smoke';
const route = routeOf('jinuo');
const env = { FEISHU_ACCOUNT: route.account, FEISHU_APP_ID: 'fixture-app', FEISHU_APP_SECRET: 'fixture-secret' };
const entry = new URL('../video-activity.js', import.meta.url).pathname;

// 只替换手机/SSH运输，LEAD输出及JSON评论转换仍由真实采集活动完成。
const adb = `#!/bin/sh
shift 2
cmd="$1"; shift
printf 'adb %s %s\\n' "$cmd" "$*" >> "$HOME/calls"
case "$cmd" in
 preflight) printf 'serial=fixture-serial\\nstate=device\\n';;
 lock-status) echo 'lock=free';;
 lock-acquire) echo "lock=acquired owner=$1";;
 lock-release) echo "lock=released owner=$1";;
 open-video) echo 'video_opened=1';;
 current-video-link) printf 'video_id=${videoId}\\nshort_url=https://v.douyin.com/fixture/\\n';;
 open-comments) printf 'comments_opened=1\\ncomment_count=1\\n';;
 collect-comments) printf '小李\\t如何报名\\t今天\\t北京\\tpersonal\\ttap=10 20\\tb64=AAA\\nexhausted=1\\n';;
 commenter-identity) printf 'nickname=小李\\ndouyin_id=123\\naccount_type=personal\\n';;
 commenter-card-link) echo 'profile_url=https://www.douyin.com/user/fixture';;
 tap-evidence) exit 0;;
 *) echo "unexpected fixture ADB command: $cmd" >&2; exit 97;;
esac`;
const ssh = `#!/bin/sh
printf 'ssh %s\\n' "$*" >> "$HOME/calls"
case "$*" in
 *'qualify-video.js discover'*) echo 'QUAL_DISCOVER {"status":"matched","has_transcript":true}';;
 *'qualify-video.js collected'*) echo 'QUAL_COLLECTED {"updated":1}';;
 *) echo 'unexpected fixture SSH command' >&2; exit 97;;
esac`;

function collect(t) {
  const home = mkdtempSync(join(tmpdir(), 'phase3-chain-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  for (const [name, code] of [
    ['douyin-phone-adb', adb], ['ssh', ssh],
    ['date', '#!/bin/sh\n[ "$1" = +%s ] && { echo 1000; exit; }\nexec /bin/date "$@"'],
    ['scp', '#!/bin/sh\necho unexpected-network-boundary >&2\nexit 97'],
    ['curl', '#!/bin/sh\necho unexpected-network-boundary >&2\nexit 97'],
  ]) {
    writeFileSync(join(bin, name), code);
    chmodSync(join(bin, name), 0o755);
  }
  const input = { run_tag: runTag, line_key: route.key,
    device: { profile: 'jinoshengyuan-work', serial: 'fixture-serial', lock_holder: runTag },
    video: { video_id: videoId, video_url: 'https://v.douyin.com/fixture/', title: 'AI课程',
      keyword: 'AI 考证', duration: '00:30', judgment_status: 'matched' }, budget: { max_duration_s: 60 } };
  const result = spawnSync(process.execPath, [entry, 'collection'], {
    encoding: 'utf8', input: JSON.stringify(input), timeout: 20000,
    // 白名单环境不继承真实账号配置、凭据、停止信号或PATH里的ADB。
    env: { HOME: home, PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
      HARVEST_KEYWORD_TESTING: '1', WF_BOUNDED_POLL: '0.05' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'completed');
  assert.equal(output.metrics.comments_collected, 1);
  const calls = readFileSync(join(home, 'calls'), 'utf8');
  assert.match(calls, /adb collect-comments/);
  assert.match(calls, /qualify-video.js collected/);
  assert.match(calls, new RegExp(`lock-release ${runTag}`));
  assert.doesNotMatch(calls, /qualify-video.js judge|record-start|search-video/);
  const [comment] = output.outputs.comments;
  assert.equal(comment.id, `${videoId}:1`);
  assert.equal(comment.video_id, videoId);
  assert.equal(comment.fields.评论原文, '如何报名');
  assert.equal(comment.fields.抖音号, '123');
  assert.equal(comment.fields.主页链接, 'https://www.douyin.com/user/fixture');
  return { run_tag: output.run_tag, line_key: output.line_key, comments: output.outputs.comments };
}

function httpFixture() {
  const pool = new Map(), leads = new Map(), calls = [], modelCalls = [];
  const response = body => ({ ok: true, json: async () => structuredClone(body) });
  const request = async (url, options) => {
    calls.push({ url, method: options.method });
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://open.feishu.cn');
    assert.ok(options.signal);
    if (parsed.pathname === '/open-apis/auth/v3/tenant_access_token/internal') {
      assert.deepEqual(JSON.parse(options.body), { app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET });
      return response({ code: 0, tenant_access_token: 'fixture-token' });
    }
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    const match = parsed.pathname.match(/^\/open-apis\/bitable\/v1\/apps\/([^/]+)\/tables\/([^/]+)\/(fields|records)(?:\/([^/]+))?$/);
    assert.ok(match, `unexpected fixture endpoint: ${url}`);
    const [, base, table, resource, encodedId] = match;
    assert.equal(base, route.base);
    assert.ok([route.pool, route.lead].includes(table));
    const store = table === route.pool ? pool : leads;
    if (resource === 'fields') {
      assert.equal(options.method, 'GET');
      const names = table === route.pool ? RAW_COMMENT_FIELDS : ['采集时间'];
      return response({ code: 0, data: { items: names.map(field_name => ({ field_name, type: 1 })) } });
    }
    const id = encodedId && decodeURIComponent(encodedId);
    if (options.method === 'GET') {
      if (id) {
        assert.ok(store.has(id), `record must exist before read: ${id}`);
        return response({ code: 0, data: { record: store.get(id) } });
      }
      return response({ code: 0, data: { items: [...store.values()], has_more: false } });
    }
    assert.ok(['POST', 'PUT'].includes(options.method));
    if (options.method === 'PUT') assert.ok(store.has(id), `record must exist before update: ${id}`);
    else assert.equal(id, undefined);
    const recordId = id || (table === route.pool ? 'persisted-pool-1' : 'persisted-lead-1');
    const record = { record_id: recordId, fields: { ...store.get(recordId)?.fields, ...JSON.parse(options.body).fields } };
    store.set(recordId, record);
    return response({ code: 0, data: { record } });
  };
  // 实际judgeComment执行，仅替换OpenRouter httpPost运输边界。
  const judgeOptions = { apiKey: 'fixture-model-key', httpPost: async (url, body) => {
    modelCalls.push({ url, body });
    assert.equal(url, DECISIONS_ENDPOINT);
    assert.match(body.state, /如何报名/);
    assert.match(body.state, /AI课程/);
    return { answers: { grade: { choice: 'A', confidence: 0.95 } } };
  } };
  return { pool, leads, calls, modelCalls, request, judgeOptions };
}

async function deliver(input, http) {
  return deliverRawComments(input, {
    persistDeps: await createRawCommentDeps(input, { env, request: http.request }),
    createDeliveryDeps: payload => createDeliveryDeps(payload, { env, request: http.request }),
  });
}

test('永久离线活动链：真实采集JSON→评分HTTP边界→原始池ID→线索与池结算', async t => {
  const input = collect(t), http = httpFixture();
  const scored = await scoreComments(input, { judgeOptions: http.judgeOptions });
  assert.equal(scored.status, 'completed');
  assert.equal(http.modelCalls.length, 1);
  assert.equal(scored.outputs.comments[0].verdict.grade, 'A');
  assert.equal(scored.outputs.comments[0].verdict.relevance, '相关');
  const result = await deliver({ ...input, comments: scored.outputs.comments }, http);
  assert.equal(result.status, 'completed');
  assert.equal(result.metrics.comments_written, 1);
  assert.equal(result.metrics.leads_written, 1);
  assert.equal(result.metrics.pending, 0);
  const [comment] = result.outputs.comments;
  assert.equal(comment.id, 'persisted-pool-1');
  assert.equal(comment.source_id, `${videoId}:1`);
  assert.deepEqual(comment.verdict, scored.outputs.comments[0].verdict);
  assert.equal(comment.delivery_status, 'completed');
  assert.equal(http.pool.size, 1);
  assert.equal(http.leads.size, 1);
  const pool = http.pool.get(comment.id), lead = http.leads.get('persisted-lead-1');
  assert.equal(pool.fields.原始评论ID, '小李|123|如何报名');
  assert.equal(pool.fields.处理状态, '已分拣');
  assert.equal(pool.fields.进入最终线索, true);
  assert.equal(pool.fields.意向等级, 'A');
  assert.equal(lead.fields.抖音昵称, '小李');
  assert.equal(lead.fields.抖音号, '123');
  assert.equal(lead.fields.原始评论, '如何报名');
  assert.equal(lead.fields.业务线, route.line);
  assert.match(lead.fields.AI判断理由, /^\[A级\]/);
  assert.equal(lead.fields.重复轨迹, receiptMarker(route.pool, comment.id));
  assert.ok(http.calls.some(call => call.method === 'GET' && call.url.endsWith(`/records/${comment.id}`)));
  assert.deepEqual(http.calls.filter(call => ['POST', 'PUT'].includes(call.method) && !call.url.includes('/auth/'))
    .map(call => [call.method, call.url.split('/tables/')[1]]), [
      ['POST', `${route.pool}/records`], ['POST', `${route.lead}/records`], ['PUT', `${route.pool}/records/${comment.id}`],
    ]);
});

test('永久离线活动链：删除可选评分步骤仍仅落评论，不读模型或线索表', async t => {
  const input = collect(t), http = httpFixture();
  for (const comment of input.comments) { delete comment.verdict; delete comment.score_status; }
  const result = await deliver(input, http);
  assert.equal(result.status, 'completed');
  assert.equal(result.metrics.comments_written, 1);
  assert.equal(result.metrics.leads_written, 0);
  assert.equal(result.metrics.unscored, 1);
  assert.equal(result.metrics.pending, 0);
  assert.equal(result.outputs.comments[0].id, 'persisted-pool-1');
  assert.equal(result.outputs.comments[0].delivery_status, 'unscored');
  assert.equal(result.outputs.comments[0].verdict, undefined);
  assert.equal(http.pool.get('persisted-pool-1').fields.处理状态, '待分拣');
  assert.equal(http.pool.size, 1);
  assert.equal(http.leads.size, 0);
  assert.equal(http.modelCalls.length, 0);
  assert.ok(http.calls.every(call => !call.url.includes(`/tables/${route.lead}/`)));
  assert.equal(http.calls.filter(call => call.method === 'POST' && call.url.includes('/records')).length, 1);
  assert.equal(http.calls.filter(call => call.method === 'PUT').length, 0);
});
