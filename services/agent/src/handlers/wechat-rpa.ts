import { spawn } from 'node:child_process';
import path from 'node:path';

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

function resolveScript(task: WechatRpaTask): string {
  if (task.pythonStub) return task.pythonStub;
  // 生产路径: WS3/4 接真 wechat_bot.py / wechat_rpa.py
  // 本 WS1 阶段默认 dryrun stub:
  const repoRoot = path.resolve(__dirname, '../../../..');
  return path.join(repoRoot, 'scripts', 'wechat_rpa_dryrun.py');
}

export async function handleWechatRpa(task: WechatRpaTask): Promise<WechatRpaResult> {
  return new Promise((resolve) => {
    const script = resolveScript(task);
    const py = spawn('python3', [script], { stdio: ['pipe', 'pipe', 'pipe'] });

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
      } catch (e) {
        resolve({ ok: false, error: `receipt parse fail: ${stdout.slice(0, 100)}` });
      }
    });

    py.on('error', e => {
      resolve({ ok: false, error: `spawn fail: ${e.message}` });
    });
  });
}
