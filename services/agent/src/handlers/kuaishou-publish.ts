// services/agent/src/handlers/kuaishou-publish.ts
//
// 快手发布 handler。
//
// 模式开关 ZENITHJOY_AGENT_REAL_PUBLISH（默认 dryrun，安全优先）：
//   - 未设 / '0' / 'false'：spawn dryrun 脚本（验证登录状态，不触发真实发布）
//   - '1' / 'true'：spawn 真发脚本（真实发布，只在客户机上启用）
//
// content.type 路由（强制显式，未知 type 立即抛错，禁止 silent fallback）：
//   image → publish-kuaishou-image[-dryrun].cjs
//   video → publish-kuaishou-video[-dryrun].cjs
//
// 快手 CDP 端口：19223（区别于抖音 19222，禁止混用）
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';

const SUPPORTED_KUAISHOU_TYPES = new Set(['image', 'video']);

function resolveScriptDir(...segs: string[]): string {
  const explicit = process.env.ZENITHJOY_AGENT_ROOT;
  if (explicit) {
    const p = path.join(explicit, ...segs);
    if (fs.existsSync(p)) return p;
  }
  const beside = path.join(path.dirname(process.execPath), ...segs);
  if (fs.existsSync(beside)) return beside;
  const dev = path.resolve(__dirname, '..', '..', ...segs);
  if (fs.existsSync(dev)) return dev;
  return dev;
}

/**
 * 根据 type + env 中的 ZENITHJOY_AGENT_REAL_PUBLISH 选择 kuaishou publisher 脚本路径。
 *
 * 安全默认 = dryrun：未设 / '0' / 'false' 都走 dryrun。仅 '1' / 'true' 启用真发。
 * 未知 type 显式抛 Error（含 'no script for type'），严禁 fallback。
 */
export function resolveKuaishouScriptPath(
  type: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!SUPPORTED_KUAISHOU_TYPES.has(type)) {
    throw new Error(
      `[type-route] no script for type ${type} on platform kuaishou (supported: ${[...SUPPORTED_KUAISHOU_TYPES].join('/')})`,
    );
  }

  const flag = (env.ZENITHJOY_AGENT_REAL_PUBLISH ?? '').trim().toLowerCase();
  const isReal = flag === '1' || flag === 'true';
  const suffix = isReal ? '' : '-dryrun';
  const file = `publish-kuaishou-${type}${suffix}.cjs`;

  console.log(`[type-route] resolveKuaishouScriptPath type=${type} real=${isReal} script=${file}`);

  return resolveScriptDir('publishers', 'kuaishou-publisher', file);
}

const SAMPLE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAJ0lEQVR42u3OAQ0AAAjDMK5/' +
  '0xjBydxKqSBBgkSCBIkECRIkSJD4DR/0AAFlu3QcAAAAAElFTkSuQmCC';

interface KuaishouContent {
  title: string;
  content: string;
  type?: string;
  images?: string[];
}

function ensureSampleImage(): string {
  const dir = path.join(os.tmpdir(), 'zenithjoy-agent-kuaishou');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const samplePath = path.join(dir, 'sample-100x100.png');
  if (!fs.existsSync(samplePath)) {
    fs.writeFileSync(samplePath, Buffer.from(SAMPLE_PNG_B64, 'base64'));
  }
  return samplePath;
}

export async function handleKuaishouPublish(
  taskId: string,
  content: KuaishouContent,
  emit: (msg: any) => void,
  makeMsg: (type: string, payload: any, taskId?: string) => any,
): Promise<void> {
  emit(makeMsg('task_progress', { stage: 'preparing', pct: 5 }, taskId));

  const contentType = content.type ?? 'image';
  const scriptPath = resolveKuaishouScriptPath(contentType);

  const images =
    content.images && content.images.length > 0 ? content.images : [ensureSampleImage()];

  const queueDir = path.join(os.tmpdir(), 'zenithjoy-agent-kuaishou');
  if (!fs.existsSync(queueDir)) fs.mkdirSync(queueDir, { recursive: true });
  const queueFile = path.join(queueDir, `queue-${taskId}.json`);
  fs.writeFileSync(
    queueFile,
    JSON.stringify({ title: content.title, content: content.content, images }, null, 2),
  );

  emit(makeMsg('task_progress', { stage: 'spawning', pct: 10 }, taskId));

  console.log(`[handler:kuaishou] spawning ${scriptPath} taskId=${taskId} type=${contentType}`);

  return new Promise((resolve) => {
    const child = spawn('node', [scriptPath, queueFile], {
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
      emit(makeMsg('task_result', { ok: false, error: `spawn 失败: ${err.message}` }, taskId));
      resolve();
    });

    child.on('close', (code) => {
      console.log(`[handler:kuaishou] task ${taskId} exit=${code}`);
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
            makeMsg('task_result', { ok: true, dryRun: result.dryRun ?? true, url: result.url }, taskId),
          );
        } catch {
          emit(makeMsg('task_result', { ok: true, dryRun: true }, taskId));
        }
      } else {
        emit(
          makeMsg('task_result', { ok: false, error: (stderr || stdout).slice(-500) || `exit ${code}` }, taskId),
        );
      }
      resolve();
    });
  });
}
