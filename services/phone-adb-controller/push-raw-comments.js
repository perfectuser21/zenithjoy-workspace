// push-raw-comments.js <harvest_tsv> <运行批次> <业务线> —— 旧手机采收兼容入口。
// 新显式活动与存储适配器不读取该配置；旧CLI仍在main中读取原配置。
'use strict';

const { routeOf } = require('./line-routes.js');
const { statsLine } = require('./stats-line.js');
const { pushAllFailed } = require('./push-stats-lib.js');
const { persistRawComments, harvestTsvInput } = require('./raw-comment-activities.js');
const { createRawCommentDeps } = require('./raw-comment-storage.js');

async function runLegacyPush(tsv, batch, line, {
  config, request = fetch, log = console.log, error = console.error,
} = {}) {
  const route = routeOf(line);
  if (!route.base || !route.pool) {
    error('line-route: pool 表未配置(业务线=' + line + '),跳过');
    return { result: null, exitCode: 0 };
  }
  const account = config && config.channels && config.channels.feishu
    && config.channels.feishu.accounts && config.channels.feishu.accounts[route.account];
  if (!account) throw new Error('旧落池入口缺业务线账号配置');
  error(`line-route: ${route.key} base=${route.base} POOL=${route.pool}`);
  const input = harvestTsvInput(tsv, { run_tag: batch || 'manual', line_key: line });
  const deps = await createRawCommentDeps(input, { request, env: {
    FEISHU_ACCOUNT: route.account, FEISHU_APP_ID: account.appId, FEISHU_APP_SECRET: account.appSecret,
  } });
  const result = await persistRawComments(input, deps);
  const created = result.metrics.comments_written, dup = result.metrics.duplicates;
  for (const item of result.evidence.filter(item => item.status === 'pending')) {
    log(`FAIL ${item.source_id} ${item.failure_class}`);
  }
  log(`落池 ${created} | 去重 ${dup} | 输入 ${input.comments.length}`);
  log(statsLine('PUSH_COMMENTS_STATS', { created, dup, input: input.comments.length }));
  const allFailed = pushAllFailed(created, dup, input.comments.length);
  if (allFailed) error(`评论落池全部失败(${input.comments.length - dup}条新评论0条成功) — 不再继续`);
  return { result, exitCode: allFailed ? 1 : 0 };
}

if (require.main === module) {
  const fs = require('fs');
  const [,, tsv, batch, line] = process.argv;
  (async () => {
    const config = JSON.parse(fs.readFileSync('/Users/administrator/.openclaw/clawdbot.json', 'utf8'));
    const outcome = await runLegacyPush(fs.readFileSync(tsv, 'utf8'), batch, line, { config });
    process.exitCode = outcome.exitCode;
  })().catch(() => {
    // HTTP、配置解析异常可能含敏感上下文，兼容入口只输出固定失败提示。
    console.error('评论落池初始化失败，请检查输入、路由或飞书配置');
    process.exitCode = 1;
  });
}

module.exports = { runLegacyPush };
