'use strict';
const path = require('node:path');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { routeOf } = require('./line-routes.js');
const execute = promisify(execFile);

function validateVideoInput(input) {
  if (!input || !/^[a-zA-Z0-9_.-]{1,96}$/.test(input.run_tag || '')) throw new Error('run标识非法');
  const route = routeOf(input.line_key);
  const device = input.device;
  if (!device || !route.profiles.includes(device.profile)
    || typeof device.serial !== 'string' || !device.serial.trim()
    || !/^[a-zA-Z0-9_.-]{1,96}$/.test(device.lock_holder || '')
    || device.lock_holder.replace(/-w\d+$/, '') !== input.run_tag.replace(/-w\d+$/, '')) {
    throw new Error('设备或锁上下文与本run/业务线不符');
  }
  const video = input.video;
  if (!video || !/^\d{16,24}$/.test(video.video_id || '') || typeof video.title !== 'string') {
    throw new Error('缺少显式视频身份和标题');
  }
  if (video.judgment_status !== undefined && !['pending', 'matched', 'rejected'].includes(video.judgment_status)) {
    throw new Error('视频判定状态非法');
  }
  if (input.budget && (!Number.isSafeInteger(input.budget.max_duration_s) || input.budget.max_duration_s < 0)) {
    throw new Error('活动预算非法');
  }
  if (input.return_to_results !== undefined && typeof input.return_to_results !== 'boolean') {
    throw new Error('归位开关非法');
  }
  if (input.return_to_results === true && (typeof video.keyword !== 'string' || !video.keyword.trim())) {
    throw new Error('归位需要显式关键词');
  }
  return route;
}

async function runPhone(action, input) {
  // 程序执行器只向活动根进程发TERM；手机动作做完后在业务安全边界收工。
  const cancellation = mkdtempSync(path.join(tmpdir(), 'video-activity-stop-'));
  const stopFile = path.join(cancellation, 'requested');
  const stop = () => writeFileSync(stopFile, '', { mode: 0o600 });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    return await execute('zsh', [path.join(__dirname, 'video-phone-activity.sh'), action, input.device.profile,
      routeOf(input.line_key).key, input.video.video_id, Buffer.from(input.video.title).toString('base64'),
      input.video.duration || '', input.run_tag, encodeURIComponent(input.video.keyword || ''),
      String(input.budget ? input.budget.max_duration_s : 0), input.device.serial, input.device.lock_holder,
      String(input.return_to_results === true)],
    { maxBuffer: 16 * 1024 * 1024, env: { ...process.env, VIDEO_ACTIVITY_STOP_FILE: stopFile } });
  } finally {
    process.off('SIGTERM', stop); process.off('SIGINT', stop);
    rmSync(cancellation, { recursive: true, force: true });
  }
}

async function runVideoActivity(action, input, { run = runPhone } = {}) {
  const route = validateVideoInput(input);
  if (!['qualification', 'collection'].includes(action)) throw new Error('未知视频活动');
  const video = structuredClone(input.video);
  delete video.collection_receipt;
  const result = { schema_version: 1, run_tag: input.run_tag, line_key: route.key,
    status: 'completed', failure_class: null, outputs: { videos: [video], comments: [] },
    metrics: { videos_matched: 0, videos_rejected: 0, videos_skipped: 0, videos_processed: 0, comments_collected: 0 },
    evidence: [{ video_id: video.video_id, serial: input.device.serial, activity: action }] };
  if (action === 'collection' && video.judgment_status !== 'matched') {
    result.metrics.videos_skipped = 1;
    result.evidence[0].status = 'skipped';
    return result;
  }
  let stdout;
  try { ({ stdout } = await run(action, input)); }
  catch (error) {
    // 中断前已采出的评论仍是有效产物；非零退出不能丢掉stdout或冒充完整成功。
    stdout = String(error.stdout || '');
    if (!/ACTIVITY_STATUS\t(?:pending|fatal)\t/.test(stdout)) {
      stdout += '\nACTIVITY_STATUS\tpending\tphone_transport_unavailable';
    }
  }
  const lines = String(stdout).trim().split('\n');
  const binding = lines.filter(line => line.startsWith('ACTIVITY_BINDING\t')).at(-1);
  if (binding) {
    const [, expected, observed, exitCode] = binding.split('\t');
    if (expected === video.video_id && /^\d{1,3}$/.test(exitCode || '') && Number(exitCode) <= 255
      && (!observed || /^\d{16,24}$/.test(observed))) {
      result.evidence[0].identity_binding = { expected_video_id: expected,
        observed_video_id: observed || null, command_exit_code: Number(exitCode) };
    }
  }
  const statusLine = lines.filter(line => line.startsWith('ACTIVITY_STATUS\t')).at(-1);
  let [, state = 'pending', reason = 'invalid_phone_result'] = (statusLine || '').split('\t');
  const cleanupFailed = lines.includes('ACTIVITY_CLEANUP\tfailed');
  if (action === 'qualification') {
    const qualification = lines.filter(line => line.startsWith('QUAL\t')).at(-1);
    const [, qualifiedId, verdict, source] = (qualification || '').split('\t');
    video.judgment_status = qualifiedId === video.video_id && ['matched', 'rejected'].includes(verdict)
      && state === 'completed' && !cleanupFailed ? verdict : 'pending';
    if (video.judgment_status === 'matched') result.metrics.videos_matched = 1;
    if (video.judgment_status === 'rejected') result.metrics.videos_rejected = 1;
    result.evidence[0].source = source || null;
  } else {
    for (const line of lines.filter(line => line.startsWith('LEAD\t'))) {
      const [, nick, id, type, comment, date, region, title, keyword, ip, profile, url] = line.split('\t');
      const fields = { 评论者昵称: nick || '', 评论原文: comment || '', 来源视频: title || '',
        抖音号: id || '', 主页链接: profile || '', 账号类型: type || '',
        用户主页标识: [id, profile, type].filter(Boolean).join(' | '),
        留言时间: date || '', 地区: region || '', 命中关键词: keyword || '', 主页IP: ip || '', 评论作品视频链接: url || '' };
      result.outputs.comments.push({ id: `${video.video_id}:${result.outputs.comments.length + 1}`,
        video_id: video.video_id, fields });
    }
    result.metrics.comments_collected = result.outputs.comments.length;
    if (input.return_to_results === true) {
      const marker = lines.filter(line => line.startsWith('ACTIVITY_RETURN\t')).at(-1);
      const [, attempted, confirmed, rescans, returnReason] = (marker || '').split('\t');
      const valid = ['0', '1'].includes(attempted) && ['0', '1'].includes(confirmed)
        && (confirmed !== '1' || (attempted === '1' && ['0', '1'].includes(rescans)));
      const returned = valid && confirmed === '1';
      const attemptCount = valid ? Number(attempted) : null;
      result.evidence[0].return_to_results = { attempted: attemptCount,
        confirmed: returned ? 1 : 0, rescans: returned ? Number(rescans) : null,
        reason_code: returned ? null : returnReason || 'return_to_results_unconfirmed' };
      if (attemptCount !== null) result.metrics.returns_attempted = attemptCount;
      if (returned) {
        result.metrics.rescan_count = Number(rescans);
        result.metrics.rescan_rate = Number(rescans) / attemptCount;
      } else if (state === 'completed') {
        state = 'pending'; reason = returnReason || 'return_to_results_unconfirmed';
      }
    }
    if (state === 'completed' && !cleanupFailed) {
      result.metrics.videos_processed = 1;
      const nativeVideos = lines.filter(line => line.startsWith('VIDEO\t'));
      if (nativeVideos.length === 1) {
        const [, id, url, title, keyword, count, extra] = nativeVideos[0].split('\t');
        const receipt = { video_id: id, url, title, keyword, comment_count: Number(count), batch: input.run_tag };
        if (extra === undefined && /^\d+$/.test(count || '')) {
          try {
            require('./video-delivery-storage.js').validateReceipt({ ...video, collection_receipt: receipt }, input.run_tag);
            video.collection_receipt = receipt;
          } catch (_) { /* 下方统一拒绝无法证实的原生 VIDEO 行。 */ }
        }
      }
      if ((nativeVideos.length || result.outputs.comments.length) && !video.collection_receipt) {
        result.metrics.videos_processed = 0;
        state = 'pending'; reason = 'video_collection_receipt_unconfirmed';
      }
    }
  }
  const invalidQualification = action === 'qualification' && video.judgment_status === 'pending';
  if (state !== 'completed' || cleanupFailed || invalidQualification) {
    result.status = result.outputs.comments.length ? 'partial' : 'failed';
    result.failure_class = state === 'fatal' ? 'fatal' : 'retryable';
    result.reason_code = cleanupFailed ? 'lock_release_unconfirmed' : reason || 'qualification_pending';
  }
  result.evidence[0].status = result.status;
  return result;
}

module.exports = { validateVideoInput, runVideoActivity, runPhone };
