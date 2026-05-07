// services/agent/src/handlers/douyin-publish.ts
//
// 真调 douyin-publisher 走完抖音创作者后台发布流程。
//
// 模式开关 ZENITHJOY_AGENT_REAL_PUBLISH（默认 dryrun，安全优先）：
//   - 未设 / '0' / 'false'：spawn `publish-douyin-image-dryrun.cjs`
//       结构上走完发布流程但不点击发布按钮、绝不调 /web/api/media/aweme/create_v2/
//       不污染抖音公域，开发与 CI smoke 用此模式
//   - '1' / 'true'：spawn `publish-douyin-image.cjs`（真发版）
//       会真点发布按钮、真调 create_v2、产生真实抖音视频；只在客户机上启用
//
// 输入 payload.content：
//   { title: string; content: string; images?: string[] }
//   images 为 Windows 本地路径数组；不传则用本机自带 sample image。
//
// Walking Skeleton #1 扩展：
//   除了原有 WS-driven 的 `handleDouyinPublish`（接 payload.content），
//   新增 `handleDouyinPublishTask` —— 从 heartbeat-loop 派发的 task 里读
//   folder_path，自己拉首个 mp4 → spawn publisher → POST /api/publish/receipt 回执。
import { spawn as nodeSpawn } from 'child_process';
import type { ChildProcess } from 'child_process';
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

/**
 * 根据环境变量 `ZENITHJOY_AGENT_REAL_PUBLISH` 选择 douyin publisher 脚本路径。
 *
 * 安全默认 = dryrun：未设 / '0' / 'false'（不区分大小写）都走 dryrun 脚本。
 * 仅当 '1' 或 'true' 时启用真发脚本。
 *
 * 参数 env 可注入（便于单测），缺省读 process.env。
 */
export function resolveDouyinScriptPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const flag = (env.ZENITHJOY_AGENT_REAL_PUBLISH ?? '').trim().toLowerCase();
  const isReal = flag === '1' || flag === 'true';
  const file = isReal ? 'publish-douyin-image.cjs' : 'publish-douyin-image-dryrun.cjs';
  return resolveScriptPath('publishers', 'douyin-publisher', file);
}

function isRealPublishMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.ZENITHJOY_AGENT_REAL_PUBLISH ?? '').trim().toLowerCase();
  return flag === '1' || flag === 'true';
}

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

  const scriptPath = resolveDouyinScriptPath();
  const realMode = isRealPublishMode();
  console.log(
    `[handler:douyin] spawning ${scriptPath} taskId=${taskId} realPublish=${realMode}`,
  );

  return new Promise((resolve) => {
    const child = nodeSpawn('node', [scriptPath, queueFile], {
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
        // publisher 脚本最后一行 stdout = JSON
        try {
          const lines = stdout.trim().split('\n');
          const lastJson = lines.reverse().find((l) => l.startsWith('{'));
          const result = lastJson ? JSON.parse(lastJson) : { ok: true };
          // dryRun 字段如实回传：脚本输出有就用脚本的，否则按当前模式兜底
          const dryRunFromScript =
            typeof result.dryRun === 'boolean' ? result.dryRun : !realMode;
          emit(
            makeMsg(
              'task_result',
              {
                ok: true,
                dryRun: dryRunFromScript,
                url: result.url,
              },
              taskId,
            ),
          );
        } catch {
          emit(makeMsg('task_result', { ok: true, dryRun: !realMode }, taskId));
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

// ============================================================================
// Walking Skeleton #1 — Task-driven 入口
// ============================================================================
//
// 与上面 `handleDouyinPublish` 的差异：
//   - 上面那个是 WS 链路，emit() 回 ws_server，payload.content 自带图片
//   - 这个是 HTTP heartbeat 链路，从 task.payload.folder_path 拉视频，结束后
//     POST /api/publish/receipt 上报，不依赖 WS

const MP4_RE = /\.mp4$/i;

export interface DouyinPublishTaskPayload {
  task_id: string;
  folder_path: string;
}

export interface DouyinPublishTaskOptions {
  apiBase: string;
  fetchImpl?: typeof fetch;
  spawnImpl?: typeof nodeSpawn;
  scriptPath?: string;
  pickFirstMp4?: (folder: string) => string | null;
}

export interface DouyinPublishTaskResult {
  ok: boolean;
  status: 'success' | 'failed';
  result: { url?: string; error?: string; dryrun_evidence?: unknown };
}

function defaultPickFirstMp4(folder: string): string | null {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(folder);
  } catch {
    return null;
  }
  const mp4s = entries.filter((n) => MP4_RE.test(n)).sort();
  return mp4s.length > 0 ? path.join(folder, mp4s[0]) : null;
}

async function postReceipt(
  apiBase: string,
  fetchImpl: typeof fetch,
  taskId: string,
  status: 'success' | 'failed',
  result: { url?: string; error?: string; dryrun_evidence?: unknown },
): Promise<void> {
  const url = `${apiBase.replace(/\/+$/, '')}/api/publish/receipt`;
  try {
    await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, status, result }),
    });
  } catch (err) {
    console.warn('[handler:douyin-task] POST receipt failed:', err);
  }
}

function spawnAndCollect(
  spawnImpl: typeof nodeSpawn,
  scriptPath: string,
  queueFile: string,
): Promise<{ exitCode: number; stdout: string; stderr: string; spawnError?: Error }> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnImpl('node', [scriptPath, queueFile], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ exitCode: -1, stdout: '', stderr: '', spawnError: err as Error });
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      resolve({ exitCode: -1, stdout, stderr, spawnError: err });
    });
    child.on('close', (code) => {
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

export async function handleDouyinPublishTask(
  payload: DouyinPublishTaskPayload,
  options: DouyinPublishTaskOptions,
): Promise<DouyinPublishTaskResult> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  const scriptPath = options.scriptPath ?? resolveDouyinScriptPath();
  const pickFirstMp4 = options.pickFirstMp4 ?? defaultPickFirstMp4;

  const fail = async (error: string): Promise<DouyinPublishTaskResult> => {
    const result = { error };
    await postReceipt(options.apiBase, fetchImpl, payload.task_id, 'failed', result);
    return { ok: false, status: 'failed', result };
  };

  const mp4 = pickFirstMp4(payload.folder_path);
  if (!mp4) {
    return fail(
      `no mp4 found in folder ${payload.folder_path} (folder empty or missing)`,
    );
  }

  // queue 文件用 task_id 命名，避免并发碰撞
  const queueDir = path.join(os.tmpdir(), 'zenithjoy-agent-douyin');
  if (!fs.existsSync(queueDir)) fs.mkdirSync(queueDir, { recursive: true });
  const queueFile = path.join(queueDir, `task-${payload.task_id}.json`);
  fs.writeFileSync(
    queueFile,
    JSON.stringify(
      {
        title: `[WS1] ${path.basename(mp4)}`,
        content: 'walking-skeleton-1 dryrun',
        images: [mp4],
      },
      null,
      2,
    ),
  );

  console.log(
    `[handler:douyin-task] task=${payload.task_id} mp4=${mp4} script=${scriptPath}`,
  );

  const { exitCode, stdout, stderr, spawnError } = await spawnAndCollect(
    spawnImpl,
    scriptPath,
    queueFile,
  );

  // 清理 queue 文件（错误也要清，避免堆积）
  try {
    fs.unlinkSync(queueFile);
  } catch {
    // ignore
  }

  if (spawnError) {
    return fail(`spawn failed: ${spawnError.message}`);
  }

  if (exitCode !== 0) {
    const tail = (stderr || stdout).slice(-500) || `exit ${exitCode}`;
    return fail(tail);
  }

  // 解析 stdout 最后一行 JSON
  let dryrun: { ok?: boolean; dryRun?: boolean; url?: string } = {};
  try {
    const lines = stdout.trim().split('\n');
    const lastJson = lines.reverse().find((l) => l.startsWith('{'));
    if (lastJson) dryrun = JSON.parse(lastJson);
  } catch {
    // 解析失败也算成功（脚本 exit 0），但 evidence 留空
  }

  const result = {
    url: dryrun.url,
    dryrun_evidence: dryrun,
  };
  await postReceipt(options.apiBase, fetchImpl, payload.task_id, 'success', result);

  return { ok: true, status: 'success', result };
}
