import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

// 测试用导出：允许注入 baseDir
export function getPythonExeForTest(baseDir: string): string {
  const embedded = path.join(baseDir, 'python-embedded', 'python.exe');
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
  const rpaDir = path.resolve(__dirname, '../../wechat-rpa');
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

// Windows only：Agent 启动时自动拉起 listen_chat.py 持续监听微信消息
export function startWechatListener(apiBase: string): void {
  if (process.platform !== 'win32') {
    console.log('[wechat-rpa] 非 Windows，跳过 listen_chat 自启');
    return;
  }
  const script = path.resolve(__dirname, '../../wechat-rpa/listen_chat.py');
  spawn(getPythonExe(), [script, '--middleware-url', apiBase], {
    detached: true,
    stdio: 'ignore',
  }).unref();
  console.log('[wechat-rpa] listen_chat.py 已自启（middleware-url:', apiBase, '）');
}
