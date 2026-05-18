import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

// PKG's execFile wrapper fails with spawn UNKNOWN on Windows; shell-based exec works
function quoteArg(a: string): string {
  return `"${a.replace(/"/g, '\\"')}"`;
}
async function runFfmpeg(args: string[], opts: { timeout?: number } = {}): Promise<void> {
  const cmd = [FFMPEG, ...args].map(quoteArg).join(' ');
  await execAsync(cmd, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout });
}

// ── FFmpeg 路径查找 ─────────────────────────────────────────────────────────
function findFfmpeg(): string {
  const exeDir = path.dirname(process.execPath);
  const bundled = path.join(exeDir, 'ffmpeg.exe');
  if (fs.existsSync(bundled)) return bundled;
  const cwdBundled = path.join(process.cwd(), 'ffmpeg.exe');
  if (fs.existsSync(cwdBundled)) return cwdBundled;
  for (const c of [
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(os.homedir(), 'ffmpeg\\bin\\ffmpeg.exe'),
  ]) { if (fs.existsSync(c)) return c; }
  return 'ffmpeg';
}

const FFMPEG = findFfmpeg();

// ── fetchWithTimeout ─────────────────────────────────────────────────────────
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  ms = 10_000,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── fireProgress — fire-and-forget, never throws ─────────────────────────────
export function fireProgress(apiBase: string, jobId: string, pct: number): void {
  fetchWithTimeout(
    `${apiBase}/api/ai-video/jobs/${jobId}/progress`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress: pct, status: 'processing' }),
    },
    5_000,
  ).catch(() => {});
}

// ── reportComplete — retry 3x with 2s backoff, never throws ─────────────────
async function _reportCompleteWithRetry(
  apiBase: string,
  jobId: string,
  payload: { output_dir?: string; error_msg?: string },
  attempt: number,
): Promise<void> {
  try {
    const r = await fetchWithTimeout(
      `${apiBase}/api/ai-video/jobs/${jobId}/complete`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      15_000,
    );
    if (!r.ok) throw new Error(`complete → HTTP ${r.status}`);
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 2_000));
      return _reportCompleteWithRetry(apiBase, jobId, payload, attempt + 1);
    }
    console.error(`[video-pipeline] reportComplete failed after 3 retries, job=${jobId}:`, err);
  }
}

export async function reportComplete(
  apiBase: string,
  jobId: string,
  payload: { output_dir?: string; error_msg?: string },
): Promise<void> {
  return _reportCompleteWithRetry(apiBase, jobId, payload, 0);
}

// ── JSON helpers (with timeout) ──────────────────────────────────────────────
async function postJson<T>(
  apiBase: string, p: string, body: unknown, timeoutMs: number,
): Promise<T | null> {
  try {
    const r = await fetchWithTimeout(`${apiBase}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!r.ok) return null;
    return r.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ── Stale job recovery ───────────────────────────────────────────────────────
export async function recoverStaleJobs(apiBase: string): Promise<void> {
  try {
    const r = await fetchWithTimeout(
      `${apiBase}/api/ai-video/jobs?status=processing&stale_minutes=5`,
      {}, 10_000,
    );
    if (!r.ok) return;
    const data = await r.json() as { data?: Array<{ id: string }> };
    const stale = data?.data ?? [];
    if (stale.length === 0) return;
    console.log(`[video-pipeline] recovering ${stale.length} stale job(s)`);
    await Promise.allSettled(stale.map((j) =>
      fetchWithTimeout(
        `${apiBase}/api/ai-video/jobs/${j.id}/progress`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'pending', progress: 0 }),
        },
        5_000,
      ).catch(() => {}),
    ));
  } catch (err) {
    console.warn('[video-pipeline] stale recovery error (non-fatal):', err);
  }
}

// ── main job processor ───────────────────────────────────────────────────────

export interface VideoPipelineJob {
  id: string;
  src_video: string | null;
  topic: string | null;
  status: string;
}

export async function processVideoPipelineJob(
  apiBase: string,
  job: VideoPipelineJob,
): Promise<void> {
  const { id, topic } = job;
  const videoPath = job.src_video;
  if (!videoPath || !fs.existsSync(videoPath)) {
    await reportComplete(apiBase, id, {
      error_msg: `[video-pipeline] src_video not found: ${videoPath}`,
    });
    return;
  }
  if (!fs.statSync(videoPath).isFile()) {
    await reportComplete(apiBase, id, {
      error_msg: `[video-pipeline] src_video 是文件夹而非视频文件，请选择具体的 .mp4/.mov 文件: ${videoPath}`,
    });
    return;
  }

  const outputDir = path.join(path.dirname(videoPath), 'zenithjoy-output', id);
  fs.mkdirSync(outputDir, { recursive: true });
  const tmpDir = path.join(os.tmpdir(), `zj-video-${id}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  console.log(`[video-pipeline] processing job ${id} — source: ${videoPath}`);

  try {
    fireProgress(apiBase, id, 2);

    // Step 1: probe duration (shell-based, 30s timeout)
    let duration = 30;
    try {
      const ffprobePath = FFMPEG.replace(/ffmpeg(\.exe)?$/i, (m) =>
        m.replace(/ffmpeg/i, 'ffprobe'));
      const cmd = `${quoteArg(ffprobePath)} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${quoteArg(videoPath)}`;
      const { stdout } = await execAsync(cmd, { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
      const d = parseFloat(stdout.trim());
      if (d > 0) duration = d;
    } catch { /* use default 30s */ }
    fireProgress(apiBase, id, 20);

    // Step 2: extract audio
    const audioPath = path.join(tmpDir, 'audio.wav');
    try {
      await runFfmpeg([
        '-y', '-i', videoPath,
        '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
        audioPath,
      ], { timeout: 120_000 });
    } catch {
      await runFfmpeg([
        '-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono',
        '-t', String(duration), '-acodec', 'pcm_s16le', audioPath,
      ], { timeout: 30_000 });
    }
    fireProgress(apiBase, id, 28);

    // Step 3: transcribe (20s timeout, fallback to topic)
    let transcript = topic || '';
    let segments: Array<{ start: number; end: number; text: string }> = [];
    try {
      const audioBuffer = fs.readFileSync(audioPath);
      const form = new FormData();
      form.append('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      try {
        const r = await fetch(`${apiBase}/api/ai-video/jobs/${id}/transcribe`, {
          method: 'POST', body: form, signal: ctrl.signal,
        });
        if (r.ok) {
          const data = await r.json() as { transcript?: string; segments?: typeof segments };
          if (data.transcript) transcript = data.transcript;
          if (data.segments?.length) segments = data.segments;
        }
      } finally { clearTimeout(timer); }
    } catch (err) {
      console.warn('[video-pipeline] transcribe timeout/error (fallback):', (err as Error).message);
    }
    if (!transcript && topic) transcript = topic;
    fireProgress(apiBase, id, 40);

    // Step 4: design scenes (15s timeout, fallback single scene)
    let scenes: Array<{
      start: number; duration: number; layout: string;
      eyebrow: string; title: string; body: string; tags?: string[];
    }> = [];
    const designResult = await postJson<{ scenes: typeof scenes }>(
      apiBase, `/api/ai-video/jobs/${id}/design`,
      {
        transcript: transcript || '精彩内容',
        segments: segments.length ? segments : [{ start: 0, end: duration, text: transcript || '精彩内容' }],
        duration, topic,
      },
      15_000,
    );
    if (designResult?.scenes?.length) scenes = designResult.scenes;
    if (!scenes.length) {
      scenes = [{ start: 0, duration, layout: 'burst', eyebrow: '精彩内容', title: topic || '视频', body: '', tags: [] }];
    }
    fireProgress(apiBase, id, 55);

    // Step 5: compose HTML (10s timeout, skip on fail)
    const htmlPath = path.join(tmpDir, 'hyperframe.html');
    const htmlResult = await postJson<{ html?: string }>(
      apiBase, `/api/ai-video/jobs/${id}/compose-html`,
      { scenes, duration, video_filename: path.basename(videoPath) },
      10_000,
    );
    if (htmlResult?.html) fs.writeFileSync(htmlPath, htmlResult.html, 'utf-8');
    fireProgress(apiBase, id, 65);

    // Step 6: BGM 已从 Agent 移除（PiAPI 在服务端生成，非 Agent 职责）
    fireProgress(apiBase, id, 75);

    // Step 7: FFmpeg encode
    const output916 = path.join(outputDir, '9_16.mp4');
    const output169 = path.join(outputDir, '16_9.mp4');

    const mkOutput = async (outPath: string, w: number, h: number) => {
      const scale = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`;
      try {
        await runFfmpeg([
          '-y', '-i', videoPath,
          '-vf', scale, '-map', '0',
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
          '-c:a', 'aac', '-b:a', '128k',
          '-t', String(Math.min(duration, 60)),
          outPath,
        ], { timeout: 600_000 });
      } catch (err) {
        console.error(`[video-pipeline] FFmpeg ${w}x${h} failed, copying source:`, (err as Error).message?.slice(0, 120));
        fs.copyFileSync(videoPath, outPath);
      }
    };

    await mkOutput(output916, 1080, 1920);
    fireProgress(apiBase, id, 87);
    await mkOutput(output169, 1920, 1080);
    fireProgress(apiBase, id, 95);

    console.log(`[video-pipeline] job ${id} done — outputs at ${outputDir}`);
    await reportComplete(apiBase, id, { output_dir: outputDir });

  } catch (err) {
    console.error('[video-pipeline] unexpected error:', err);
    await reportComplete(apiBase, id, { error_msg: String(err) });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── polling loop ─────────────────────────────────────────────────────────────
let _running = false;
let _staleRecovered = false;

export function startVideoPipelineLoop(apiBase: string, intervalMs = 15_000): NodeJS.Timeout {
  const tick = async () => {
    if (!_staleRecovered) {
      _staleRecovered = true;
      await recoverStaleJobs(apiBase);
    }
    if (_running) return;
    _running = true;
    try {
      const r = await fetchWithTimeout(`${apiBase}/api/ai-video/jobs?status=pending`, {}, 10_000);
      if (!r.ok) return;
      const data = await r.json() as { data?: VideoPipelineJob[] };
      if (data?.data?.length) {
        const job = data.data[0];
        await fetchWithTimeout(
          `${apiBase}/api/ai-video/jobs/${job.id}/progress`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'processing', progress: 1 }),
          },
          5_000,
        ).catch(() => {});
        await processVideoPipelineJob(apiBase, job);
      }
    } catch (err) {
      console.warn('[video-pipeline] poll error:', err instanceof Error ? err.message : err);
    } finally {
      _running = false;
    }
  };
  tick();
  return setInterval(tick, intervalMs);
}
