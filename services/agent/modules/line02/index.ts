/**
 * line02-lead-gen 模块入口
 * 被 core 通过 child_process.fork() 拉起，收到 config 即回 ready。
 * 轮询 /api/acquisition/pending-collect-tasks，派发采集任务给 keyword-search-douyin.cjs。
 *
 * 两阶段流程：
 *   Stage 1: keyword-search-douyin.cjs → 找视频 URL → 上报（terminal=stage_1）
 *   Stage 2: crawl-comments-douyin.cjs → 每条视频进评论区抓评论者 → 上报（末条 terminal=done）
 */
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';

interface Line02Config {
  apiBase?: string;
  pollIntervalMs?: number;
}

let config: Line02Config = {};
let pollTimer: ReturnType<typeof setTimeout> | null = null;

function apiRequest(url: string, method = 'GET', body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ ok: true });
          }
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function resolvePublishersDir(): string {
  const coreDir = process.env.ZENITHJOY_CORE_DIR;
  return coreDir
    ? path.join(coreDir, 'publishers')
    : path.join(__dirname, '..', '..', 'publishers');
}

function resolveNodeExe(): string {
  return (
    process.env.ZENITHJOY_NODE_BIN ||
    path.join(
      process.env.APPDATA || process.env.HOME || '',
      'ZenithJoy',
      'runtime',
      'nodejs',
      'node.exe',
    )
  );
}

const CRAWL_TIMEOUT_MS = 90_000;

/** Stage 2: 进入视频评论区，抓评论者，返回 commenters 数组（90s 超时保护） */
function spawnCommentCrawl(
  videoUrl: string,
  publishersDir: string,
  nodeExe: string,
): Promise<Array<{ sec_uid: string | null; nickname: string }>> {
  return new Promise((resolve) => {
    const scriptPath = path.join(publishersDir, 'crawl-comments-douyin.cjs');
    if (!fs.existsSync(scriptPath)) {
      process.stderr.write(`[line02] crawl-comments script not found: ${scriptPath}\n`);
      return resolve([]);
    }
    const child = spawn(
      nodeExe,
      [scriptPath, videoUrl, 'unused', 'unused', 'unused', '--stdout-only'],
      { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let lastLine = '';
    let settled = false;
    function finish(commenters: Array<{ sec_uid: string | null; nickname: string }>) {
      if (settled) return;
      settled = true;
      resolve(commenters);
    }
    const timer = setTimeout(() => {
      process.stderr.write(`[line02/crawl-comments] 超时 ${CRAWL_TIMEOUT_MS}ms，kill 子进程\n`);
      child.kill('SIGKILL');
      finish([]);
    }, CRAWL_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      if (lines.length > 0) lastLine = lines[lines.length - 1];
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[line02/crawl-comments] ${chunk}`);
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        if (lastLine) {
          const result = JSON.parse(lastLine) as {
            ok: boolean;
            commenters?: Array<{ sec_uid: string | null; nickname: string }>;
            error?: string;
          };
          if (result.ok && Array.isArray(result.commenters)) {
            return finish(result.commenters);
          }
        }
      } catch {
        // 忽略 JSON 解析错误
      }
      finish([]);
    });
  });
}

function spawnKeywordSearch(keyword: string, taskId: string, apiBase: string): Promise<void> {
  return new Promise((resolve) => {
    const publishersDir = resolvePublishersDir();
    const nodeExe = resolveNodeExe();
    const scriptPath = path.join(publishersDir, 'keyword-search-douyin.cjs');
    if (!fs.existsSync(scriptPath)) {
      process.stderr.write(`[line02] keyword-search script not found: ${scriptPath}\n`);
      return resolve();
    }
    const child = spawn(nodeExe, [scriptPath, keyword, '19222', '5'], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let lastLine = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      if (lines.length > 0) lastLine = lines[lines.length - 1];
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[line02/kw-search] ${chunk}`);
    });
    child.on('close', async () => {
      try {
        if (lastLine) {
          const result = JSON.parse(lastLine) as { ok: boolean; video_urls?: string[]; error?: string };
          if (result.ok && Array.isArray(result.video_urls) && result.video_urls.length > 0) {
            const videos = result.video_urls.slice(0, 5);

            // Stage 1: 上报视频 URL（空 commenters 占位），末条标 stage_1 推进到 stage_1_done
            for (let i = 0; i < videos.length; i++) {
              await apiRequest(`${apiBase}/api/acquisition/collect/report`, 'POST', {
                task_id: taskId,
                keyword,
                video_id: videos[i].split('/').pop() || videos[i],
                commenters: [],
                terminal: i === videos.length - 1 ? 'stage_1' : undefined,
              }).catch(() => {});
            }

            // Stage 2: 逐条视频进评论区抓评论者，末条标 done（真正完成）
            for (let i = 0; i < videos.length; i++) {
              const commenters = await spawnCommentCrawl(videos[i], publishersDir, nodeExe);
              process.stderr.write(
                `[line02] 视频 ${videos[i].split('/').pop()} 评论者: ${commenters.length} 条\n`,
              );
              await apiRequest(`${apiBase}/api/acquisition/collect/report`, 'POST', {
                task_id: taskId,
                keyword,
                video_id: videos[i].split('/').pop() || videos[i],
                commenters,
                terminal: i === videos.length - 1 ? 'done' : undefined,
              }).catch(() => {});
            }
          } else if (result.ok && Array.isArray(result.video_urls) && result.video_urls.length === 0) {
            await apiRequest(`${apiBase}/api/acquisition/collect/report`, 'POST', {
              task_id: taskId,
              keyword,
              video_id: `no-result-${Date.now()}`,
              commenters: [],
              terminal: 'failed',
              error_code: 'NO_VIDEOS_FOUND',
            }).catch(() => {});
          } else if (!result.ok) {
            await apiRequest(`${apiBase}/api/acquisition/collect/report`, 'POST', {
              task_id: taskId,
              keyword,
              video_id: `error-${Date.now()}`,
              commenters: [],
              terminal: 'failed',
              error_code: result.error || 'KEYWORD_SEARCH_FAILED',
            }).catch(() => {});
          }
        }
      } catch {
        // 忽略 JSON 解析错误
      }
      resolve();
    });
  });
}

async function pollAndDispatch() {
  const apiBase = config.apiBase || 'http://localhost:3000';
  try {
    const resp = (await apiRequest(`${apiBase}/api/acquisition/pending-collect-tasks`)) as {
      tasks?: Array<{ task_id: string; keywords: string[]; tenant_id: string }>;
    };
    const tasks = resp?.tasks ?? [];
    for (const task of tasks) {
      const keywords: string[] = Array.isArray(task.keywords) ? task.keywords : [];
      for (const kw of keywords.slice(0, 3)) {
        await spawnKeywordSearch(kw, task.task_id, apiBase);
      }
    }
  } catch (err) {
    process.stderr.write(`[line02] poll error: ${(err as Error).message}\n`);
  }
}

function schedulePoll() {
  const intervalMs = config.pollIntervalMs || 30000;
  pollTimer = setTimeout(async () => {
    await pollAndDispatch();
    schedulePoll();
  }, intervalMs);
}

process.on('message', (msg: { type: string; config?: Line02Config; apiBase?: string; agentId?: string; machineId?: string }) => {
  if (msg?.type === 'config') {
    config = msg.config ?? { apiBase: msg.apiBase };
    schedulePoll();
    process.send?.({ type: 'ready' });
  }
  if (msg?.type === 'stop') {
    if (pollTimer) clearTimeout(pollTimer);
    process.exit(0);
  }
});
