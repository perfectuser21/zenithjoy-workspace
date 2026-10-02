import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const activities = require('../comment-activities.js');
const raw = require('../raw-comment-activities.js');
const { createRawCommentDeps } = require('../raw-comment-storage.js');
const { createDeliveryDeps } = require('../comment-delivery-storage.js');
const { runLegacyPush } = require('../push-raw-comments.js');
const route = require('../line-routes.js').routeOf('jinuo');
const env = { FEISHU_ACCOUNT: route.account, FEISHU_APP_ID: 'fixture-app', FEISHU_APP_SECRET: 'fixture-secret' };
const config = { channels: { feishu: { accounts: { [route.account]: { appId: env.FEISHU_APP_ID, appSecret: env.FEISHU_APP_SECRET } } } } };
const tsv = [
  ['客户', '123', '如何报名', '课程一'],
  ['客户', '123', '还想了解费用', '课程二'],
  ['同行', '456', '广告合作', '课程三'],
].map(([nick, id, text, title]) => ['LEAD', nick, id, '个人', text, '今天', '北京', title,
  'AI考证', '北京', 'https://example.com/user/' + id, 'https://example.com/video/' + title].join('\t')).join('\n');
const batch = () => raw.harvestTsvInput(tsv, { run_tag: 'equivalence', line_key: route.key });
const judge = async text => text === '广告合作'
  ? { grade: '不相关', relevance: '不相关', reason: '同行广告' }
  : { grade: 'A', relevance: '相关', reason: '询问报名' };

// 两链拥有独立账本，只替换HTTP运输；业务转换、评分、去重、落池和结算使用真实入口。
function remote() {
  const pool = new Map(), leads = new Map(), writes = [];
  const request = async (url, opts) => {
    assert.ok(url.startsWith('https://open.feishu.cn/'), '禁止真实外网请求');
    let body;
    if (url.includes('/auth/')) body = { code: 0, tenant_access_token: 'fixture-token' };
    else if (url.includes('/fields')) body = { code: 0, data: { items: raw.RAW_COMMENT_FIELDS.map(field_name => ({ field_name, type: field_name === '采集时间' ? 5 : 1 })) } };
    else {
      assert.ok(url.includes(`/tables/${route.pool}/`) || url.includes(`/tables/${route.lead}/`));
      const isPool = url.includes(`/tables/${route.pool}/`), store = isPool ? pool : leads;
      const id = new URL(url).pathname.match(/\/records\/([^/]+)$/)?.[1];
      if (opts.method === 'GET') body = { code: 0, data: id
        ? { record: structuredClone(store.get(id)) }
        : { items: structuredClone([...store.values()]), has_more: false } };
      else {
        assert.ok(opts.method === 'POST' || opts.method === 'PUT');
        const fields = JSON.parse(opts.body).fields;
        const recordId = opts.method === 'POST' ? `${isPool ? 'pool' : 'lead'}-${store.size + 1}` : id;
        assert.ok(recordId);
        const record = { record_id: recordId, fields: { ...store.get(recordId)?.fields, ...fields } };
        store.set(recordId, record);
        writes.push({ isPool, method: opts.method, recordId, fields: structuredClone(fields) });
        body = { code: 0, data: { record: structuredClone(record) } };
      }
    }
    return { ok: true, json: async () => body };
  };
  return { pool, leads, writes, request };
}

async function legacySort(state) {
  const logs = [];
  const sandbox = vm.createContext({
    require: name => name === 'fs' ? { readFileSync: () => JSON.stringify(config) }
      : name === './comment-activities.js' ? { ...activities,
        scoreComments: input => activities.scoreComments(input, { judge }),
      } : require('../' + name.replace(/^\.\//, '')),
    process: { argv: ['node', 'sort-comments.js', route.key], env: { WFR_TAG: 'equivalence' } },
    fetch: state.request, Map, Set, Date,
    console: { log: (...args) => logs.push(args.join(' ')), error() {} },
  });
  await vm.runInContext(readFileSync(new URL('../sort-comments.js', import.meta.url), 'utf8'), sandbox);
  const line = logs.find(line => line.startsWith('SORT_STATS '));
  assert.ok(line, '真实旧分拣入口必须返回统计');
  return JSON.parse(line.slice('SORT_STATS '.length));
}

for (const withScore of [true, false]) {
  test(`同固定评论输入旧新直接对账：${withScore ? '评分、无关排除、重复高亮及重放' : '去评分仅落待分拣池'}`, async t => {
    t.mock.method(Date, 'now', () => 1790937600000);
    const old = remote(), current = remote();
    const legacyPush = await runLegacyPush(tsv, 'equivalence', route.key, {
      config, request: old.request, log() {}, error() {},
    });
    assert.equal(legacyPush.exitCode, 0);
    let input = batch(), scored;
    if (withScore) {
      scored = await activities.scoreComments(input, { judge });
      assert.equal(scored.status, 'completed');
      assert.equal(scored.metrics.comments_scored, 3);
      input = { ...input, comments: scored.outputs.comments };
    }
    const persisted = await raw.persistRawComments(input, await createRawCommentDeps(input, { env, request: current.request }));
    assert.deepEqual(persisted.metrics, legacyPush.result.metrics);
    const deliveryInput = { ...input, comments: persisted.outputs.comments };
    const delivered = await activities.deliverComments(deliveryInput,
      await createDeliveryDeps(deliveryInput, { env, request: current.request }));
    assert.equal(delivered.status, 'completed');
    if (withScore) {
      const stats = await legacySort(old);
      assert.equal(stats.judged, scored.metrics.comments_scored);
      assert.equal(stats.moved, delivered.metrics.leads_written);
      assert.equal(stats.duped, delivered.metrics.duplicates_highlighted);
      assert.deepEqual(stats.grades, scored.metrics.grades);
      assert.equal(old.leads.size, 1);
      assert.equal(old.leads.get('lead-1').fields.重复命中次数, 1);
      assert.equal(old.pool.get('pool-3').fields.进入最终线索, false);
    } else {
      assert.equal(old.leads.size, 0);
      assert.ok([...old.pool.values()].every(row => row.fields.处理状态 === '待分拣'));
      assert.equal(delivered.metrics.unscored, 3);
    }
    assert.deepEqual([...current.pool.values()], [...old.pool.values()], '全部池字段直接相等，不删除时间或判定字段');
    assert.deepEqual([...current.leads.values()], [...old.leads.values()], '全部线索字段及凭证直接相等');
    const oldWrites = old.writes.length, newWrites = current.writes.length;
    const replayOld = await runLegacyPush(tsv, 'equivalence', route.key, {
      config, request: old.request, log() {}, error() {},
    });
    const replayNew = await raw.persistRawComments(input, await createRawCommentDeps(input, { env, request: current.request }));
    assert.deepEqual(replayNew.metrics, replayOld.result.metrics);
    if (withScore) await legacySort(old);
    const replayInput = { ...input, comments: replayNew.outputs.comments };
    await activities.deliverComments(replayInput, await createDeliveryDeps(replayInput, { env, request: current.request }));
    assert.equal(old.writes.length, oldWrites);
    assert.equal(current.writes.length, newWrites);
    assert.deepEqual([...current.pool.values()], [...old.pool.values()]);
    assert.deepEqual([...current.leads.values()], [...old.leads.values()]);
  });
}
