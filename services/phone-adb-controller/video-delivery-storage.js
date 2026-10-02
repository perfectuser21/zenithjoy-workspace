'use strict';

const { routeOf } = require('./line-routes.js');
const { txt } = require('./sort-comments-lib.js');
const refusal = (message, reason_code) => Object.assign(new Error(message), { failure_class: 'fatal', reason_code });

// 凭证只由 matched 单视频采集成功的原生 VIDEO 行产生；发现对象不代表评论已采。
function validateReceipt(video, batch) {
  const receipt = video.collection_receipt;
  let url;
  try { url = new URL(receipt?.url); } catch (_) { /* 下方统一拒绝 */ }
  if (video.judgment_status !== 'matched' || !/^\d{16,24}$/.test(video.video_id || '')
    || !receipt || receipt.video_id !== video.video_id || receipt.batch !== batch
    || receipt.title !== video.title || receipt.keyword !== video.keyword
    || !Number.isSafeInteger(receipt.comment_count) || receipt.comment_count < 1
    || !url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || /\s/.test(receipt.url)) throw refusal('视频采集凭证与显式视频不符', 'video_collection_receipt_invalid');
  return receipt;
}

function videoFields(receipt, now) {
  return { 视频ID: receipt.video_id, 视频链接: { link: receipt.url, text: receipt.url },
    '视频标题/文案': receipt.title, 命中关键词: receipt.keyword, 评论数: receipt.comment_count,
    发现时间: now, 处理状态: '评论已采', 采收批次: receipt.batch };
}

async function createVideoDeliveryDeps(input, { env = process.env, request = fetch } = {}) {
  const route = routeOf(input.line_key);
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) throw new Error('视频配送缺飞书凭据');
  if (env.FEISHU_ACCOUNT !== route.account) throw refusal('视频配送账号与业务线不符', 'account_mismatch');
  if (!route.video) throw refusal('该业务线没有视频池', 'video_pool_not_configured');
  const send = async (url, method = 'GET', body, token) => {
    let response;
    try { response = await request(url, { method, signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch (_) { throw new Error('视频配送 HTTP 请求失败'); }
    if (!response?.ok) throw new Error('视频配送 HTTP 请求失败');
    let result;
    try { result = await response.json(); } catch (_) { throw new Error('视频配送响应未读回'); }
    if (!result || result.code !== 0) throw new Error('视频配送未确认操作成功');
    return result;
  };
  const auth = await send('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', 'POST', {
    app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET });
  if (!auth.tenant_access_token) throw new Error('视频配送认证未返回 token');
  const feishu = (suffix, method, body) => send(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${route.base}/tables/${route.video}${suffix}`,
    method, body, auth.tenant_access_token);
  const seen = new Map(), cursors = new Set(); let cursor = '';
  do {
    const page = await feishu(`/records?page_size=100${cursor ? '&page_token=' + encodeURIComponent(cursor) : ''}`);
    if (!Array.isArray(page.data?.items) || typeof page.data.has_more !== 'boolean') throw new Error('视频去重表或分页终态未读回');
    for (const row of page.data.items) {
      if (!row?.fields || typeof row.record_id !== 'string' || !row.record_id.trim()) throw new Error('视频去重记录未读回');
      const id = txt(row.fields.视频ID);
      if (id) seen.set(id, row.record_id);
    }
    cursor = page.data.has_more ? page.data.page_token : '';
    if (page.data.has_more && (typeof cursor !== 'string' || !cursor || cursors.has(cursor))) throw new Error('视频去重分页未推进');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return { seen, now: new Date(Date.now() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) + '(UTC+8)',
    postVideo: fields => feishu('/records', 'POST', { fields }) };
}

async function deliverVideos(input, options = {}) {
  const route = routeOf(input.line_key);
  if (input.videos !== undefined && (!Array.isArray(input.videos)
    || input.videos.some(video => !video || typeof video !== 'object' || Array.isArray(video)))) return {
    outputs: { videos: [], pending_videos: [] },
    metrics: { videos_written: 0, videos_duplicates: 0, videos_pending: 0, videos_skipped: 0 },
    evidence: [{ status: 'failed', reason_code: 'invalid_video_delivery_input', failure_class: 'fatal' }],
    failure_class: 'fatal', reason_code: 'invalid_video_delivery_input',
  };
  const videos = structuredClone(input.videos || []), pending_videos = [], evidence = [];
  const metrics = { videos_written: 0, videos_duplicates: 0, videos_pending: 0, videos_skipped: 0 };
  const eligible = videos.filter(video => video.collection_receipt !== undefined);
  let deps, setupError, fatal = false, reason_code;
  try {
    for (const video of eligible) validateReceipt(video, input.run_tag);
    if (eligible.length && route.video) deps = options.videoDeps || await (options.createVideoDeliveryDeps || createVideoDeliveryDeps)(input);
  } catch (error) { setupError = error; }
  for (const video of videos) {
    if (video.collection_receipt === undefined || !route.video) {
      metrics.videos_skipped++;
      video.video_delivery_status = 'skipped';
      evidence.push({ video_id: video.video_id, status: 'skipped',
        reason_code: route.video ? 'collection_not_confirmed' : 'video_pool_not_configured' });
      continue;
    }
    try {
      if (setupError) throw setupError;
      let recordId = deps.seen.get(video.video_id);
      if (recordId) metrics.videos_duplicates++;
      else {
        const result = await deps.postVideo(videoFields(video.collection_receipt, deps.now));
        recordId = result?.data?.record?.record_id;
        if (result?.code !== 0 || typeof recordId !== 'string' || !recordId.trim()) throw new Error('视频写入未返回真实 record_id');
        deps.seen.set(video.video_id, recordId);
        metrics.videos_written++;
      }
      video.video_pool_record_id = recordId;
      video.video_delivery_status = 'completed';
      evidence.push({ video_id: video.video_id, record_id: recordId, status: 'completed' });
    } catch (error) {
      video.video_delivery_status = 'pending';
      pending_videos.push(video); metrics.videos_pending++;
      fatal ||= error.failure_class === 'fatal'; reason_code ||= error.reason_code || 'video_storage_unavailable';
      evidence.push({ video_id: video.video_id, status: 'pending', failure_class: error.failure_class || 'retryable',
        reason_code: error.reason_code || 'video_storage_unavailable' });
    }
  }
  return { outputs: { videos, pending_videos }, metrics, evidence, failure_class: metrics.videos_pending ? (fatal ? 'fatal' : 'retryable') : null,
    ...(reason_code ? { reason_code } : {}) };
}
module.exports = { validateReceipt, videoFields, createVideoDeliveryDeps, deliverVideos };
