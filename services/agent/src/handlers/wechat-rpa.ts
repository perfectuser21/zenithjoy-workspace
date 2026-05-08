// services/agent/src/handlers/wechat-rpa.ts
//
// Path 4 ws1 — 微信 RPA handler。
// 真 spawn Python 子进程（services/agent/wechat-rpa/<file>.py），
// 子进程 stdin 收 JSON payload，stdout 输出 JSON receipt。
//
// Task type 映射（4 类）：
//   wechat_qr_bind       → qr_bind.py
//   wechat_listen_start  → listen_chat.py
//   wechat_send_chat     → send_chat.py
//   wechat_send_moment   → send_moment.py
//
// 不论 ws2 / ws3 / ws5 谁写 .py 实现，handler 协议都是
// `python <file> [--dryrun]`，stdin 喂 JSON，stdout 末尾行解析为 receipt。

import { spawn } from 'child_process';
import path from 'path';

// 解析 wechat-rpa 脚本目录：开发期 repo / 生产期 .exe 同目录
function resolveWechatRpaDir(): string {
  // 开发期：services/agent/src/handlers/wechat-rpa.ts → ../../wechat-rpa/
  const dev = path.resolve(__dirname, '..', '..', 'wechat-rpa');
  // 生产期：放 .exe 同目录的 wechat-rpa/
  const beside = path.join(path.dirname(process.execPath), 'wechat-rpa');
  return dev || beside;
}

const WECHAT_RPA_DIR = resolveWechatRpaDir();

// task type → python 脚本文件名
const HANDLER_MAP: Record<string, string> = {
  wechat_qr_bind: 'qr_bind.py',
  wechat_listen_start: 'listen_chat.py',
  wechat_send_chat: 'send_chat.py',
  wechat_send_moment: 'send_moment.py',
};

export interface WechatRpaPayload {
  type: 'wechat_qr_bind' | 'wechat_listen_start' | 'wechat_send_chat' | 'wechat_send_moment';
  dryrun?: boolean;
  // 其它字段透传给 python 子进程 stdin
  [key: string]: unknown;
}

type EmitFn = (msg: unknown) => void;
type MakeMsgFn = (type: string, payload: any, taskId?: string) => any;

export async function handleWechatRpa(
  taskId: string,
  payload: WechatRpaPayload,
  emit: EmitFn,
  makeMsg: MakeMsgFn,
): Promise<void> {
  const taskType = payload?.type;
  const scriptName = HANDLER_MAP[taskType as string];

  if (!scriptName) {
    emit(
      makeMsg(
        'task_result',
        {
          ok: false,
          error: `unknown wechat-rpa task type: ${taskType}`,
        },
        taskId,
      ),
    );
    return;
  }

  const scriptPath = path.join(WECHAT_RPA_DIR, scriptName);
  const args: string[] = [scriptPath];
  if (payload.dryrun) {
    args.push('--dryrun');
  }

  emit(makeMsg('task_progress', { stage: 'spawning', pct: 10 }, taskId));
  console.log(`[handler:wechat-rpa] spawn python ${scriptPath} taskId=${taskId} type=${taskType}`);

  return new Promise((resolve) => {
    const child = spawn('python3', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    // 通过 stdin 给 python 喂入完整 payload JSON（python 可选择读或忽略）
    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch (err) {
      console.warn('[handler:wechat-rpa] stdin write failed:', err);
    }

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      emit(makeMsg('task_progress', { stage: 'running', pct: 50 }, taskId));
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      emit(
        makeMsg(
          'task_result',
          {
            ok: false,
            error: `spawn 失败: ${err.message}`,
          },
          taskId,
        ),
      );
      resolve();
    });

    child.on('close', (code) => {
      console.log(`[handler:wechat-rpa] task ${taskId} exit=${code}`);
      if (code !== 0) {
        emit(
          makeMsg(
            'task_result',
            {
              ok: false,
              error: `python 子进程退出 ${code}: ${stderr.slice(0, 500)}`,
            },
            taskId,
          ),
        );
        resolve();
        return;
      }

      // stdout 最后一行作为 receipt JSON
      const lines = stdout.trim().split('\n').filter(Boolean);
      const lastLine = lines[lines.length - 1] || '{}';
      try {
        const receipt = JSON.parse(lastLine);
        emit(makeMsg('task_result', receipt, taskId));
      } catch (e) {
        emit(
          makeMsg(
            'task_result',
            {
              ok: false,
              error: `python stdout 末尾不是合法 JSON: ${lastLine.slice(0, 200)}`,
              stderr: stderr.slice(0, 500),
            },
            taskId,
          ),
        );
      }
      resolve();
    });
  });
}
