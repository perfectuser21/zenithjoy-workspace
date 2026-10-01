#!/usr/bin/env node
'use strict';

// 独立进程协议：stdin 一个 JSON 输入对象，stdout 一个 JSON 结果对象。
// node comment-activity.js scoring|delivery
// delivery 当前结算已落池ID；原始评论持久化由独立落池单元承接。
const { scoreComments, deliverComments, validateInput } = require('./comment-activities.js');

async function main(action, stream = process.stdin) {
  let input;
  let phase = 'input';
  try {
    let text = '';
    for await (const chunk of stream) {
      text += chunk;
      if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('活动输入过大');
    }
    input = JSON.parse(text);
    validateInput(input);
    let result;
    if (action === 'scoring') {
      result = await scoreComments(input);
    } else if (action === 'delivery') {
      phase = 'storage';
      const deps = input.comments.some(row => row.verdict)
        ? await require('./comment-delivery-storage.js').createDeliveryDeps(input) : {};
      result = await deliverComments(input, deps);
    } else {
      phase = 'input';
      throw new Error('未知活动');
    }
    process.stdout.write(JSON.stringify(result) + '\n');
    return result.status === 'completed' ? 0 : result.status === 'partial' ? 2 : 1;
  } catch (_) {
    process.stdout.write(JSON.stringify({ schema_version: 1,
      run_tag: input && input.run_tag || null, line_key: input && input.line_key || null,
      status: 'failed', failure_class: phase === 'storage' ? 'retryable' : 'fatal',
      reason_code: phase === 'storage' ? 'storage_unavailable' : 'invalid_input',
      outputs: { comments: [] }, metrics: {}, evidence: [],
    }) + '\n');
    return 1;
  }
}

if (require.main === module) main(process.argv[2]).then(code => { process.exitCode = code; });
module.exports = { main };
