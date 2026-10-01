'use strict';
const { validateDeliveryInput, deliverComments } = require('./comment-activities.js');
const { persistRawComments } = require('./raw-comment-activities.js');

// 配送业务的两个存储步骤；可选评分由调用方交入，不调用模型、不扫描池评分。
async function deliverRawComments(input, options = {}) {
  validateDeliveryInput(input);
  const persistDeps = options.persistDeps || (input.comments.length
    ? await require('./raw-comment-storage.js').createRawCommentDeps(input) : {});
  const persisted = await persistRawComments(input, persistDeps);
  const payload = { ...input, comments: persisted.outputs.comments };
  let settled;
  try {
    const createDeliveryDeps = options.createDeliveryDeps
      || require('./comment-delivery-storage.js').createDeliveryDeps;
    const context = payload.comments.some(row => row.verdict) ? await createDeliveryDeps(payload) : {};
    settled = await deliverComments(payload, context);
  } catch (error) {
    settled = { status: 'failed', failure_class: error.failure_class || 'retryable',
      reason_code: error.reason_code || 'storage_unavailable',
      outputs: { comments: payload.comments.map(row => ({ ...row, delivery_status: row.verdict ? 'pending' : 'unscored' })) },
      metrics: { leads_written: 0, duplicates_highlighted: 0,
        pending: payload.comments.filter(row => row.verdict).length,
        unscored: payload.comments.filter(row => !row.verdict).length },
      evidence: payload.comments.map(row => ({ comment_id: row.id, status: row.verdict ? 'pending' : 'unscored',
        ...(row.verdict ? { failure_class: error.failure_class || 'retryable' } : {}) })) };
  }
  const metrics = { ...persisted.metrics, ...settled.metrics,
    pending: persisted.metrics.pending + settled.metrics.pending };
  const fatal = persisted.failure_class === 'fatal' || settled.failure_class === 'fatal';
  const completed = settled.outputs.comments.some(row => ['completed', 'unscored'].includes(row.delivery_status));
  return { schema_version: 1, run_tag: input.run_tag, line_key: persisted.line_key,
    status: metrics.pending ? (completed ? 'partial' : 'failed') : 'completed',
    failure_class: metrics.pending ? (fatal ? 'fatal' : 'retryable') : null,
    ...(settled.reason_code ? { reason_code: settled.reason_code } : {}),
    outputs: { comments: settled.outputs.comments, pending_comments: persisted.outputs.pending_comments },
    metrics, evidence: [
      ...persisted.evidence.map(item => ({ ...item, step: 'persist' })),
      ...settled.evidence.map(item => ({ ...item, step: 'settlement' })),
    ] };
}
module.exports = { deliverRawComments };
