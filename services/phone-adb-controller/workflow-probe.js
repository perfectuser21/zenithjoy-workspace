#!/usr/bin/env node
'use strict';

// gateway读回入口；输入只含run/业务线/阶段/指标，不携带凭据。
async function main(stream = process.stdin, argv = process.argv.slice(2)) {
  let pool;
  try {
    stream.setEncoding?.('utf8');
    let text = '';
    for await (const chunk of stream) {
      text += chunk;
      if (Buffer.byteLength(text) > 1024 * 1024) throw Error('probe_input_overflow');
    }
    const input = JSON.parse(text);
    if (!/^[a-zA-Z0-9_.-]{1,96}$/.test(input.run_tag || '')) throw Error('invalid_probe_run');
    const line = require('./line-routes.js').routeOf(input.line_key).key;
    const { checksDocument, checksDigest } = await import('./workflow-probes.mjs');
    const { runProbes } = await import('./verify-step.mjs');
    const doc = checksDocument();
    if (!doc.probes.some(p => p.stage === input.stage)) throw Error('invalid_probe_stage');
    let deps = {};
    if (argv.length) {
      if (argv.length !== 2 || argv[0] !== '--deps') throw Error('invalid_probe_argument');
      deps = (await import(require('node:url').pathToFileURL(require('node:path').resolve(argv[1])).href)).default;
    } else {
      // 无凭据时返回unknown；不回退读取工具私有配置。
      deps.feishuCreds = () => {
        if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) throw Error('explicit_feishu_credentials_required');
        return { appId: process.env.FEISHU_APP_ID, appSecret: process.env.FEISHU_APP_SECRET };
      };
      if (doc.probes.some(p => p.stage === input.stage && p.probe.type === 'sql')) {
        if (process.env.DATABASE_URL || process.env.PGDATABASE) {
          pool = require('./leadgen-db-connect.js').getPool(); deps.pool = pool;
        } else deps.pool = { query: async () => { throw Error('explicit_database_configuration_required'); } };
      }
    }
    const out = await runProbes({ doc, stage: input.stage,
      params: { runTag: input.run_tag, lineKey: line, word: input.word || '', metrics: input.metrics || {} },
      deps, timeoutMs: 15000 });
    // 外部错误只保留分类；不把连接串或响应凭据带回手机与账本。
    for (const probe of out.probes) if (probe.error) probe.error = 'probe_readback_unavailable';
    process.stdout.write(JSON.stringify({ ...out, checks_sha256: checksDigest() }) + '\n');
    return 0;
  } catch {
    process.stdout.write(JSON.stringify({ probes: [], error: 'invalid_probe_request' }) + '\n');
    return 1;
  } finally { if (pool) await pool.end().catch(() => {}); }
}

if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { main };
