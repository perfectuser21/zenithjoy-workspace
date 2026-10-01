import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { routeOf } = require('../line-routes.js');
const { RAW_COMMENT_FIELDS } = require('../raw-comment-activities.js');
const route = routeOf('jinuo');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const service = join(repo, 'services/phone-adb-controller');
const compiler = join(repo, 'scripts/product-map/wf-plan.mjs');
const bindingFile = join(service, 'plans/keyword_activities.bindings.json');
const runtime = process.env.CECELIA_ACTIVITY_RUNTIME;
const optIn = { skip: runtime ? false : '未提供 CECELIA_ACTIVITY_RUNTIME，未执行跨仓库 CLI 验收', timeout: 60000 };
const ids = ['7412345678901234567', '7412345678901234568', '7412345678901234569'];

// CLI均为真实子进程；父进程必须异步等待，让本地HTTP运输fixture继续响应。
function cli(entry, args, { cwd, env, input, timeout = 45000, cancelWhen }) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`fixture CLI timeout: ${entry}`)); }, timeout);
    const cancel = cancelWhen && setInterval(() => {
      if (existsSync(cancelWhen)) { clearInterval(cancel); child.kill('SIGTERM'); }
    }, 10);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.on('error', () => {});
    child.on('error', error => { clearTimeout(timer); clearInterval(cancel); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timer); clearInterval(cancel); done({ code, signal, stdout, stderr }); });
    child.stdin.end(input === undefined ? '' : JSON.stringify(input));
  });
}

const adb = `#!/bin/sh
shift 2
cmd="$1"; shift
printf 'adb %s %s\\n' "$cmd" "$*" >> "$HOME/calls"
case "$cmd" in
 preflight) printf 'serial=fixture-serial\\nstate=device\\n';;
 lock-status) echo 'lock=free';;
 lock-acquire) echo "lock=acquired owner=$1";;
 lock-release) echo "lock=released owner=$1";;
 open-video)
   echo "$1" > "$HOME/current-video"
   n=$(cat "$HOME/snapshot-count"); n=$((n + 1)); echo "$n" > "$HOME/snapshot-count"
   cp "$FIXTURE_RECEIPT" "$HOME/phone-receipt-$n.json"
   echo 'video_opened=1';;
 current-video-link) printf 'video_id=%s\\nshort_url=https://v.douyin.com/fixture/\\n' "$(cat "$HOME/current-video")";;
 open-comments) printf 'comments_opened=1\\ncomment_count=1\\n';;
 collect-comments)
   case "$(cat "$HOME/current-video")" in
    ${ids[0]}) n=1;; ${ids[1]}) n=2;; ${ids[2]}) n=3;; *) exit 97;;
   esac
   printf '客户%s\\t如何报名%s\\t今天\\t北京\\tpersonal\\ttap=10 20\\tb64=AAA\\n' "$n" "$n"
   if [ -n "$FIXTURE_STOP_MODE" ]; then printf '未采客户\\t不该结算\\t今天\\t北京\\tpersonal\\ttap=30 40\\tb64=BBB\\n'; fi
   echo 'exhausted=1';;
 commenter-identity)
   case "$(cat "$HOME/current-video")" in
    ${ids[0]}) n=1;; ${ids[1]}) n=2;; ${ids[2]}) n=3;; *) exit 97;;
   esac
   printf 'nickname=客户%s\\ndouyin_id=10%s\\naccount_type=personal\\n' "$n" "$n";;
 commenter-card-link)
   if [ "$FIXTURE_STOP_MODE" = cancel ]; then touch "$HOME/cancel-ready"; /bin/sleep 1; fi
   printf 'profile_url=https://www.douyin.com/user/%s\\n' "$(cat "$HOME/current-video")"
   if [ "$FIXTURE_STOP_MODE" = budget ]; then echo 1006 > "$HOME/now"; fi;;
 tap-evidence) exit 0;;
 *) echo "unexpected fixture ADB command: $cmd" >&2; exit 97;;
esac`;

// 只重定向允许的模型/飞书HTTP运输，原始fetch仅能访问本fixture的loopback服务。
const preload = `const realFetch = globalThis.fetch;
globalThis.fetch = (value, options) => {
  const url = new URL(String(value));
  const model = url.origin === 'https://openrouter.ai' && url.pathname === '/api/alpha/decisions';
  const auth = url.origin === 'https://open.feishu.cn' && url.pathname === '/open-apis/auth/v3/tenant_access_token/internal';
  const table = url.origin === 'https://open.feishu.cn' && url.pathname.startsWith('/open-apis/bitable/v1/apps/${route.base}/tables/');
  if (!model && !auth && !table) throw new Error('blocked non-fixture HTTP URL');
  return realFetch(process.env.FIXTURE_HTTP + '/proxy?target=' + encodeURIComponent(url.href), options);
};`;

async function fixture(t, statuses, mode = '') {
  const home = mkdtempSync(join(tmpdir(), 'cecelia-activity-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(home, '.local/bin'); mkdirSync(bin, { recursive: true });
  const receiptPath = join(home, 'receipt.json');
  writeFileSync(join(home, 'snapshot-count'), '0');
  writeFileSync(join(home, 'now'), '1000');
  const ssh = `#!/bin/sh
printf 'ssh %s\\n' "$*" >> "$HOME/calls"
case "$*" in
${statuses.map((status, i) => ` *'${ids[i]}'*) result=${status};;`).join('\n')}
 *) exit 97;;
esac
case "$*" in
 *'qualify-video.js discover'*) printf 'QUAL_DISCOVER {"status":"%s","has_transcript":true}\\n' "$result";;
 *'qualify-video.js judge'*) printf 'QUAL_RESULT {"verdict":"%s","kind":"judged"}\\n' "$result";;
 *'qualify-video.js collected'*) echo 'QUAL_COLLECTED {"updated":1}';;
 *) exit 97;;
esac`;
  for (const [name, code] of [
    ['douyin-phone-adb', adb], ['ssh', ssh],
    ['date', '#!/bin/sh\n[ "$1" = +%s ] && { cat "$HOME/now"; exit; }\nexec /bin/date "$@"'],
    ['scp', '#!/bin/sh\necho blocked-non-fixture-network >&2\nexit 97'],
    ['curl', '#!/bin/sh\necho blocked-non-fixture-network >&2\nexit 97'],
  ]) { writeFileSync(join(bin, name), code); chmodSync(join(bin, name), 0o755); }
  const preloadPath = join(home, 'http-fixture.cjs'); writeFileSync(preloadPath, preload);
  const pool = new Map(), leads = new Map(), calls = [], modelCalls = [], persistedEvents = [], errors = [];
  const server = createServer(async (req, res) => {
    const send = (body, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      const local = new URL(req.url, 'http://127.0.0.1');
      assert.equal(local.pathname, '/proxy');
      const url = new URL(local.searchParams.get('target'));
      let text = ''; for await (const chunk of req) text += chunk;
      const body = text ? JSON.parse(text) : undefined;
      const snapshot = JSON.parse(readFileSync(receiptPath, 'utf8'));
      assert.equal(snapshot.last_event.event_type, 'ACTIVITY_STARTED');
      persistedEvents.push(snapshot.last_event);
      if (url.origin === 'https://openrouter.ai') {
        assert.equal(url.pathname, '/api/alpha/decisions');
        assert.equal(req.headers.authorization, 'Bearer fixture-model-key');
        assert.match(body.state, /如何报名/);
        modelCalls.push({ body, event: snapshot.last_event });
        return send({ answers: { grade: { choice: 'A', confidence: 0.95 } } });
      }
      assert.equal(url.origin, 'https://open.feishu.cn');
      calls.push({ method: req.method, url: url.href, body, event: snapshot.last_event });
      if (url.pathname.includes('/auth/')) {
        assert.deepEqual(body, { app_id: 'fixture-app', app_secret: 'fixture-secret' });
        return send({ code: 0, tenant_access_token: 'fixture-token' });
      }
      assert.equal(req.headers.authorization, 'Bearer fixture-token');
      const match = url.pathname.match(/^\/open-apis\/bitable\/v1\/apps\/([^/]+)\/tables\/([^/]+)\/(fields|records)(?:\/([^/]+))?$/);
      assert.ok(match); const [, base, table, resource, encodedId] = match;
      assert.equal(base, route.base); assert.ok([route.pool, route.lead].includes(table));
      const store = table === route.pool ? pool : leads;
      if (resource === 'fields') {
        const names = table === route.pool ? RAW_COMMENT_FIELDS : ['采集时间'];
        return send({ code: 0, data: { items: names.map(field_name => ({ field_name, type: 1 })) } });
      }
      const id = encodedId && decodeURIComponent(encodedId);
      if (req.method === 'GET') {
        if (id) { assert.ok(store.has(id)); return send({ code: 0, data: { record: store.get(id) } }); }
        return send({ code: 0, data: { items: [...store.values()], has_more: false } });
      }
      assert.ok(['POST', 'PUT'].includes(req.method));
      if (req.method === 'PUT') assert.ok(store.has(id));
      else assert.equal(id, undefined);
      const recordId = id || (table === route.pool ? 'pool-' : 'lead-') + (store.size + 1);
      const record = { record_id: recordId, fields: { ...store.get(recordId)?.fields, ...body.fields } };
      store.set(recordId, record); return send({ code: 0, data: { record } });
    } catch (error) { errors.push(error); send({ code: 1, error: 'fixture assertion failed' }, 500); }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  t.after(() => new Promise(done => server.close(done)));
  const env = { HOME: home, PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    NODE_OPTIONS: `--require=${preloadPath}`, FIXTURE_HTTP: `http://127.0.0.1:${server.address().port}`,
    FIXTURE_RECEIPT: receiptPath, HARVEST_KEYWORD_TESTING: '1', WF_BOUNDED_POLL: '0.05',
    FIXTURE_STOP_MODE: mode,
    OPENROUTER_API_KEY: 'fixture-model-key', FEISHU_ACCOUNT: route.account,
    FEISHU_APP_ID: 'fixture-app', FEISHU_APP_SECRET: 'fixture-secret' };
  const input = { run_tag: 'cecelia-cli-smoke', line_key: route.key,
    device: { profile: 'jinoshengyuan-work', serial: 'fixture-serial', lock_holder: 'cecelia-cli-smoke' },
    videos: statuses.map((_, i) => ({ video_id: ids[i], title: `AI课程${i + 1}`, keyword: 'AI 考证', duration: '00:30' })) };
  return { home, env, input, receiptPath, pool, leads, calls, modelCalls, persistedEvents, errors };
}

async function compile(f, withoutScore = false, resume = false) {
  let path = bindingFile;
  if (withoutScore || resume) {
    const bindings = JSON.parse(readFileSync(bindingFile, 'utf8'));
    if (withoutScore) {
      bindings.select = bindings.select.filter(key => key !== 'scoring');
      delete bindings.activities.scoring;
      bindings.activities.delivery.outputs = bindings.activities.delivery.outputs.filter(output => output.type !== 'Lead');
    }
    if (resume) {
      bindings.select = ['scoring', 'delivery'];
      delete bindings.activities.qualification; delete bindings.activities.collection;
      bindings.trigger_inputs = [...new Set([...bindings.trigger_inputs, 'Comment'])];
    }
    path = join(f.home, resume ? 'resume.bindings.json' : 'without-scoring.bindings.json');
    writeFileSync(path, JSON.stringify(bindings));
  }
  const output = await cli(compiler, ['keyword_acquisition', '--json', '--bindings', path, '--allow-missing'],
    { cwd: repo, env: f.env });
  assert.equal(output.code, 0, output.stderr);
  const value = JSON.parse(output.stdout);
  assert.ok(value.contract?.activities?.length, '必须使用真实compiler产物');
  return value.contract;
}

async function run(t, statuses, withoutScore = false) {
  const f = await fixture(t, statuses);
  const contract = await compile(f, withoutScore);
  const output = await cli(resolve(runtime), ['--cwd', service, '--receipt', f.receiptPath], {
    cwd: repo, env: f.env, input: { contract, input: f.input },
  });
  assert.equal(f.errors.length, 0, f.errors.map(error => error.stack).join('\n'));
  assert.equal(output.signal, null, output.stderr);
  const receipt = JSON.parse(output.stdout), persisted = JSON.parse(readFileSync(f.receiptPath, 'utf8'));
  assert.deepEqual(persisted, receipt, '真实CLI最终receipt必须持久化');
  assert.equal(receipt.run_tag, f.input.run_tag);
  return { ...f, contract, output, receipt };
}

function videoOrder(receipt, videos) {
  assert.deepEqual(receipt.activities.filter(activity => ['qualification', 'collection'].includes(activity.key))
    .map(activity => [activity.key, activity.item]), videos.flatMap(id => [['qualification', id], ['collection', id]]));
}

test('跨仓CLI：真实编译与Cecelia执行两视频qual→collect交错，再评分落池配送', optIn, async t => {
  const f = await run(t, ['matched', 'matched']);
  assert.equal(f.output.code, 0, f.output.stderr + '\n' + f.output.stdout); assert.equal(f.receipt.status, 'completed');
  videoOrder(f.receipt, ids.slice(0, 2));
  assert.deepEqual(f.receipt.activities.map(activity => activity.key),
    ['qualification', 'collection', 'qualification', 'collection', 'scoring', 'delivery']);
  assert.ok(f.receipt.activities.every(activity => activity.attempts.length === 1 && activity.status === 'completed'));
  const phoneEvents = readdirSync(f.home).filter(name => /^phone-receipt-\d+\.json$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .map(name => JSON.parse(readFileSync(join(f.home, name), 'utf8')).last_event);
  assert.deepEqual(phoneEvents.map(event => [event.activity, event.item]),
    ids.slice(0, 2).flatMap(id => [['qualification', id], ['collection', id]]));
  assert.ok(phoneEvents.every(event => event.event_type === 'ACTIVITY_STARTED'));
  const events = [...phoneEvents, ...f.persistedEvents];
  assert.ok(events.every((event, i) => i === 0 || event.cursor >= events[i - 1].cursor));
  assert.equal(f.modelCalls.length, 2); assert.ok(f.modelCalls.every(call => call.event.activity === 'scoring'));
  assert.ok(f.calls.every(call => call.event.activity === 'delivery'));
  assert.equal(f.pool.size, 2); assert.equal(f.leads.size, 2);
  const comments = f.receipt.outputs.comments;
  assert.deepEqual(comments.map(row => row.id), ['pool-1', 'pool-2']);
  assert.deepEqual(comments.map(row => row.source_id), ids.slice(0, 2).map(id => `${id}:1`));
  for (const [i, comment] of comments.entries()) {
    assert.equal(comment.verdict.grade, 'A'); assert.equal(comment.delivery_status, 'completed');
    assert.equal(f.pool.get(comment.id).fields.处理状态, '已分拣');
    assert.equal(f.pool.get(comment.id).fields.进入最终线索, true);
    assert.equal(f.leads.get(`lead-${i + 1}`).fields.原始评论, `如何报名${i + 1}`);
    assert.equal(f.leads.get(`lead-${i + 1}`).fields.抖音号, `10${i + 1}`);
  }
});

test('跨仓CLI：仅修改bindings省略评分，两视频仍落池，零模型/线索访问', optIn, async t => {
  const f = await run(t, ['matched', 'matched'], true);
  assert.equal(f.output.code, 0, f.output.stderr + '\n' + f.output.stdout); assert.equal(f.receipt.status, 'completed');
  videoOrder(f.receipt, ids.slice(0, 2));
  assert.ok(f.receipt.activities.every(activity => activity.key !== 'scoring'));
  assert.equal(f.modelCalls.length, 0); assert.equal(f.leads.size, 0); assert.equal(f.pool.size, 2);
  assert.ok(f.calls.every(call => !call.url.includes(`/tables/${route.lead}/`)));
  assert.deepEqual(f.receipt.outputs.comments.map(row => row.id), ['pool-1', 'pool-2']);
  assert.ok(f.receipt.outputs.comments.every(row => row.verdict === undefined && row.delivery_status === 'unscored'));
  assert.ok([...f.pool.values()].every(record => record.fields.处理状态 === '待分拣'));
});

test('跨仓CLI：rejected/pending真实资格结果阻止采集，已采matched评论继续配送', optIn, async t => {
  const f = await run(t, ['matched', 'rejected', 'pending']);
  assert.equal(f.output.code, 2, f.output.stderr + '\n' + f.output.stdout); assert.equal(f.receipt.status, 'partial');
  videoOrder(f.receipt, ids);
  for (const id of ids.slice(1)) {
    const activity = f.receipt.activities.find(row => row.key === 'collection' && row.item === id);
    assert.equal(activity.status, 'skipped'); assert.equal(activity.attempts.length, 0);
  }
  assert.equal(f.receipt.outputs.videos[1].judgment_status, 'rejected');
  assert.equal(f.receipt.outputs.videos[2].judgment_status, 'pending');
  assert.equal(f.pool.size, 1); assert.equal(f.leads.size, 1); assert.equal(f.modelCalls.length, 1);
  const phone = readFileSync(join(f.home, 'calls'), 'utf8');
  assert.equal((phone.match(/adb collect-comments/g) || []).length, 1);
});

test('跨仓CLI：真实采集预算边界保留首条评论，继续评分落池，未采行不得结算', optIn, async t => {
  const f = await fixture(t, ['matched'], 'budget');
  const contract = await compile(f);
  contract.activities.find(activity => activity.key === 'collection').budget.max_duration_s = 5;
  const output = await cli(resolve(runtime), ['--cwd', service, '--receipt', f.receiptPath], {
    cwd: repo, env: f.env, input: { contract, input: f.input },
  });
  assert.equal(f.errors.length, 0, f.errors.map(error => error.stack).join('\n'));
  assert.equal(output.code, 2, output.stderr + '\n' + output.stdout);
  const receipt = JSON.parse(readFileSync(f.receiptPath, 'utf8'));
  assert.deepEqual(receipt, JSON.parse(output.stdout)); assert.equal(receipt.status, 'partial');
  const attempt = receipt.activities.find(activity => activity.key === 'collection').attempts[0];
  assert.equal(attempt.status, 'partial'); assert.equal(attempt.reason_code, 'budget_exceeded');
  assert.equal(attempt.outputs.comments.length, 1); assert.equal(attempt.metrics.videos_processed, 0);
  assert.equal(f.pool.size, 1); assert.equal(f.leads.size, 1); assert.equal(f.modelCalls.length, 1);
  assert.equal(receipt.outputs.comments[0].delivery_status, 'completed');
  assert.equal(f.leads.get('lead-1').fields.原始评论, '如何报名1');
  const phone = readFileSync(join(f.home, 'calls'), 'utf8');
  assert.match(phone, /lock-release cecelia-cli-smoke/);
  assert.doesNotMatch(phone, /commenter-identity 30 40|qualify-video.js collected/);
});

test('跨仓CLI：父取消保留真实采集产物和释放锁，持久receipt可经编译恢复链落池', optIn, async t => {
  const f = await fixture(t, ['matched'], 'cancel');
  const contract = await compile(f);
  const interrupted = await cli(resolve(runtime), ['--cwd', service, '--receipt', f.receiptPath], {
    cwd: repo, env: f.env, input: { contract, input: f.input }, cancelWhen: join(f.home, 'cancel-ready'),
  });
  assert.equal(interrupted.signal, null, interrupted.stderr);
  assert.ok([1, 2].includes(interrupted.code), interrupted.stdout);
  const saved = JSON.parse(readFileSync(f.receiptPath, 'utf8'));
  assert.deepEqual(saved, JSON.parse(interrupted.stdout)); assert.equal(saved.status, 'partial');
  const collection = saved.activities.find(activity => activity.key === 'collection');
  assert.equal(collection.status, 'partial'); assert.equal(collection.attempts[0].outputs.comments.length, 1);
  assert.equal(collection.attempts[0].metrics.videos_processed, 0);
  assert.equal(saved.outputs.comments.length, 1); assert.equal(saved.outputs.comments[0].fields.评论原文, '如何报名1');
  assert.ok(saved.activities.every(activity => !['scoring', 'delivery'].includes(activity.key)));
  assert.equal(f.pool.size, 0); assert.equal(f.modelCalls.length, 0);
  const phone = readFileSync(join(f.home, 'calls'), 'utf8');
  assert.match(phone, /lock-release cecelia-cli-smoke/);
  assert.doesNotMatch(phone, /commenter-identity 30 40|qualify-video.js collected/);
  const resumeContract = await compile(f, false, true);
  const output = await cli(resolve(runtime), ['--cwd', service, '--receipt', f.receiptPath], {
    cwd: repo, env: f.env, input: { contract: resumeContract, input: { ...f.input, comments: saved.outputs.comments } },
  });
  assert.equal(f.errors.length, 0, f.errors.map(error => error.stack).join('\n'));
  assert.equal(output.code, 0, output.stderr + '\n' + output.stdout);
  const restored = JSON.parse(readFileSync(f.receiptPath, 'utf8'));
  assert.deepEqual(restored, JSON.parse(output.stdout)); assert.equal(restored.status, 'completed');
  assert.deepEqual(restored.activities.map(activity => activity.key), ['scoring', 'delivery']);
  assert.equal(restored.outputs.comments[0].source_id, `${ids[0]}:1`);
  assert.equal(restored.outputs.comments[0].id, 'pool-1');
  assert.equal(f.pool.size, 1); assert.equal(f.leads.size, 1); assert.equal(f.modelCalls.length, 1);
  assert.equal(f.pool.get('pool-1').fields.处理状态, '已分拣');
  assert.equal(f.leads.get('lead-1').fields.原始评论, '如何报名1');
});
