#!/usr/bin/env node
'use strict';
const { runBatchActivity } = require('./batch-activities.js');

async function main(action, stream = process.stdin) {
  let input;
  try {
    let text = '';
    for await (const chunk of stream) {
      text += chunk;
      if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('输入过大');
    }
    input = JSON.parse(text);
    const result = await runBatchActivity(action, input);
    process.stdout.write(JSON.stringify(result) + '\n');
    return result.status === 'completed' ? 0 : result.status === 'partial' ? 2 : 1;
  } catch (_) {
    process.stdout.write(JSON.stringify({ schema_version: 1, run_tag: input?.run_tag || null,
      line_key: input?.line_key || null, status: 'failed', failure_class: 'fatal', reason_code: 'invalid_input',
      outputs: {}, metrics: {}, evidence: [] }) + '\n');
    return 1;
  }
}
if (require.main === module) main(process.argv[2]).then(code => { process.exitCode = code; });
module.exports = { main };
