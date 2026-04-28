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

// CommonJS bundle：__dirname 直接可用（pkg snapshot fs 内）
// 打包后的实际路径：snapshot/.../services/agent/dist/index.js
// publishers 走 pkg.scripts 也在 snapshot 里：snapshot/.../services/agent/publishers/...
//
// 但 spawn 子进程需要走真实文件系统的脚本路径。打包发行时 publishers/
// 必须以「同 .exe 目录」的形式部署（unpacked），由 process.execPath 推算。
function resolveScriptPath(...segs: string[]): string {
  // 优先：.exe 同目录（生产部署）
  const beside = path.join(path.dirname(process.execPath), ...segs);
  // 次之：repo 开发期路径
  const dev = path.resolve(__dirname, '..', '..', ...segs);
  return beside || dev;
}

const SCRIPT_PATH = resolveScriptPath(
  'publishers',
  'wechat-publisher',
  'publish-wechat-article-draft.cjs',
);

export async function handleWechatPublish(
  taskId: string,
  content: { title: string; body: string },
  emit: (msg: any) => void,
  makeMsg: (type: string, payload: any, taskId?: string) => any,
): Promise<void> {
  emit(makeMsg('task_progress', { stage: 'spawning', pct: 10 }, taskId));

  console.log(`[handler:wechat] spawning ${SCRIPT_PATH} taskId=${taskId}`);

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
      console.log(`[handler:wechat] task ${taskId} exit=${code}`);
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
