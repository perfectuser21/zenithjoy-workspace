import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFrozen } from './runtime-definition.mjs';

export const RPC_FILES = ['leadgen-rpc.mjs', 'leadgen-queue.js', 'activity-commander.mjs',
  'leadgen-db-lib.js', 'leadgen-db-connect.js', 'judge-video.js', 'judge-video-lib.js',
  'judge-jev.js', 'judge-comment.js', 'qualify-video.js', 'transcribe-qwen-audio.js',
  'line-routes.js', 'stats-line.js', 'next-keywords.js', 'keyword-enabled-lib.js',
  'verify-step.mjs', 'step-judge.mjs', 'checks/probes-lib.js', 'checks/schema.json',
  'checks/douyin-video-discovery.yaml', 'checks/douyin-video-processing.yaml',
  'checks/douyin-comment-scoring.yaml', 'checks/douyin-lead-outreach.yaml',
  'plans/douyin_video_discovery.steps.json', 'plans/douyin_video_processing.steps.json',
  'plans/douyin_comment_scoring.steps.json', 'plans/douyin_lead_outreach.steps.json'];

export function execInput(command, args, { input = '', timeoutMs = 180000, env = process.env } = {}) {
  return new Promise((resolveResult, reject) => {
    // Mac/Linux上每次动作独占进程组，只停止本次动作及其子进程，不碰ADB服务或其他批次。
    const ownGroup = process.platform !== 'win32';
    const child = spawn(command, args, { env, detached: ownGroup, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false, stoppingError, forceTimer;
    const timer = setTimeout(() => stop(Error('EXECUTION_DEADLINE')), timeoutMs);
    function signalOwned(signal) {
      try { if (ownGroup && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if (error.code !== 'ESRCH') child.kill(signal); }
    }
    function stop(error) {
      if (settled || stoppingError) return;
      stoppingError = error;
      signalOwned('SIGTERM');
      forceTimer = setTimeout(() => signalOwned('SIGKILL'), 1000);
    }
    function finish(error, result) {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(forceTimer);
      if (error) reject(error); else resolveResult(result);
    }
    child.on('error', () => finish(Error('EXECUTION_START_FAILED')));
    child.stdout.on('data', chunk => {
      if (stoppingError) return;
      stdout += chunk;
      if (Buffer.byteLength(stdout) > 8 * 1024 * 1024) stop(Error('EXECUTION_OUTPUT_LIMIT'));
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
    // 必须等close：旧动作还活着时不可返回失败并开始操作同一台手机的下一候选。
    child.on('close', code => finish(stoppingError, { code, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export function rpcSource(frozen) {
  return { commit: frozen.deployment.source_commit, files: RPC_FILES.map(path => {
    const sha256 = frozen.files[`runtime/${path}`];
    if (!sha256) throw Error(`冻结发布缺远端依赖: ${path}`);
    return { path, sha256 };
  }) };
}

export function createRpc({ frozen, execute = execInput, local = false } = {}) {
  const source = rpcSource(frozen);
  const peer=frozen.runtime_transport;
  const transport=peer?['-o',`HostName=${peer.ssh_hostname}`,'-o',`HostKeyAlias=${peer.ssh_hostkey_alias}`]:[];
  return async (body, { timeoutMs = 180000 } = {}) => {
    let result;
    if (local) result = await execute(process.execPath, [resolve(process.env.WF_HOME, 'leadgen-rpc.mjs')],
      { input: JSON.stringify({ ...body, source }), timeoutMs });
    else result = await execute('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
      '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2', ...transport, 'mmv',
      'set -a; source ~/.credentials/zenithjoy-db.env; set +a; cd ~/.openclaw/leadgen-scripts && node leadgen-rpc.mjs'],
    { input: JSON.stringify({ ...body, source }), timeoutMs });
    let response;
    try { response = JSON.parse(result.stdout.trim()); } catch { throw Error('远端没有合法回执'); }
    if (result.code !== 0 || response.ok !== true) throw Error(response.error || '远端执行失败');
    return response;
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] !== 'qualify' || process.argv[3] !== 'judge') throw Error('未知调用');
    const args = {};
    for (let n = 4; n < process.argv.length; n += 2) {
      const key = ({ '--line': 'line', '--video-id': 'videoId', '--audio': 'audio' })[process.argv[n]];
      if (!key || !process.argv[n + 1]) throw Error('调用参数无效');
      args[key] = process.argv[n + 1];
    }
    const rpc = createRpc({ frozen: readFrozen(process.env.WFR_RUN_DIR), local: process.env.LEADGEN_LOCAL_RPC === '1' });
    const { result } = await rpc({ kind: 'qualify', request: { ...args, cmd: 'judge' } });
    process.stdout.write(`QUAL_RESULT ${JSON.stringify(result)}\n`);
  } catch {
    process.stdout.write('QUAL_RESULT {"verdict":"pending","kind":"rpc_error"}\n'); process.exitCode = 1;
  }
}
