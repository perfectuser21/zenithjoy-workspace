// services/agent/src/handlers/wechat-publish.ts
//
// 真调 wechat-publisher 创建公众号草稿（draft-only，绝不群发）。
//
// 安全约束：
//   只 spawn `publish-wechat-article-draft.cjs`（结构上只调 draft/add，
//   不会触达 freepublish/submit 或 message/mass/sendall）。
//   不要切回主发布脚本 publish-wechat-article.cjs，那个会群发。
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM 下没有 __dirname：用 import.meta.url 算
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// services/agent/src/handlers → services/creator/scripts/publishers/wechat-publisher
// 即从当前文件向上 3 级到 services/，再下钻到目标脚本
const SCRIPT_PATH = path.resolve(
  __dirname,
  '../../..',
  'creator/scripts/publishers/wechat-publisher/publish-wechat-article-draft.cjs',
);

export async function handleWechatPublish(
  taskId: string,
  content: { title: string; body: string },
  emit: (msg: any) => void,
  makeMsg: (type: string, payload: any, taskId?: string) => any,
): Promise<void> {
  emit(makeMsg('task_progress', { stage: 'spawning', pct: 10 }, taskId));

  return new Promise((resolve) => {
    const child = spawn(
      'node',
      [
        SCRIPT_PATH,
        '--draft-only',
        '--title', content.title,
        '--body', content.body,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      emit(makeMsg('task_progress', { stage: 'running', pct: 50 }, taskId));
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      emit(makeMsg('task_result', {
        ok: false,
        error: `spawn 失败: ${err.message}`,
      }, taskId));
      resolve();
    });

    child.on('close', (code) => {
      if (code === 0) {
        // wrapper 最后一行 stdout = JSON {ok, draft, mediaId}
        try {
          const lastLine = stdout.trim().split('\n').pop() || '{}';
          const result = JSON.parse(lastLine);
          emit(makeMsg('task_result', {
            ok: true,
            mediaId: result.mediaId,
          }, taskId));
        } catch {
          // 脚本 exit 0 但输出不是 JSON：仍当成功，无 mediaId
          emit(makeMsg('task_result', { ok: true }, taskId));
        }
      } else {
        emit(makeMsg('task_result', {
          ok: false,
          error: (stderr || stdout).slice(-500) || `exit ${code}`,
        }, taskId));
      }
      resolve();
    });
  });
}
