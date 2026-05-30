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
// v0.1.7 修复：路径解析按优先级 fallback，每一层都 fs.existsSync 真实存在才返回。
// 老 `beside || dev` 是 bug：beside 永远 truthy（path string 非空），永远不回退 dev。
function resolveScriptPath(...segs: string[]): string {
  // 1) 显式 env 覆盖（运行 .bat 时可设 ZENITHJOY_AGENT_ROOT=安装目录）
  const explicit = process.env.ZENITHJOY_AGENT_ROOT;
  if (explicit) {
    const p = path.join(explicit, ...segs);
    if (fs.existsSync(p)) return p;
  }
  // 2) .exe 同目录的 publishers/...（pkg 打包场景）
  const beside = path.join(path.dirname(process.execPath), ...segs);
  if (fs.existsSync(beside)) return beside;
  // 3) __dirname 推导（npm start 客户机/开发场景）
  // __dirname = .../services/agent/src/handlers → ../../publishers/...
  const dev = path.resolve(__dirname, '..', '..', ...segs);
  if (fs.existsSync(dev)) return dev;
  // 4) 实在找不到，返 dev 让 spawn fail 时 error msg 含路径方便排查
  return dev;
}

export type DouyinPublishType = 'video' | 'image' | 'article';

const SUPPORTED_DOUYIN_TYPES: ReadonlySet<DouyinPublishType> = new Set([
  'video',
  'image',
  'article',
]);

/**
 * 根据 type + ZENITHJOY_AGENT_REAL_PUBLISH 选择 douyin publisher 脚本路径。
 *
 * 旧实现（WS1 thin）硬编码 image，无视 type — 那是 P0 bug 根因。WS2 修复后必须按 type 路由。
 *
 * 安全默认 = dryrun：未设 / '0' / 'false' 都走 dryrun。仅 '1' / 'true' 启用真发。
 *
 * 找不到脚本时**显式抛 Error**，严禁 fallback 到其他 type（防止"视频发成图文"P0 bug 回归）。
 *
 * 兼容旧调用：仅传 env（无 args）→ 等价于 type=image（向后兼容 walking-skeleton-1 现有调用）
 */
export function resolveDouyinScriptPath(
  argsOrEnv?: { type?: DouyinPublishType } | NodeJS.ProcessEnv,
  envArg?: NodeJS.ProcessEnv,
): string {
  // 旧调用形态: resolveDouyinScriptPath() 或 resolveDouyinScriptPath(process.env)
  // 新调用形态: resolveDouyinScriptPath({type:'video'}, process.env)
  let type: DouyinPublishType = 'image';
  let env: NodeJS.ProcessEnv = process.env;
  if (argsOrEnv && typeof argsOrEnv === 'object' && 'type' in argsOrEnv) {
    type = (argsOrEnv as { type?: DouyinPublishType }).type ?? 'image';
    env = envArg ?? process.env;
  } else if (argsOrEnv) {
    env = argsOrEnv as NodeJS.ProcessEnv;
  }

  if (!SUPPORTED_DOUYIN_TYPES.has(type)) {
    throw new Error(
      `[type-route] no script for type ${type} on platform douyin (supported: ${[...SUPPORTED_DOUYIN_TYPES].join('/')})`,
    );
  }

  const flag = (env.ZENITHJOY_AGENT_REAL_PUBLISH ?? '').trim().toLowerCase();
  const isReal = flag === '1' || flag === 'true';
  const suffix = isReal ? '' : '-dryrun';
  // article: publish-douyin-article.cjs (real) / publish-douyin-article-dryrun.cjs (dryrun)
  const file = `publish-douyin-${type}${suffix}.cjs`;

  // [type-route] 第 3 环节日志：Agent 选脚本时的 type
  console.log(`[type-route] resolveDouyinScriptPath type=${type} real=${isReal} script=${file}`);

  return resolveScriptPath('publishers', 'douyin-publisher', file);
}

function isRealPublishMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.ZENITHJOY_AGENT_REAL_PUBLISH ?? '').trim().toLowerCase();
  return flag === '1' || flag === 'true';
}

/**
 * 读取 QR 扫码绑定时存储的本地 session 文件。
 * qr-bind-douyin.ts 扫码成功后写入 ~/.zenithjoy-agent/sessions/douyin-{accountLabel}.json。
 * publisher 子进程需要 DOUYIN_COOKIES env var，但主进程 spawn 时不自动继承该文件内容。
 * 本函数桥接这一 gap：若 DOUYIN_COOKIES 未设，则读文件注入。
 */
function readLocalDouyinSession(accountLabel = 'default'): string | undefined {
  const sessionPath = path.join(
    os.homedir(),
    '.zenithjoy-agent',
    'sessions',
    `douyin-${accountLabel}.json`,
  );
  try {
    if (fs.existsSync(sessionPath)) {
      const raw = fs.readFileSync(sessionPath, 'utf-8');
      console.log(`[handler:douyin] 本地 session 已读取: ${sessionPath}`);
      return raw;
    }
  } catch {
    // ignore
  }
  return undefined;
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

  // 本地 session 注入：DOUYIN_COOKIES 未设时，读 QR 扫码存储的本地 session 文件
  const spawnEnv: NodeJS.ProcessEnv = { ...process.env };
  if (!spawnEnv.DOUYIN_COOKIES) {
    const localSession = readLocalDouyinSession();
    if (localSession) {
      spawnEnv.DOUYIN_COOKIES = localSession;
      console.log('[handler:douyin] 使用本地 QR session 注入 DOUYIN_COOKIES');
    } else {
      console.warn('[handler:douyin] DOUYIN_COOKIES 未设且本地 session 不存在，将尝试 CDP 模式');
    }
  }

  return new Promise((resolve) => {
    const child = nodeSpawn('node', [scriptPath, queueFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv,
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

// v0.1.8: thin walking skeleton 走抖音「图文」发布（publish-douyin-image.cjs）
// 接受 jpg/png/jpeg/webp 图片 + .mp4 (向后兼容 / 给 medium 阶段 video publisher 占位)。
// publisher 收到不支持的文件类型时自己 reject，handler 不在 file picker 阶段就 reject。
const MP4_RE = /\.(jpg|jpeg|png|webp|mp4)$/i;

export interface DouyinPublishTaskPayload {
  task_id: string;
  folder_path: string;
  /** WS2 新增：publish 类型，决定 Agent spawn 哪个脚本。缺省 image（向后兼容 WS1 thin） */
  type?: DouyinPublishType;
}

export interface DouyinPublishTaskOptions {
  apiBase: string;
  licenseKey?: string;
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
  // If path is itself a media file (user bound a single file, not a folder), use it directly
  if (MP4_RE.test(folder)) {
    try {
      if (fs.statSync(folder).isFile()) return folder;
    } catch { /* fall through */ }
  }
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
  licenseKey?: string,
): Promise<void> {
  const url = `${apiBase.replace(/\/+$/, '')}/api/publish/receipt`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (licenseKey) headers['Authorization'] = `Bearer ${licenseKey}`;
  try {
    await fetchImpl(url, {
      method: 'POST',
      headers,
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
  env?: NodeJS.ProcessEnv,
): Promise<{ exitCode: number; stdout: string; stderr: string; spawnError?: Error }> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnImpl('node', [scriptPath, queueFile], {
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(env ? { env } : {}),
      });
    } catch (err) {
      resolve({ exitCode: -1, stdout: '', stderr: '', spawnError: err as Error });
      return;
    }

    if (!child) {
      resolve({ exitCode: -1, stdout: '', stderr: '', spawnError: new Error('spawn returned falsy child') });
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
  const pickFirstMp4 = options.pickFirstMp4 ?? defaultPickFirstMp4;

  const fail = async (error: string): Promise<DouyinPublishTaskResult> => {
    const result = { error };
    await postReceipt(options.apiBase, fetchImpl, payload.task_id, 'failed', result, options.licenseKey);
    return { ok: false, status: 'failed', result };
  };

  // WS2: Agent 拉到任务时打 [type-route] 第 2 环节日志
  const taskType: DouyinPublishType = payload.type ?? 'image';
  if (!payload.type) {
    console.warn('[type-route] payload.type 未指定，使用默认 image（向后兼容 WS1）');
  }
  console.log(
    `[type-route] handleDouyinPublishTask task=${payload.task_id} type=${taskType}`,
  );

  // 按 type 选脚本，找不到立即 fail，严禁 silent fallback
  let scriptPath: string;
  if (options.scriptPath) {
    scriptPath = options.scriptPath;
  } else {
    try {
      scriptPath = resolveDouyinScriptPath({ type: taskType });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return fail(reason);
    }
  }

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
  const queuePayload =
    taskType === 'video'
      ? { title: `[WS1] ${path.basename(mp4)}`, content: 'walking-skeleton-1 dryrun', video_path: mp4 }
      : { title: `[WS1] ${path.basename(mp4)}`, content: 'walking-skeleton-1 dryrun', images: [mp4] };
  fs.writeFileSync(queueFile, JSON.stringify(queuePayload, null, 2));

  console.log(
    `[handler:douyin-task] task=${payload.task_id} mp4=${mp4} script=${scriptPath}`,
  );

  // 本地 session 注入：DOUYIN_COOKIES 未设时，读 QR 扫码存储的本地 session 文件
  const spawnEnv: NodeJS.ProcessEnv = { ...process.env };
  if (!spawnEnv.DOUYIN_COOKIES) {
    const localSession = readLocalDouyinSession();
    if (localSession) {
      spawnEnv.DOUYIN_COOKIES = localSession;
      console.log('[handler:douyin-task] 使用本地 QR session 注入 DOUYIN_COOKIES');
    } else {
      console.warn('[handler:douyin-task] DOUYIN_COOKIES 未设且本地 session 不存在，将尝试 CDP 模式');
    }
  }

  const { exitCode, stdout, stderr, spawnError } = await spawnAndCollect(
    spawnImpl,
    scriptPath,
    queueFile,
    spawnEnv,
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
  await postReceipt(options.apiBase, fetchImpl, payload.task_id, 'success', result, options.licenseKey);

  return { ok: true, status: 'success', result };
}
