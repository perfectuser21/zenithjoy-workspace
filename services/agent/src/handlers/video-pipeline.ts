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

// ── 中文字体检�?─────────────────────────────────────────────────────────────
export function findChineseFont(): string {
  const candidates = [
    'C:/Windows/Fonts/msyh.ttc',
    'C:/Windows/Fonts/msyh.ttf',
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/simsun.ttc',
  ];
  for (const f of candidates) {
    if (fs.existsSync(f.replace(/\//g, path.sep))) return f;
  }
  return '';
}

// ── FFmpeg drawtext 文字转义 ──────────────────────────────────────────────────
export function escapeDT(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .trim();
}

// ── 场景叠字滤镜 ──────────────────────────────────────────────────────────────
export type SceneData = {
  start: number; duration: number; layout: string;
  eyebrow: string; title: string; body: string; tags?: string[];
};

export function buildOverlayFilters(scenes: SceneData[], w: number, h: number, font: string): string[] {
  if (!scenes.length || !font) return [];
  // Windows 驱动器盘符冒号在 FFmpeg filter 里必须转义为 \:
  const fontPath = font.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
  const filters: string[] = [];
  const yBase = Math.floor(h * 0.70);

  for (const s of scenes) {
    const t0 = Math.max(0, s.start).toFixed(2);
    const t1 = (Math.max(0, s.start) + Math.max(0.5, s.duration)).toFixed(2);
    const en = `between(t,${t0},${t1})`;

    const eyebrow = escapeDT(s.eyebrow || '');
    const title = escapeDT((s.title || '').replace(/\\n/g, ' '));
    const body = escapeDT(s.body || '');

    const boxH = body ? 210 : 150;
    filters.push(`drawbox=x=0:y=${yBase - 50}:w=${w}:h=${boxH}:color=black@0.55:t=fill:enable='${en}'`);

    if (eyebrow) {
      filters.push(`drawtext=fontfile='${fontPath}':text='${eyebrow}':x=(w-text_w)/2:y=${yBase - 28}:fontsize=26:fontcolor=0x818cf8FF:enable='${en}'`);
    }
    if (title) {
      filters.push(`drawtext=fontfile='${fontPath}':text='${title}':x=(w-text_w)/2:y=${yBase + 20}:fontsize=56:fontcolor=white:enable='${en}'`);
    }
    if (body) {
      filters.push(`drawtext=fontfile='${fontPath}':text='${body}':x=(w-text_w)/2:y=${yBase + 100}:fontsize=28:fontcolor=0xFFFFFF99:enable='${en}'`);
    }
  }
  return filters;
}

// ── FFmpeg 路径查找 ─────────────────────────────────────────────────────────
function findFfmpeg(): string {
  // 1. AppData 自动安装位置（ensure-ffmpeg.ts 下载到此处）
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const appDataExe = path.join(appData, 'ZenithJoy', 'runtime', 'ffmpeg', 'ffmpeg.exe');
  if (fs.existsSync(appDataExe)) return appDataExe;
  // 2. 旧版 bundled（pkg 打包目录 / cwd）
  const exeDir = path.dirname(process.execPath);
  const bundled = path.join(exeDir, 'ffmpeg.exe');
  if (fs.existsSync(bundled)) return bundled;
  const cwdBundled = path.join(process.cwd(), 'ffmpeg.exe');
  if (fs.existsSync(cwdBundled)) return cwdBundled;
  // 3. 系统安装位置兜底
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

// ── fireProgress �?fire-and-forget, never throws ─────────────────────────────
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

// ── reportComplete �?retry 3x with 2s backoff, never throws ─────────────────
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
    if (!r.ok) throw new Error(`complete �?HTTP ${r.status}`);
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
  template_id: string | null;
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
      error_msg: `[video-pipeline] src_video 是文件夹而非视频文件，请选择具体�?.mp4/.mov 文件: ${videoPath}`,
    });
    return;
  }

  const outputDir = path.join(path.dirname(videoPath), 'zenithjoy-output', id);
  fs.mkdirSync(outputDir, { recursive: true });
  const tmpDir = path.join(os.tmpdir(), `zj-video-${id}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  console.log(`[video-pipeline] processing job ${id} �?source: ${videoPath}`);

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

    const ffmpegFallback = async (outPath: string, w: number, h: number) => {
      const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`;
      try {
        await runFfmpeg(['-y', '-i', videoPath, '-vf', vf, '-map', '0',
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
          '-c:a', 'aac', '-b:a', '128k', '-t', String(Math.min(duration, 60)), outPath,
        ], { timeout: 600_000 });
      } catch { fs.copyFileSync(videoPath, outPath); }
    };

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

    // ── Template shortcut: skip AI design/compose-html, use server-rendered template ──
    if (job.template_id) {
      const composeResult = await postJson<{ html?: string }>(
        apiBase, `/api/ai-video/jobs/${id}/compose-template`,
        {
          transcript: transcript || topic || '精彩视频',
          duration,
          video_filename: path.basename(videoPath),
        },
        20_000,
      );
      fireProgress(apiBase, id, 65);

      const output916 = path.join(outputDir, '9_16.mp4');
      const output169 = path.join(outputDir, '16_9.mp4');
      const htmlContent = composeResult?.html ?? '';

      if (htmlContent) {
        const hfDir = path.join(tmpDir, 'hf');
        fs.mkdirSync(hfDir, { recursive: true });
        fs.copyFileSync(videoPath, path.join(hfDir, path.basename(videoPath)));
        fs.writeFileSync(path.join(hfDir, 'index.html'), htmlContent, 'utf-8');
        const rendered = path.join(hfDir, 'rendered.mp4');
        try {
          console.log('[video-pipeline] HyperFrames template render...');
          await execAsync('npx hyperframes render --output ' + JSON.stringify(rendered), {
            cwd: hfDir, timeout: 600_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true,
          });
          fs.copyFileSync(rendered, output169);
          await runFfmpeg(['-y', '-i', rendered,
            '-vf', 'crop=ih*9/16:ih:(iw-ih*9/16)/2:0',
            '-c:v', 'libx264', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', output916,
          ], { timeout: 300_000 });
          console.log('[video-pipeline] template render done');
        } catch (err) {
          console.error('[video-pipeline] template HyperFrames failed:', (err as Error).message?.slice(0, 200));
          await ffmpegFallback(output916, 1080, 1920);
          await ffmpegFallback(output169, 1920, 1080);
        }
      } else {
        await ffmpegFallback(output916, 1080, 1920);
        await ffmpegFallback(output169, 1920, 1080);
      }

      console.log(`[video-pipeline] template job ${id} done — outputs at ${outputDir}`);
      await reportComplete(apiBase, id, { output_dir: outputDir });
      return;
    }

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

    // Step 6: BGM 已从 Agent 移除（PiAPI 在服务端生成，非 Agent 职责�?    fireProgress(apiBase, id, 75);

    // Step 7: HyperFrames render (+ FFmpeg fallback)
    const output916 = path.join(outputDir, '9_16.mp4');
    const output169 = path.join(outputDir, '16_9.mp4');
    const htmlContent = htmlResult?.html ?? '';

    if (htmlContent) {
      const hfDir = path.join(tmpDir, 'hf');
      fs.mkdirSync(hfDir, { recursive: true });
      fs.copyFileSync(videoPath, path.join(hfDir, path.basename(videoPath)));
      fs.writeFileSync(path.join(hfDir, 'index.html'), htmlContent, 'utf-8');
      const rendered = path.join(hfDir, 'rendered.mp4');
      try {
        console.log('[video-pipeline] starting HyperFrames render...');
        await execAsync('npx hyperframes render --output ' + JSON.stringify(rendered), {
          cwd: hfDir, timeout: 600_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true,
        });
        fs.copyFileSync(rendered, output169);
        await runFfmpeg(['-y', '-i', rendered,
          '-vf', 'crop=ih*9/16:ih:(iw-ih*9/16)/2:0',
          '-c:v', 'libx264', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', output916,
        ], { timeout: 300_000 });
        console.log('[video-pipeline] HyperFrames render done');
      } catch (err) {
        console.error('[video-pipeline] HyperFrames failed, FFmpeg fallback:', (err as Error).message?.slice(0, 200));
        await ffmpegFallback(output916, 1080, 1920);
        await ffmpegFallback(output169, 1920, 1080);
      }
    } else {
      console.warn('[video-pipeline] no HTML, using FFmpeg fallback');
      await ffmpegFallback(output916, 1080, 1920);
      await ffmpegFallback(output169, 1920, 1080);
    }

    console.log(`[video-pipeline] job ${id} done 鈥?outputs at ${outputDir}`);
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
