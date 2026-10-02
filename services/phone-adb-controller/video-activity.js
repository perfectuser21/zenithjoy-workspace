#!/usr/bin/env node
'use strict';
const { runVideoActivity } = require('./video-activities.js');
async function main(action, stream = process.stdin) {
  let input;
  try {
    stream.setEncoding?.('utf8');
    let text = '';
    for await (const chunk of stream) {
      text += chunk;
      if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('输入过大');
    }
    input = JSON.parse(text);
    const result = await runVideoActivity(action, input);
    process.stdout.write(JSON.stringify(result) + '\n');
    return result.status === 'completed' ? 0 : result.status === 'partial' ? 2 : 1;
  } catch (_) {
    process.stdout.write(JSON.stringify({ schema_version: 1, run_tag: input && input.run_tag || null,
      line_key: input && input.line_key || null, status: 'failed', failure_class: 'fatal', reason_code: 'invalid_input',
      outputs: { videos: [], comments: [] }, metrics: {}, evidence: [] }) + '\n');
    return 1;
  }
}
if (require.main === module) main(process.argv[2]).then(code => { process.exitCode = code; });
module.exports = { main };
