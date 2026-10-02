'use strict';
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

module.exports = { validateReceipt };
