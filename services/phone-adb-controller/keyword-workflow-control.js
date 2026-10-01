'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_MAX_SECONDS = 14400;
const DEFAULT_LEASE_INTERVAL_MS = 60000;
const LOCK_COMMAND_TIMEOUT_MS = 5000;
function lockState(text) {
  if (/^lock=free\s*$/m.test(text)) return { state: 'free', owner: null };
  const owner = /^lock=held owner=([^\s]+)/m.exec(text)?.[1];
  return owner ? { state: 'held', owner } : { state: 'unknown', owner: null };
}

// 只控制主链的取消信号；通用执行器的 finalize 活动不接此 signal。
function createWorkflowControl(input, { receiptPath, stopFile, signal, env = process.env,
  maxSeconds, leaseIntervalMs = DEFAULT_LEASE_INTERVAL_MS } = {}) {
  if (!/^[a-zA-Z0-9_.-]{1,96}$/.test(input?.run_tag || '')
    || !/^[a-zA-Z0-9_.-]+$/.test(input?.device?.profile || '')
    || typeof env.HOME !== 'string' || !env.HOME
    || typeof receiptPath !== 'string' || !receiptPath || typeof stopFile !== 'string' || !stopFile) {
    throw new Error('workflow_control_input_invalid');
  }
  const limit = maxSeconds ?? Number(env.WF_RUN_MAX_SECONDS ?? DEFAULT_MAX_SECONDS);
  if (!Number.isFinite(limit) || limit < 0 || !Number.isFinite(leaseIntervalMs)
    || leaseIntervalMs <= 0 || leaseIntervalMs >= 1800000 - LOCK_COMMAND_TIMEOUT_MS) {
    throw new Error('workflow_control_budget_invalid');
  }
  const controller = new AbortController(), events = [];
  const binary = path.join(env.HOME, '.local/bin/douyin-phone-adb');
  let stoppedReason = null, disposed = false, cleanupStarted = false, owned = false;
  let leaseTimer, deadlineTimer, receiptTimer, inflight = Promise.resolve(), activeChild = null;
  const event = (event_type, details = {}) => events.push({ event_type, run_tag: input.run_tag, ...details });
  function requestStop(reason) {
    if (disposed || stoppedReason) return;
    stoppedReason = reason;
    try { fs.writeFileSync(stopFile, '', { mode: 0o600 }); }
    catch (error) { event('WF_STOP_FILE_FAILED', { reason_code: error.code || 'write_failed' }); }
    event('WF_STOP_REQUESTED', { reason_code: reason }); controller.abort(reason);
  }
  function stopLease() {
    clearTimeout(leaseTimer);
    if (activeChild) activeChild.kill('SIGTERM');
  }
  function checkCleanup() {
    if (cleanupStarted || disposed) return true;
    let receipt;
    try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); }
    catch (_) { return false; } // 文件创建前/原子改名期间允许等待。
    if (receipt.run_tag !== input.run_tag) return false;
    // 原子回执可能在两次观察间已推进到 FINISHED；活动记录同样证明 cleanup 已起跑。
    if ((receipt.last_event?.event_type === 'ACTIVITY_STARTED' && receipt.last_event.activity === 'cleanup')
      || receipt.activities?.some(activity => activity.key === 'cleanup')) {
      cleanupStarted = true; event('LOCK_LEASE_STOPPED', { reason_code: 'cleanup_started' }); stopLease();
      clearInterval(receiptTimer);
    }
    return cleanupStarted;
  }
  function command(action) {
    if (checkCleanup()) return Promise.resolve(null);
    return new Promise(resolve => {
      const args = ['--profile', input.device.profile, action, ...(action === 'lock-refresh' ? [input.run_tag] : [])];
      const child = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
      activeChild = child;
      let stdout = '', failed = false;
      child.stdout.on('data', data => { if (stdout.length < 8192) stdout += data.toString(); });
      child.stderr.resume();
      child.on('error', () => { failed = true; });
      const timeout = setTimeout(() => { failed = true; child.kill('SIGKILL'); }, LOCK_COMMAND_TIMEOUT_MS);
      child.on('close', code => {
        clearTimeout(timeout); if (activeChild === child) activeChild = null;
        resolve({ ok: !failed && code === 0, stdout });
      });
    });
  }
  function observe(text) {
    const lock = lockState(text);
    if (lock.owner === input.run_tag) { owned = true; return true; }
    if (lock.state === 'held') requestStop('foreign_lock');
    else if (owned || lock.state === 'unknown') requestStop('lock_unavailable');
    return false;
  }
  async function renew() {
    try {
      const before = await command('lock-status');
      if (checkCleanup() || !before) return;
      if (!before.ok) { requestStop('lock_unavailable'); return; }
      if (!observe(before.stdout)) return;
      const refresh = await command('lock-refresh');
      if (checkCleanup() || !refresh) return;
      // 命令退出/声称成功不能证明当前 owner，失败也读回以分类外来锁。
      const after = await command('lock-status');
      if (checkCleanup() || !after) return;
      if (!after.ok) { requestStop('lock_unavailable'); return; }
      if (!observe(after.stdout)) return;
      const acknowledged = /^lock=refreshed owner=([^\s]+)/m.exec(refresh.stdout)?.[1];
      if (!refresh.ok || acknowledged !== input.run_tag) { requestStop('lock_refresh_unconfirmed'); return; }
      event('LOCK_LEASE_REFRESHED', { owner: input.run_tag });
    } catch (_) { if (!checkCleanup()) requestStop('lock_unavailable'); }
    finally {
      if (!disposed && !cleanupStarted && !['foreign_lock', 'lock_unavailable', 'lock_refresh_unconfirmed'].includes(stoppedReason)) {
        leaseTimer = setTimeout(tick, leaseIntervalMs);
      }
    }
  }
  function tick() { inflight = renew(); }
  const parentStop = () => requestStop('interrupted');
  signal?.addEventListener('abort', parentStop, { once: true });
  if (signal?.aborted) parentStop();
  const start = /^\d+$/.test(env.WF_RUN_START_TS || '') ? Number(env.WF_RUN_START_TS) * 1000 : Date.now();
  // 只发 soft abort，不施加进程超时，不把剩余预算套到配送/归位。
  deadlineTimer = setTimeout(() => requestStop('deadline'), Math.max(0, start + limit * 1000 - Date.now()));
  receiptTimer = setInterval(checkCleanup, Math.min(100, leaseIntervalMs));
  tick();
  return { signal: controller.signal, events, reason: () => stoppedReason,
    async dispose() {
      disposed = true; clearTimeout(deadlineTimer); clearInterval(receiptTimer); stopLease();
      signal?.removeEventListener('abort', parentStop); await inflight;
    } };
}
module.exports = { createWorkflowControl };
