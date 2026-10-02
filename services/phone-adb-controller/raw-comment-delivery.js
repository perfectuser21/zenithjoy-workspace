'use strict';
const { validateDeliveryInput, deliverComments } = require('./comment-activities.js');
const { persistRawComments } = require('./raw-comment-activities.js');

// 配送业务的显式视频/评论存储步骤；可选评分由调用方交入，不调用模型、不扫描池评分。
async function deliverRawComments(input, options = {}) {
  validateDeliveryInput(input);
  const videos = await require('./video-delivery-storage.js').deliverVideos(input, options);
  let persisted;
  try {
    const persistDeps = options.persistDeps || (input.comments.length
      ? await require('./raw-comment-storage.js').createRawCommentDeps(input) : {});
    persisted = await persistRawComments(input, persistDeps);
  } catch (error) {
    persisted = { line_key: require('./line-routes.js').routeOf(input.line_key).key,
      failure_class: error.failure_class || 'retryable', reason_code: error.reason_code || 'storage_unavailable',
      outputs: { comments: [], pending_comments: structuredClone(input.comments) },
      metrics: { comments_written: 0, duplicates: 0, pending: input.comments.length },
      evidence: input.comments.map(row => ({ comment_id: row.id, status: 'pending',
        failure_class: error.failure_class || 'retryable' })) };
  }
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
  const metrics = { ...persisted.metrics, ...settled.metrics, ...videos.metrics,
    pending: persisted.metrics.pending + settled.metrics.pending };
  const fatal = persisted.failure_class === 'fatal' || settled.failure_class === 'fatal' || videos.failure_class === 'fatal';
  const unresolved = metrics.pending + metrics.videos_pending > 0 || Boolean(videos.failure_class);
  const completed = videos.outputs.videos.some(row => row.video_delivery_status === 'completed') || settled.outputs.comments.some(row => ['completed', 'unscored'].includes(row.delivery_status));
  return { schema_version: 1, run_tag: input.run_tag, line_key: persisted.line_key,
    status: unresolved ? (completed ? 'partial' : 'failed') : 'completed',
    failure_class: unresolved ? (fatal ? 'fatal' : 'retryable') : null,
    ...((videos.reason_code || persisted.reason_code || settled.reason_code) ? { reason_code: videos.reason_code || persisted.reason_code || settled.reason_code } : {}),
    outputs: { comments: settled.outputs.comments, pending_comments: persisted.outputs.pending_comments,
      ...(input.videos === undefined ? {} : videos.outputs) },
    metrics, evidence: [
      ...videos.evidence.map(item => ({ ...item, step: 'video-persist' })),
      ...persisted.evidence.map(item => ({ ...item, step: 'persist' })),
      ...settled.evidence.map(item => ({ ...item, step: 'settlement' })),
    ] };
}
module.exports = { deliverRawComments };
