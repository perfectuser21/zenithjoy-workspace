import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

// 测试用导出：允许注入 baseDir；bundled install pack 含 python-embedded/python.exe
export function getPythonExeForTest(baseDir: string): string {
  const embedded = path.join(baseDir, 'python-embedded/python.exe');
  return fs.existsSync(embedded) ? embedded : 'python3';
}

function getPythonExe(): string {
  return getPythonExeForTest(path.dirname(process.execPath));
}

export interface WechatRpaTask {
  type: 'wechat_qr_bind' | 'wechat_moments_send' | 'wechat_private_chat_send';
  payload: Record<string, unknown>;
  pythonStub?: string;
}

export interface WechatRpaResult {
  ok: boolean;
  receipt?: Record<string, unknown>;
  error?: string;
}

// 测试专用导出：暴露路径解析逻辑（不依赖 task 对象）
export function resolveScriptForTest(type: WechatRpaTask['type']): string {
  // pkg 打包后 __dirname 是 /snapshot 虚拟路径，真实 wechat-rpa 在 exe 同级目录。
  const rpaDir = path.join(path.dirname(process.execPath), 'wechat-rpa');
  switch (type) {
    case 'wechat_private_chat_send': return path.join(rpaDir, 'send_chat.py');
    case 'wechat_qr_bind':           return path.join(rpaDir, 'qr_bind.py');
    case 'wechat_moments_send':      return path.join(rpaDir, 'send_moment.py');
    default:                         return path.join(rpaDir, 'send_chat.py');
  }
}

function resolveScript(task: WechatRpaTask): string {
  if (task.pythonStub) return task.pythonStub;
  return resolveScriptForTest(task.type);
}

export async function handleWechatRpa(task: WechatRpaTask): Promise<WechatRpaResult> {
  return new Promise((resolve) => {
    const script = resolveScript(task);
    const py = spawn(getPythonExe(), [script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, REAL_PUBLISH: '1' },
    });

    let stdout = '';
    let stderr = '';
    py.stdout.on('data', d => { stdout += d.toString(); });
    py.stderr.on('data', d => { stderr += d.toString(); });

    py.stdin.write(JSON.stringify({ type: task.type, payload: task.payload }) + '\n');
    py.stdin.end();

    py.on('close', code => {
      if (code !== 0) {
        return resolve({ ok: false, error: `python exit ${code}: ${stderr.slice(0, 200)}` });
      }
      try {
        const receipt = JSON.parse(stdout);
        resolve({ ok: true, receipt });
      } catch {
        resolve({ ok: false, error: `receipt parse fail: ${stdout.slice(0, 100)}` });
      }
    });

    py.on('error', e => {
      resolve({ ok: false, error: `spawn fail: ${e.message}` });
    });
  });
}

// listen_chat.py 持久监听一整天（24h）。默认 300s 会让监听 5 分钟后自动退出，
// 客户机无人值守就此停摆 —— 这是 v1.1.80 客户装完"发消息没反应"的根因。
const LISTENER_TIMEOUT_SEC = 86400;
// 监听进程退出/崩溃后重启间隔（崩溃自愈，无需外部 watchdog / 计划任务）
const LISTENER_RESTART_DELAY_MS = 30_000;

// 测试用导出：构造 listen_chat.py 的 spawn 参数（含持久 --timeout，防"5分钟死"回归）
export function buildListenerSpawnArgs(script: string, apiBase: string): string[] {
  return [script, '--middleware-url', apiBase, '--timeout', String(LISTENER_TIMEOUT_SEC)];
}

// Windows only：Agent 启动时自动拉起 listen_chat.py 持续监听微信消息。
// 持久（timeout 86400）+ 崩溃自愈（退出后 30s 自动重启），随 Agent 生命周期常驻，
// 客户只需双击 start.bat 一次，无需任何手动操作 / 计划任务。
export function startWechatListener(apiBase: string): void {
  if (process.platform !== 'win32') {
    console.log('[wechat-rpa] 非 Windows，跳过 listen_chat 自启');
    return;
  }
  // python-embedded/python.exe 优先（由 getPythonExe() 检测），否则回退 python3
  // pkg 打包后 __dirname 是 /snapshot 虚拟路径，listen_chat.py 在 exe 同级目录。
  const script = path.join(path.dirname(process.execPath), 'wechat-rpa', 'listen_chat.py');

  const spawnOnce = (): void => {
    const child = spawn(getPythonExe(), buildListenerSpawnArgs(script, apiBase), {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'] as const,
      windowsHide: true,
    });
    child.stderr!.on('data', (d: Buffer) => {
      console.warn('[listen_chat stderr]', d.toString().trim());
    });
    child.on('exit', (code) => {
      console.warn(
        `[wechat-rpa] listen_chat.py 退出(code=${code})，${LISTENER_RESTART_DELAY_MS / 1000}s 后自动重启（崩溃自愈）`,
      );
      setTimeout(spawnOnce, LISTENER_RESTART_DELAY_MS).unref?.();
    });
    child.on('error', (err) => {
      console.warn('[wechat-rpa] listen_chat.py 启动失败:', err);
    });
  };

  spawnOnce();
  console.log(
    '[wechat-rpa] listen_chat.py 持久监听已自启（middleware-url:',
    apiBase,
    '，timeout 86400 + 崩溃自愈）',
  );
}
