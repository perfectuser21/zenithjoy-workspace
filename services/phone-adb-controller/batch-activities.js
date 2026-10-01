'use strict';
// 批次手机边界：复用控制器动作，绝不装入 harvest 的执行主体。
const path = require('node:path');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { routeOf } = require('./line-routes.js');
const execute = promisify(execFile);
const VIDEO_ID = /^\d{16,24}$/;
const RUN_ID = /^[a-zA-Z0-9_.-]{1,96}$/;
const APP = 'com.ss.android.ugc.aweme';
const shellQuote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
const fields = text => Object.fromEntries(String(text).split('\n').filter(line => /^[a-z_]+=/.test(line))
  .map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).trim()]; }));
function lockState(text) {
  if (/^lock=free\s*$/m.test(text)) return { state: 'free', owner: null };
  const owner = /^lock=held owner=([^\s]+)/m.exec(text)?.[1];
  return owner ? { state: 'held', owner } : { state: 'unknown', owner: null };
}

function validateBatchInput(action, input) {
  if (!['preflight', 'discovery', 'cleanup'].includes(action) || !input || !RUN_ID.test(input.run_tag || '')) throw new Error('活动/run非法');
  const route = routeOf(input.line_key);
  const d = input.device;
  if (!d || !route.profiles.includes(d.profile) || typeof d.serial !== 'string' || !d.serial.trim()
      || d.lock_holder !== input.run_tag || (d.host !== undefined && (typeof d.host !== 'string' || !d.host.trim()))) throw new Error('设备/锁上下文非法');
  const a = input.account;
  if (action === 'preflight' && (!a || typeof a.sender_id !== 'string' || !a.sender_id.trim()
      || (a.profile !== undefined && a.profile !== d.profile))) throw new Error('缺显式账号');
  if (input.budget && (!Number.isSafeInteger(input.budget.max_duration_s) || input.budget.max_duration_s < 0
      || (input.budget.heartbeat_s !== undefined && (!Number.isSafeInteger(input.budget.heartbeat_s) || input.budget.heartbeat_s <= 0)))) throw new Error('预算非法');
  if ((action === 'discovery' || input.keywords !== undefined) && (!Array.isArray(input.keywords)
      || !input.keywords.length || input.keywords.some(k => !k || typeof k.word !== 'string' || !k.word.trim()
      || (k.max_videos !== undefined && (!Number.isSafeInteger(k.max_videos) || k.max_videos < 1 || k.max_videos > 100))
      || (k.location !== undefined && !['same_city', 'unlimited'].includes(k.location))))) throw new Error('关键词非法');
  if (input.location !== undefined && !['same_city', 'unlimited'].includes(input.location)) throw new Error('位置非法');
  return route;
}

class ActivityFailure extends Error {
  constructor(reason, status = 'failed', failureClass = 'retryable') { super(reason); this.reason = reason; this.status = status; this.failureClass = failureClass; }
}

function context(action, input, route) {
  const cancellation = fs.mkdtempSync(path.join(tmpdir(), 'batch-activity-stop-'));
  const stopFile = path.join(cancellation, 'requested');
  const stop = () => fs.writeFileSync(stopFile, '', { mode: 0o600 });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  const started = Date.now();
  const result = { schema_version: 1, run_tag: input.run_tag, line_key: route.key, status: 'completed',
    failure_class: null, reason_code: null, outputs: {}, metrics: {}, evidence: [] };
  const batchStart = /^\d+$/.test(process.env.WF_RUN_START_TS || '') ? Number(process.env.WF_RUN_START_TS) * 1000 : null;
  const batchMax = /^\d+$/.test(process.env.WF_RUN_MAX_SECONDS || '') ? Number(process.env.WF_RUN_MAX_SECONDS) * 1000 : 14400000;
  const budget = (input.budget?.max_duration_s || 0) * 1000;
  const now = () => /^\d+$/.test(process.env.WF_NOW_TS || '') ? Number(process.env.WF_NOW_TS) * 1000 : Date.now();
  function boundary() {
    if (action === 'cleanup') return;
    const reason = batchStart !== null && now() - batchStart >= batchMax ? 'deadline'
      : fs.existsSync(stopFile) ? 'interrupted'
      : process.env.WF_STOP_FILE && fs.existsSync(process.env.WF_STOP_FILE) ? 'commander_stop'
      : budget > 0 && Date.now() - started >= budget ? 'budget_exceeded' : null;
    if (reason) throw new ActivityFailure(reason, 'partial');
  }
  function remoteCap(independentSeconds = 45) {
    boundary();
    let remaining = independentSeconds * 1000;
    if (budget > 0) remaining = Math.min(remaining, budget - (Date.now() - started));
    if (batchStart !== null) remaining = Math.min(remaining, batchMax - (now() - batchStart));
    return Math.max(1, Math.floor(remaining));
  }
  async function command(file, args, options = {}) {
    const observation = { activity: action, command: options.label || args[2], serial: input.device.serial };
    try {
      const r = await execute(file, args, { env: process.env, maxBuffer: 16 * 1024 * 1024,
        ...(options.timeout ? { timeout: options.timeout, killSignal: 'SIGKILL' } : {}) });
      observation.ok = true; observation.stdout = String(r.stdout).slice(0, 3000);
      result.evidence.push(observation);
      return String(r.stdout);
    } catch (error) {
      observation.ok = false; observation.stdout = String(error.stdout || '').slice(0, 3000);
      observation.stderr = String(error.stderr || '').slice(0, 500); observation.timed_out = !!error.killed;
      result.evidence.push(observation);
      if (error.killed) boundary();
      throw new ActivityFailure(options.failure || 'phone_transport_unavailable', action === 'discovery' ? 'partial' : 'failed');
    }
  }
  async function phone(name, ...args) {
    boundary();
    // 手机动作无进程超时；TERM仅写自己的停止标记，动作结束再检查安全边界。
    return command(path.join(process.env.HOME, '.local/bin/douyin-phone-adb'), ['--profile', input.device.profile, name, ...args]);
  }
  async function remote(script, args, failure, cap = 45) {
    const cmd = script === 'fetch-seen-videos.js'
      ? `node /Users/administrator/.openclaw/leadgen-scripts/fetch-seen-videos.js ${shellQuote(route.key)}`
      : `set -a; source ~/.credentials/zenithjoy-db.env 2>/dev/null; set +a; cd ~/.openclaw/leadgen-scripts && node qualify-video.js discover ${args.slice(1).map(shellQuote).join(' ')}`;
    return command('ssh', ['-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes', 'mmv', cmd],
      { label: script, timeout: remoteCap(cap), failure });
  }
  function issue(reason, detail = {}) {
    if (result.status === 'completed') { result.status = 'partial'; result.failure_class = 'retryable'; result.reason_code = reason; }
    result.evidence.push({ activity: action, reason_code: reason, ...detail });
  }
  async function nap(seconds) {
    if (!process.env.HARVEST_KEYWORD_TESTING) await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    boundary();
  }
  return { result, boundary, phone, remote, issue, nap, dispose() {
    process.off('SIGTERM', stop); process.off('SIGINT', stop); fs.rmSync(cancellation, { recursive: true, force: true });
  } };
}

async function verifyDevice(ctx, input) {
  const read = fields(await ctx.phone('preflight'));
  ctx.result.evidence.push({ activity: 'device_identity', observed: read });
  if (read.serial !== input.device.serial || (read.profile !== undefined && read.profile !== input.device.profile)) throw new ActivityFailure('device_mismatch', 'failed', 'fatal');
  if (read.state !== 'device') throw new ActivityFailure('device_unavailable');
  return read;
}

async function assertLock(ctx, input, refresh = true) {
  const lock = lockState(await ctx.phone('lock-status'));
  if (lock.owner !== input.run_tag) throw new ActivityFailure(lock.state === 'held' ? 'foreign_lock' : 'lock_unavailable', 'failed');
  if (refresh && /^lock=refreshed owner=([^\s]+)/m.exec(await ctx.phone('lock-refresh', input.run_tag))?.[1] !== input.run_tag) throw new ActivityFailure('lock_refresh_unconfirmed');
  return lock;
}

async function preflight(ctx, input) {
  const { result } = ctx;
  result.outputs.device = { ...input.device, lock_holder: null, observed_lock_state: 'unknown', observed_state: null };
  result.outputs.account = { ...input.account, observed_sender_id: null };
  result.metrics = { device_verified: 0, account_verified: 0, call_state_idle: 0, lock_acquired: 0 };
  const read = await verifyDevice(ctx, input);
  result.outputs.device.observed_state = read.state; result.outputs.device.observed_serial = read.serial;
  result.metrics.device_verified = 1;
  result.outputs.device.observed_call_state = read.call_state || null;
  if (!['0', 'idle'].includes(String(read.call_state).toLowerCase())) {
    const busy = ['1', '2', 'ringing', 'offhook'].includes(String(read.call_state).toLowerCase());
    throw new ActivityFailure(busy ? 'call_busy' : 'call_state_unknown');
  }
  result.metrics.call_state_idle = 1;
  let lock = lockState(await ctx.phone('lock-status'));
  result.outputs.device.lock_holder = lock.owner;
  result.outputs.device.observed_lock_state = lock.state;
  if (lock.state === 'unknown') throw new ActivityFailure('lock_unavailable');
  if (lock.owner && lock.owner !== input.run_tag) throw new ActivityFailure('foreign_lock');
  let acquired;
  try { acquired = await ctx.phone('lock-acquire', input.run_tag); }
  catch (e) {
    // 命令回执失败不等于未获锁：先保留真实owner，finally仍可清理。
    lock = lockState(await ctx.phone('lock-status'));
    result.outputs.device.lock_holder = lock.owner; result.outputs.device.observed_lock_state = lock.state;
    result.metrics.lock_acquired = Number(result.outputs.device.lock_holder === input.run_tag);
    throw e;
  }
  // 获锁之后即保留上下文；任何后续失败都交由批次 finally 清理。
  const acknowledged = /^lock=(acquired|held) owner=([^\s]+)/m.exec(acquired);
  if (acknowledged?.[2] === input.run_tag) {
    result.outputs.device.lock_holder = input.run_tag; result.outputs.device.observed_lock_state = 'held'; result.metrics.lock_acquired = 1;
  }
  lock = lockState(await ctx.phone('lock-status'));
  result.outputs.device.lock_holder = lock.owner;
  result.outputs.device.observed_lock_state = lock.state;
  result.metrics.lock_acquired = Number(lock.owner === input.run_tag);
  if (acknowledged?.[2] !== input.run_tag) throw new ActivityFailure('lock_acquire_unconfirmed');
  lock = await assertLock(ctx, input);
  result.metrics.lock_acquired = 1;
  for (const action of ['wake', 'unlock', 'close-app', 'open-app']) {
    await assertLock(ctx, input); await ctx.phone(action);
    if (action === 'close-app' || action === 'open-app') await ctx.nap(action === 'close-app' ? 2 : 4);
  }
  await assertLock(ctx, input);
  let account;
  try { account = fields(await ctx.phone('account-current', `${input.run_tag}-preflight-acct`)); }
  catch (e) { if (e.reason !== 'phone_transport_unavailable') throw e; throw new ActivityFailure('account_read_failed'); }
  result.outputs.account.observed_sender_id = account.douyin_id || null;
  if (!account.douyin_id) throw new ActivityFailure('account_read_failed');
  if (account.douyin_id !== input.account.sender_id) throw new ActivityFailure('account_mismatch', 'failed', 'fatal');
  result.metrics.account_verified = 1;
  ctx.boundary();
}

function cardsOf(text, max) {
  return String(text).split('\n').filter(line => /^\d+\t\d+\t/.test(line)).slice(0, max).map(line => {
    const [x, y, duration, ...title] = line.split('\t'); return { x, y, duration, title: title.join('\t') };
  });
}
async function scan(ctx, input, keyword, tag, reopen = true) {
  await assertLock(ctx, input);
  if (reopen) { await ctx.phone('open-app'); await ctx.nap(2); }
  // 打开搜索或筛选失败均同词重开一次；video tab 已在页的容错沿用旧实现。
  let filtered = false, failureReason = 'search_filter_failed';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      if (reopen || attempt > 1) {
        failureReason = 'search_open_failed';
        await ctx.phone('open-search', encodeURIComponent(keyword.word)); await ctx.nap(3);
      }
      failureReason = 'search_filter_failed';
      try { await ctx.phone('search-video-tab', `${tag}-vtab-${attempt}`); }
      catch (e) { if (e.reason !== 'phone_transport_unavailable') throw e; }
      await ctx.phone('search-time-layer', 'six_months', `${tag}-filter-${attempt}`, 'most_liked', 'unlimited', 'unlimited', keyword.location || input.location || 'same_city');
      filtered = true; break;
    }
    catch (e) {
      if (e.reason !== 'phone_transport_unavailable') throw e;
    }
  }
  if (!filtered) throw new ActivityFailure(failureReason, 'partial');
  await ctx.nap(2);
  const cards = cardsOf(await ctx.phone('search-video-cards', `${tag}-cards`), keyword.max_videos || 4);
  ctx.result.metrics.screens_scanned++;
  return cards;
}

async function discovery(ctx, input) {
  const { result } = ctx;
  result.outputs.videos = [];
  result.metrics = { candidates: 0, keywords_processed: 0, screens_scanned: 0, persisted: 0, seen_skipped: 0, duplicates_skipped: 0 };
  await verifyDevice(ctx, input); await assertLock(ctx, input);
  const historical = await ctx.remote('fetch-seen-videos.js', [], 'seen_fetch_failed', 30);
  const seen = new Set();
  for (const id of historical.split('\n').filter(Boolean)) {
    if (!VIDEO_ID.test(id.trim())) throw new ActivityFailure('seen_fetch_invalid', 'partial');
    seen.add(id.trim());
  }
  const batch = new Set();
  for (let wordIndex = 0; wordIndex < input.keywords.length; wordIndex++) {
    ctx.boundary(); const keyword = input.keywords[wordIndex]; const tag = `${input.run_tag}-w${wordIndex + 1}`;
    try {
      await assertLock(ctx, input); await ctx.phone('close-app');
      let cards = await scan(ctx, input, keyword, tag); let rescans = 0;
      for (let cardIndex = 0; cardIndex < cards.length; cardIndex++) {
        ctx.boundary(); await verifyDevice(ctx, input); await assertLock(ctx, input);
        const card = cards[cardIndex], eid = `${tag}-v${cardIndex + 1}`;
        await ctx.phone('tap-evidence', card.x, card.y, eid);
        await ctx.nap(3);
        const link = fields(await ctx.phone('current-video-link', `${eid}-vl`));
        ctx.boundary();
        if (link.excluded_non_video === 'true') { result.evidence.push({ video_id: null, reason_code: 'non_video_skipped' }); }
        else if (!VIDEO_ID.test(link.video_id || '') || !/^https?:\/\//.test(link.short_url || '')) { ctx.issue('video_link_invalid', { observed: link }); }
        else if (seen.has(link.video_id)) { result.metrics.seen_skipped++; }
        else if (batch.has(link.video_id)) { result.metrics.duplicates_skipped++; }
        else {
          batch.add(link.video_id); result.metrics.candidates++;
          const args = ['discover', '--line', ctx.result.line_key, '--video-id', link.video_id,
            '--video-url', link.short_url, '--title-b64', Buffer.from(card.title).toString('base64'),
            '--keyword-b64', Buffer.from(keyword.word).toString('base64'), '--batch', input.run_tag];
          let persisted;
          try {
            const text = await ctx.remote('qualify-video.js', args, 'candidate_persist_failed');
            persisted = JSON.parse(text.split('\n').filter(l => l.startsWith('QUAL_DISCOVER ')).at(-1)?.slice(14) || 'null');
          } catch (e) {
            if (e.reason && !['candidate_persist_failed'].includes(e.reason)) throw e;
            ctx.issue('candidate_persist_failed', { video_id: link.video_id });
          }
          if (persisted && ['pending', 'matched', 'rejected'].includes(persisted.status)
              && typeof persisted.process_status === 'string' && persisted.process_status) {
            result.metrics.persisted++;
            if (persisted.process_status === '评论已采') { seen.add(link.video_id); result.metrics.seen_skipped++; }
            else result.outputs.videos.push({ video_id: link.video_id, title: card.title, duration: card.duration,
              keyword: keyword.word, video_url: link.short_url, line_key: result.line_key, harvest_batch: input.run_tag,
              judgment_status: persisted.status, process_status: persisted.process_status || null });
          } else { ctx.issue('candidate_persist_failed', { video_id: link.video_id, persisted }); }
        }
        ctx.boundary(); await assertLock(ctx, input);
        const returned = await ctx.phone('back-to-results', '4', keyword.word, `${eid}-btr`);
        if (returned.includes('recovered_via=research')) {
          if (++rescans > 3) { ctx.issue('rescan_limit'); break; }
          cards = await scan(ctx, input, keyword, `${eid}-rescan`, false);
          // 重新筛选可能改变卡片坐标；从下一卡继续，批内 ID 去重，禁止重扫从头死循环。
        }
      }
      result.metrics.keywords_processed++;
    } catch (e) {
      if (['deadline', 'commander_stop', 'interrupted', 'budget_exceeded', 'device_mismatch', 'device_unavailable', 'foreign_lock', 'lock_unavailable', 'lock_refresh_unconfirmed'].includes(e.reason)) throw e;
      ctx.issue(e.reason || 'keyword_discovery_failed', { keyword: keyword.word });
    }
  }
  ctx.boundary();
}

async function cleanup(ctx, input) {
  const { result } = ctx;
  result.outputs.device = { ...input.device, lock_holder: null, observed_lock_state: 'unknown' };
  result.metrics = { app_closed: 0, lock_released: 0, safe_desktop_visible: 0, close_app_attempts: 0 };
  await verifyDevice(ctx, input);
  let lock = lockState(await ctx.phone('lock-status'));
  result.outputs.device.lock_holder = lock.owner;
  result.outputs.device.observed_lock_state = lock.state;
  if (lock.state === 'free') { result.metrics.lock_released = 1; return; }
  if (lock.owner !== input.run_tag) throw new ActivityFailure(lock.state === 'held' ? 'foreign_lock' : 'lock_unavailable', 'failed', 'fatal');
  let reason;
  try {
    await assertLock(ctx, input); result.metrics.close_app_attempts++; await ctx.phone('close-app');
    const foreground = fields(await ctx.phone('foreground')).foreground;
    result.outputs.device.observed_foreground = foreground || null;
    if (foreground && foreground !== 'unknown' && !foreground.includes(APP)) result.metrics.app_closed = 1;
    else reason = 'app_close_unconfirmed';
  } catch (e) { reason = e.reason || 'cleanup_unconfirmed'; }
  // close-app失败也继续尝试安全桌面；每个动作前重新确认本批仍拥有锁。
  try {
    await assertLock(ctx, input);
    const desktop = fields(await ctx.phone('return-safe-desktop'));
    const readForeground = fields(await ctx.phone('foreground')).foreground;
    result.outputs.device.observed_foreground = readForeground || null;
    result.outputs.device.launcher = desktop.launcher || null;
    if (desktop.launcher && desktop.foreground?.includes(desktop.launcher) && readForeground?.includes(desktop.launcher)) result.metrics.safe_desktop_visible = 1;
    else reason = 'safe_desktop_unconfirmed';
  } catch (e) { reason ||= e.reason || 'cleanup_unconfirmed'; }
  // 放锁即便清场失败仍执行；每次先真读 owner，避免重试误碰后来持锁的 run。
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      lock = lockState(await ctx.phone('lock-status'));
      if (lock.state === 'free' || (lock.state === 'held' && lock.owner !== input.run_tag)) { result.metrics.lock_released = 1; break; }
      if (lock.owner !== input.run_tag) continue;
      try { await ctx.phone('lock-release', input.run_tag); } catch (_) { /* 真读决定是否释放成功 */ }
      lock = lockState(await ctx.phone('lock-status'));
      if (lock.state === 'free' || (lock.state === 'held' && lock.owner !== input.run_tag)) { result.metrics.lock_released = 1; break; }
    } catch (_) { /* 独立下一次确认 */ }
  }
  result.outputs.device.lock_holder = lock.owner;
  result.outputs.device.observed_lock_state = lock.state;
  if (!result.metrics.lock_released) reason = 'lock_release_unconfirmed';
  if (reason) throw new ActivityFailure(reason);
}

async function runBatchActivity(action, input) {
  const route = validateBatchInput(action, input), ctx = context(action, input, route);
  try { await ({ preflight, discovery, cleanup }[action])(ctx, input); }
  catch (e) {
    ctx.result.status = e.status || 'failed';
    if (action === 'discovery' && ctx.result.outputs.videos?.length && ctx.result.status === 'failed') ctx.result.status = 'partial';
    ctx.result.failure_class = e.failureClass || 'retryable'; ctx.result.reason_code = e.reason || 'activity_unavailable';
    ctx.result.evidence.push({ activity: action, reason_code: ctx.result.reason_code });
  } finally { ctx.dispose(); }
  return ctx.result;
}
module.exports = { validateBatchInput, runBatchActivity };
