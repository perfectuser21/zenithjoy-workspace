// services/agent/src/handlers/xiaohongshu-publish.ts
//
// 真调 xiaohongshu-publisher 走小红书创作者后台 dry-run，但 *不上传图片、不点发布按钮*。
//
// 安全约束（v0.3）：
//   只 spawn `publish-xiaohongshu-image-dryrun.cjs`（结构上仅验证已登录 + 拦截发布 API，
//   绝不调 /web_api/sns/v2/note 等真发 API，绝不污染小红书公域）。
//   不要切回真发脚本 publish-xiaohongshu-image.cjs。
//
// 输入 payload.content：
//   { title: string; content: string; images?: string[] }
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';

function resolveScriptPath(...segs: string[]): string {
  const beside = path.join(path.dirname(process.execPath), ...segs);
  const dev = path.resolve(__dirname, '..', '..', ...segs);
  return beside || dev;
}

const SCRIPT_PATH = resolveScriptPath(
  'publishers',
  'xiaohongshu-publisher',
  'publish-xiaohongshu-image-dryrun.cjs',
);

const SAMPLE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAJ0lEQVR42u3OAQ0AAAjDMK5/' +
  '0xjBydxKqSBBgkSCBIkECRIkSJD4DR/0AAFlu3QcAAAAAElFTkSuQmCC';

interface XiaohongshuContent {
  title: string;
  content: string;
  images?: string[];
}

function ensureSampleImage(): string {
  const dir = path.join(os.tmpdir(), 'zenithjoy-agent-xiaohongshu');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const samplePath = path.join(dir, 'sample-100x100.png');
  if (!fs.existsSync(samplePath)) {
    fs.writeFileSync(samplePath, Buffer.from(SAMPLE_PNG_B64, 'base64'));
  }
  return samplePath;
}

export async function handleXiaohongshuPublish(
  taskId: string,
  content: XiaohongshuContent,
  emit: (msg: any) => void,
  makeMsg: (type: string, payload: any, taskId?: string) => any,
): Promise<void> {
  emit(makeMsg('task_progress', { stage: 'preparing', pct: 5 }, taskId));

  const images =
    content.images && content.images.length > 0 ? content.images : [ensureSampleImage()];

  const queueDir = path.join(os.tmpdir(), 'zenithjoy-agent-xiaohongshu');
  if (!fs.existsSync(queueDir)) fs.mkdirSync(queueDir, { recursive: true });
  const queueFile = path.join(queueDir, `queue-${taskId}.json`);
  fs.writeFileSync(
    queueFile,
    JSON.stringify(
      {
        title: content.title,
        content: content.content,
        images,
      },
      null,
      2,
    ),
  );

  emit(makeMsg('task_progress', { stage: 'spawning', pct: 10 }, taskId));

  console.log(`[handler:xiaohongshu] spawning ${SCRIPT_PATH} taskId=${taskId}`);

  return new Promise((resolve) => {
    const child = spawn('node', [SCRIPT_PATH, queueFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

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
      emit(
        makeMsg(
          'task_result',
          { ok: false, error: `spawn 失败: ${err.message}` },
          taskId,
        ),
      );
      resolve();
    });

    child.on('close', (code) => {
      console.log(`[handler:xiaohongshu] task ${taskId} exit=${code}`);
      try {
        fs.unlinkSync(queueFile);
      } catch {
        // ignore
      }

      if (code === 0) {
        try {
          const lines = stdout.trim().split('\n');
          const lastJson = lines.reverse().find((l) => l.startsWith('{'));
          const result = lastJson ? JSON.parse(lastJson) : { ok: true };
          emit(
            makeMsg(
              'task_result',
              {
                ok: true,
                dryRun: result.dryRun ?? true,
                url: result.url,
              },
              taskId,
            ),
          );
        } catch {
          emit(makeMsg('task_result', { ok: true, dryRun: true }, taskId));
        }
      } else {
        emit(
          makeMsg(
            'task_result',
            { ok: false, error: (stderr || stdout).slice(-500) || `exit ${code}` },
            taskId,
          ),
        );
      }
      resolve();
    });
  });
}
