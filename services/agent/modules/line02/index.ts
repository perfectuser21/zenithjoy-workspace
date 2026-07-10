/**
 * line02-lead-gen 模块入口
 * 被 core 通过 child_process.fork() 拉起，收到 config 即回 ready。
 * 轮询 /api/acquisition/pending-collect-tasks，派发采集任务给 keyword-search-douyin.cjs。
 *
 * 两阶段流程（两阶段协议 PR2a）：
 *   Stage 1: 逐关键词搜索视频，汇总清单，一次 POST /api/acquisition/collect/report-videos
 *   Stage 2: crawl-comments-douyin.cjs → 每条视频进评论区抓评论者 → POST /collect/report
 *            爬失败（ok:false/超时）→ 跳过该视频 report，留服务端 sweep-timeouts 收尸
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
let agentId = '';
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let stopPoll = false; // 403 UNKNOWN_AGENT → 停整个 poll

// ────── API 请求层 ──────

interface ApiResponse {
  statusCode: number;
  body: unknown;
}

const VIDEO_ID_RE = /\/video\/(\d+)/;

/** 基础 HTTP 请求，返回 { statusCode, body }，30s 超时 */
function apiRequest(url: string, method = 'GET', body?: unknown): Promise<ApiResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const bodyStr = body ? JSON.stringify(body) : undefined;

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy();
      resolve({ statusCode: 0, body: null });
    }, 30_000);

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
          ...(agentId ? { 'x-agent-id': agentId } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = null;
          }
          resolve({ statusCode: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

type RetryAction = 'retry' | 'abandon' | 'stop_poll' | 'no_retry';

function classifyResponse(statusCode: number, body: unknown): RetryAction {
  if (statusCode === 0) return 'retry'; // 网络超时/断开
  if (statusCode >= 500) return 'retry';
  if (statusCode === 409) return 'abandon'; // TASK_TERMINAL 等
  if (statusCode === 403) {
    const code = (body as { error?: { code?: string } })?.error?.code;
    if (code === 'UNKNOWN_AGENT') return 'stop_poll';
    return 'abandon'; // AGENT_MISMATCH 等
  }
  if (statusCode === 400 || statusCode === 401 || statusCode === 404) return 'no_retry';
  return 'no_retry';
}

/** 带指数退避重试的 apiRequest（网络错/5xx 最多 3 次，其余不重试） */
async function apiRequestWithRetry(
  url: string,
  method = 'GET',
  body?: unknown,
): Promise<ApiResponse | null> {
  const MAX_RETRIES = 3;
  let delay = 1_000;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let resp: ApiResponse;
    try {
      resp = await apiRequest(url, method, body);
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await sleep(delay);
        delay *= 2;
        continue;
      }
      process.stderr.write(`[line02] 请求耗尽重试 ${url}: ${(err as Error).message}\n`);
      return null;
    }

    const action = classifyResponse(resp.statusCode, resp.body);
    if (action === 'stop_poll') {
      process.stderr.write('[line02] 403 UNKNOWN_AGENT，停止 poll\n');
      stopPoll = true;
      return null;
    }
    if (action === 'abandon') {
      process.stderr.write(`[line02] ${resp.statusCode} → abandon: ${JSON.stringify(resp.body)}\n`);
      return null;
    }
    if (action === 'no_retry') {
      process.stderr.write(`[line02] ${resp.statusCode} → no_retry: ${JSON.stringify(resp.body)}\n`);
      return null;
    }
    if (action === 'retry') {
      if (attempt < MAX_RETRIES) {
        await sleep(delay);
        delay *= 2;
        continue;
      }
      process.stderr.write(`[line02] 请求耗尽重试(${resp.statusCode}) ${url}\n`);
      return null;
    }
    return resp; // success（2xx 及其他）
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ────── 工具函数 ──────

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

/** Stage 2: 进入视频评论区，抓评论者。返回 { ok, commenters }：ok:false 表示失败/超时，调用方不发 report */
function spawnCommentCrawl(
  videoUrl: string,
  publishersDir: string,
  nodeExe: string,
): Promise<{ ok: boolean; commenters: Array<{ sec_uid: string | null; nickname: string }> }> {
  return new Promise((resolve) => {
    const scriptPath = path.join(publishersDir, 'crawl-comments-douyin.cjs');
    if (!fs.existsSync(scriptPath)) {
      process.stderr.write(`[line02] crawl-comments script not found: ${scriptPath}\n`);
      return resolve({ ok: false, commenters: [] });
    }
    const child = spawn(
      nodeExe,
      [scriptPath, videoUrl, 'unused', 'unused', 'unused', '--stdout-only'],
      { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let lastLine = '';
    let settled = false;

    function finish(result: { ok: boolean; commenters: Array<{ sec_uid: string | null; nickname: string }> }) {
      if (settled) return;
      settled = true;
      resolve(result);
    }

    child.on('error', (err) => {
      process.stderr.write(`[line02/crawl-comments] spawn error: ${err.message}\n`);
      finish({ ok: false, commenters: [] });
    });

    const timer = setTimeout(() => {
      process.stderr.write(`[line02/crawl-comments] 超时 ${CRAWL_TIMEOUT_MS}ms，kill 子进程\n`);
      child.kill('SIGKILL');
      finish({ ok: false, commenters: [] });
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
            return finish({ ok: true, commenters: result.commenters });
          }
          // ok:false → 失败
          return finish({ ok: false, commenters: [] });
        }
      } catch {
        // JSON 解析失败 → 失败
      }
      finish({ ok: false, commenters: [] });
    });
  });
}

const SEARCH_TIMEOUT_MS = parseInt(process.env.ZENITHJOY_SEARCH_TIMEOUT_MS || '120000', 10);

/** Stage 1 搜索单个关键词，返回 video_id 列表。失败返回 null（含 error_code） */
function searchOneKeyword(
  keyword: string,
  publishersDir: string,
  nodeExe: string,
): Promise<{ ok: boolean; videoIds: string[]; errorCode?: string }> {
  return new Promise((resolve) => {
    const scriptPath = path.join(publishersDir, 'keyword-search-douyin.cjs');
    if (!fs.existsSync(scriptPath)) {
      process.stderr.write(`[line02] keyword-search script not found: ${scriptPath}\n`);
      return resolve({ ok: false, videoIds: [], errorCode: 'NO_HEADFUL_CHROME' });
    }
    const child = spawn(nodeExe, [scriptPath, keyword, '19222', '5'], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let lastLine = '';
    let settled = false;

    function finish(result: { ok: boolean; videoIds: string[]; errorCode?: string }) {
      if (settled) return;
      settled = true;
      resolve(result);
    }

    child.on('error', (err) => {
      process.stderr.write(`[line02/kw-search] spawn error: ${err.message}\n`);
      finish({ ok: false, videoIds: [], errorCode: 'SCRIPT_CRASH' });
    });

    const timer = setTimeout(() => {
      process.stderr.write(`[line02/kw-search] 关键词「${keyword}」超时 ${SEARCH_TIMEOUT_MS}ms\n`);
      child.kill('SIGKILL');
      finish({ ok: false, videoIds: [], errorCode: 'SEARCH_TIMEOUT' });
    }, SEARCH_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      if (lines.length > 0) lastLine = lines[lines.length - 1];
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[line02/kw-search] ${chunk}`);
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        if (lastLine) {
          const result = JSON.parse(lastLine) as {
            ok: boolean;
            video_urls?: string[];
            error?: string;
          };
          if (result.ok && Array.isArray(result.video_urls)) {
            const videoIds = result.video_urls
              .map((u) => { const m = u.match(VIDEO_ID_RE); return m ? m[1] : null; })
              .filter((id): id is string => id !== null);
            return finish({ ok: true, videoIds });
          }
          const errCode = result.error ?? 'SCRIPT_CRASH';
          return finish({ ok: false, videoIds: [], errorCode: errCode });
        }
      } catch {
        // JSON 解析失败
      }
      finish({ ok: false, videoIds: [], errorCode: 'SCRIPT_CRASH' });
    });
  });
}

/**
 * Stage 1 主流程：搜完全部关键词，一次 POST /report-videos
 * 空清单三分支：
 *   - 全空且有 session expired → reason.error_code='DOUYIN_SESSION_EXPIRED'
 *   - 全空且纯脚本失败 → reason.error_code=<首个 errorCode>
 *   - 所有关键词均无结果（ok:true 空） → reason.search_result='empty'
 *   - 部分空部分有 → 只带非空 videos 照常推进
 */
async function runStage1(
  taskId: string,
  keywords: string[],
  apiBase: string,
): Promise<void> {
  const publishersDir = resolvePublishersDir();
  const nodeExe = resolveNodeExe();

  const allVideoIds: string[] = [];
  let sessionExpired = false;
  let firstErrorCode: string | undefined;
  let allOkButEmpty = true; // 是否所有关键词都 ok:true 但返回空列表

  for (const kw of keywords) {
    const result = await searchOneKeyword(kw, publishersDir, nodeExe);
    if (result.ok) {
      if (result.videoIds.length > 0) {
        allOkButEmpty = false;
        for (const id of result.videoIds) {
          if (!allVideoIds.includes(id)) allVideoIds.push(id);
        }
      }
      // ok:true 空列表 → 继续，allOkButEmpty 可能仍 true
    } else {
      allOkButEmpty = false;
      const code = result.errorCode ?? 'SCRIPT_CRASH';
      if (code === 'DOUYIN_SESSION_EXPIRED') sessionExpired = true;
      if (!firstErrorCode) firstErrorCode = code;
      process.stderr.write(`[line02] 关键词「${kw}」失败: ${code}\n`);
    }
  }

  if (sessionExpired) {
    // burner invalidate 副作用保留（来自旧 processCollectTask L1270-1281）
    await fetch(`${apiBase}/api/agent/burner/sessions/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'DOUYIN_SESSION_EXPIRED' }),
    }).catch(() => null);
    process.stderr.write('[line02] Douyin burner session 已过期，已标记 needs_rebind\n');
  }

  const videos = allVideoIds.map((id) => ({ video_id: id }));

  let reason: { search_result?: 'empty'; error_code?: string } | undefined;
  if (videos.length === 0) {
    if (allOkButEmpty && keywords.length > 0) {
      reason = { search_result: 'empty' };
    } else if (sessionExpired) {
      reason = { error_code: 'DOUYIN_SESSION_EXPIRED' };
    } else if (firstErrorCode) {
      reason = { error_code: firstErrorCode };
    } else {
      // 所有关键词为空（无 keywords 传入）
      reason = { search_result: 'empty' };
    }
  }

  await apiRequestWithRetry(`${apiBase}/api/acquisition/collect/report-videos`, 'POST', {
    task_id: taskId,
    videos,
    ...(reason ? { reason } : {}),
  });
}

/** Stage 2 独立入口：直接用已存视频 URL 跑评论采集（stage_1_done 重试用） */
async function runStage2(
  taskId: string,
  videoUrls: string[],
  apiBase: string,
): Promise<void> {
  const publishersDir = resolvePublishersDir();
  const nodeExe = resolveNodeExe();

  for (const url of videoUrls) {
    const videoId = url.match(VIDEO_ID_RE)?.[1] ?? url.split('/').pop() ?? url;
    const result = await spawnCommentCrawl(url, publishersDir, nodeExe);
    if (!result.ok) {
      process.stderr.write(`[line02/stage2] 视频 ${videoId} 爬取失败，跳过 report（服务端 sweep 收尸）\n`);
      continue;
    }
    process.stderr.write(`[line02/stage2] 视频 ${videoId} 评论者: ${result.commenters.length} 条\n`);
    await apiRequestWithRetry(`${apiBase}/api/acquisition/collect/report`, 'POST', {
      task_id: taskId,
      video_id: videoId,
      commenters: result.commenters,
    });
  }
  // 不发 terminal:'done'——服务端全回完自动 done
}

async function pollAndDispatch() {
  if (stopPoll) return;
  if (!agentId) {
    process.stderr.write('[line02] agentId 为空，跳过本轮 poll\n');
    return;
  }
  const apiBase = config.apiBase || 'http://localhost:3000';
  try {
    const resp = await apiRequest(`${apiBase}/api/acquisition/pending-collect-tasks`);
    if (resp.statusCode === 403) {
      const code = (resp.body as { error?: { code?: string } })?.error?.code;
      if (code === 'UNKNOWN_AGENT') {
        process.stderr.write('[line02] UNKNOWN_AGENT，停止 poll\n');
        stopPoll = true;
        return;
      }
    }
    const data = resp.body as {
      tasks?: Array<{
        task_id: string;
        keywords: string[];
        tenant_id: string;
        stage?: string;
        video_urls?: string[];
      }>;
    };
    const tasks = data?.tasks ?? [];
    for (const task of tasks) {
      if (stopPoll) break;
      const keywords: string[] = Array.isArray(task.keywords) ? task.keywords : [];
      if (task.stage === 'stage_2') {
        const videoUrls = Array.isArray(task.video_urls) ? task.video_urls : [];
        if (videoUrls.length > 0) {
          process.stderr.write(`[line02] Stage 2：task=${task.task_id} videos=${videoUrls.length}\n`);
          await runStage2(task.task_id, videoUrls, apiBase);
        }
      } else {
        if (keywords.length === 0) {
          // 空关键词 → 空清单 + empty
          await apiRequestWithRetry(`${apiBase}/api/acquisition/collect/report-videos`, 'POST', {
            task_id: task.task_id,
            videos: [],
            reason: { search_result: 'empty' },
          });
        } else {
          await runStage1(task.task_id, keywords, apiBase);
        }
      }
    }
  } catch (err) {
    process.stderr.write(`[line02] poll error: ${(err as Error).message}\n`);
  }
}

function schedulePoll() {
  if (stopPoll) return;
  const intervalMs = config.pollIntervalMs || 30_000;
  pollTimer = setTimeout(async () => {
    await pollAndDispatch();
    schedulePoll();
  }, intervalMs);
}

process.on('message', (msg: { type: string; config?: Line02Config; apiBase?: string; agentId?: string; machineId?: string }) => {
  if (msg?.type === 'config') {
    config = msg.config ?? { apiBase: msg.apiBase };
    if (msg.agentId) agentId = msg.agentId;
    schedulePoll();
    process.send?.({ type: 'ready' });
  }
  if (msg?.type === 'stop') {
    if (pollTimer) clearTimeout(pollTimer);
    process.exit(0);
  }
});
