import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const MAX_OUTPUT = 16 * 1024 * 1024;

// 独立进程组：先 TERM 请求活动自身清理，再在 grace 到期收割进程树。
export function callActivityProcess(activity, input, { cwd, signal, onHeartbeat = async () => {}, onAgentEvent,
  stallAfterMs = (activity.runtime.stall_after_s ?? 180) * 1000 } = {}) {
  return new Promise(resolveResult => {
    const entry = resolve(cwd, activity.runtime.entry);
    const nodeScript = /\.(?:js|mjs|cjs)$/.test(entry);
    const child = spawn(nodeScript ? process.execPath : entry,
      [...(nodeScript ? [entry] : []), ...(activity.runtime.argv || [])],
      { cwd, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', reason = null, graceTimer, heartbeatBusy = false, closed = false;
    let eventQueue = Promise.resolve(), eventBuffer = '', lastProgress = Date.now(), stallReported = false;
    let timer,remainingMs=activity.budget.max_duration_s*1000,activeSince=Date.now(),questionWaits=0;
    let questionPausedAt=0,questionWaitMs=0,closedAt=0;
    const agent_events = [];
    const started = Date.now();
    const kill = kind => {
      if (!child.pid) return;
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, kind); }
      catch (error) { if (error.code !== 'ESRCH') stderr += '\nprocess_signal_failed'; }
    };
    const stop = code => {
      if (reason) return;
      reason = code;
      if (closed) return;
      // JSON活动根负责把取消转换成业务安全边界请求，不向外部动作广播TERM。
      if (child.pid) { try { process.kill(child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') stderr += '\nprocess_signal_failed'; } }
      graceTimer = setTimeout(() => kill('SIGKILL'), (activity.runtime.cleanup_grace_s ?? 5) * 1000);
    };
    const abort = () => stop('run_cancelled');
    const resumeBusinessClock = () => {
      if (questionWaits>0 || closed || reason) return;
      activeSince=Date.now();timer=setTimeout(()=>stop('activity_timeout'),Math.max(0,remainingMs));
    };
    const agentEvent = event => {
      if (event.type === 'progress') { lastProgress = Date.now(); stallReported = false; }
      const waitingQuestion=event.type==='question'&&activity.runtime.interactive===true;
      if(waitingQuestion&&questionWaits++===0){clearTimeout(timer);questionPausedAt=Date.now();remainingMs-=questionPausedAt-activeSince;}
      agent_events.push(event);
      eventQueue = eventQueue.then(async () => {
        try{
          const action = await onAgentEvent?.(event);
          if (closed) return;
          if (action?.action === 'abort') stop('commander_abort');
          else if (activity.runtime.interactive === true && ['steer', 'answer'].includes(action?.action)
            && typeof action.text === 'string' && child.stdin.writable && !child.stdin.destroyed) {
            child.stdin.write(JSON.stringify({ protocol: 'activity-agent-action/v1', action: action.action, text: action.text }) + '\n');
            agent_events.push({ type: 'guidance_delivered', action: action.action, text: action.text });
          }
        }finally{
          if(waitingQuestion&&--questionWaits===0){questionWaitMs+=Math.max(0,Math.min(Date.now(),closedAt||Infinity)-questionPausedAt);resumeBusinessClock();}
        }
      }).catch(() => stop('event_sink_failed'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    resumeBusinessClock();
    const heartbeat = setInterval(async () => {
      if (heartbeatBusy) return;
      heartbeatBusy = true;
      try { await onHeartbeat({ elapsed_s: (Date.now() - started) / 1000 }); }
      catch { stop('event_sink_failed'); }
      finally { heartbeatBusy = false; }
    }, activity.budget.heartbeat_s * 1000);
    const stall = typeof onAgentEvent === 'function' && Number.isFinite(stallAfterMs) && stallAfterMs > 0
      ? setInterval(() => {
        if (!closed && !reason && !stallReported && Date.now() - lastProgress >= stallAfterMs) {
          stallReported = true;
          agentEvent({ type: 'stall', elapsed_without_progress_s: (Date.now() - lastProgress) / 1000 });
        }
      }, Math.max(10, Math.min(stallAfterMs, 1000))) : null;
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > MAX_OUTPUT) stop('activity_output_overflow');
      else stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      if (Buffer.byteLength(stderr) + Buffer.byteLength(chunk) <= MAX_OUTPUT) stderr += chunk;
      if (typeof onAgentEvent !== 'function') return;
      eventBuffer += chunk;
      // stderr 仍是原始证据；只有显式协议行能成为 agent 事件。
      let newline;
      while ((newline = eventBuffer.indexOf('\n')) !== -1) {
        const line = eventBuffer.slice(0, newline); eventBuffer = eventBuffer.slice(newline + 1);
        if (Buffer.byteLength(line) > 65536) continue;
        try {
          const event = JSON.parse(line);
          if (event?.protocol === 'activity-agent-event/v1' && ['progress', 'question', 'error'].includes(event.type)) agentEvent(event);
        } catch { /* 普通 stderr 不参与协议。 */ }
      }
      if (Buffer.byteLength(eventBuffer) > 65536) eventBuffer = '';
    });
    child.stdin.on('error', () => {});
    if (activity.runtime.interactive === true) child.stdin.write(JSON.stringify(input) + '\n');
    else child.stdin.end(JSON.stringify(input));
    let spawnError = null;
    child.on('error', error => { spawnError = error.code || 'spawn_error'; });
    child.on('close', async (exit_code, exit_signal) => {
      closed = true;closedAt=Date.now();
      clearTimeout(timer); clearTimeout(graceTimer); clearInterval(heartbeat); clearInterval(stall);
      signal?.removeEventListener('abort', abort);
      // 后代可能已经脱离父进程；进程组结束时仍不允许留下同组后台进程。
      kill('SIGKILL');
      await eventQueue;
      resolveResult({ stdout, stderr, exit_code, exit_signal,
        reason_code: reason || spawnError, duration_s: (Date.now() - started) / 1000,
        supervision_wait_ms:questionWaitMs+Date.now()-closedAt,
        // 根进程或原进程组退出不能证明已脱离的子任务停止。取消后保留执行权，
        // 由业务的独立停止读回证明归还；启动失败则明确没有旧执行者。
        ...(reason ? { execution_stopped: false } : spawnError ? { execution_stopped: true } : {}),
        ...(agent_events.length ? { agent_events } : {}) });
    });
  });
}
