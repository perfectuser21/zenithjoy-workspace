// services/agent/src/handlers/douyin-publish.ts
//
// 真调 douyin-publisher 走完抖音创作者后台发布流程，但 *不点击发布按钮*。
//
// 安全约束（v0.1）：
//   只 spawn `publish-douyin-image-dryrun.js`（结构上仅断言发布按钮存在，
//   不调 /web/api/media/aweme/create_v2/，绝不污染抖音公域）。
//   不要切回真发脚本 publish-douyin-image.js，那个会真发首页。
//
// 输入 payload.content：
//   { title: string; content: string; images?: string[] }
//   images 为 Windows 本地路径数组；不传则用本机自带 sample image。
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';

// CommonJS bundle：__dirname 直接可用。
// 同 wechat-publish 的方案：优先 .exe 同目录（生产），次之 repo 开发期路径。
function resolveScriptPath(...segs: string[]): string {
  const beside = path.join(path.dirname(process.execPath), ...segs);
  const dev = path.resolve(__dirname, '..', '..', ...segs);
  return beside || dev;
}

const SCRIPT_PATH = resolveScriptPath(
  'publishers',
  'douyin-publisher',
  'publish-douyin-image-dryrun.cjs',
);

// 自带的 1x1 PNG sample（base64）— 抖音不接受 1x1，但能验证脚本路径走通
// 真验证留给后续传入真实图片路径
const SAMPLE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAJ0lEQVR42u3OAQ0AAAjDMK5/' +
  '0xjBydxKqSBBgkSCBIkECRIkSJD4DR/0AAFlu3QcAAAAAElFTkSuQmCC';

interface DouyinContent {
  title: string;
  content: string;
  images?: string[];
}

function ensureSampleImage(): string {
  const dir = path.join(os.tmpdir(), 'zenithjoy-agent-douyin');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const samplePath = path.join(dir, 'sample-100x100.png');
  if (!fs.existsSync(samplePath)) {
    // 用纯色 100x100 PNG（base64 内嵌，避免外部下载）
    fs.writeFileSync(samplePath, Buffer.from(SAMPLE_PNG_B64, 'base64'));
  }
  return samplePath;
}

export async function handleDouyinPublish(
  taskId: string,
  content: DouyinContent,
  emit: (msg: any) => void,
  makeMsg: (type: string, payload: any, taskId?: string) => any,
): Promise<void> {
  emit(makeMsg('task_progress', { stage: 'preparing', pct: 5 }, taskId));

  const images =
    content.images && content.images.length > 0 ? content.images : [ensureSampleImage()];

  const queueDir = path.join(os.tmpdir(), 'zenithjoy-agent-douyin');
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

  console.log(`[handler:douyin] spawning ${SCRIPT_PATH} taskId=${taskId}`);

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
      console.log(`[handler:douyin] task ${taskId} exit=${code}`);
      // 清理临时 queue 文件
      try {
        fs.unlinkSync(queueFile);
      } catch {
        // ignore
      }

      if (code === 0) {
        // dry-run 脚本最后一行 stdout = JSON
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
