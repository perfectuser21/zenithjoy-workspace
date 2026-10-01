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


export { fixture, cli, ids, route, service, repo, compiler };
