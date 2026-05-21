import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureHyperframes } from './ensure-hyperframes';

const execAsync = promisify(exec);

// PKG's execFile wrapper fails with spawn UNKNOWN on Windows; shell-based exec works
function quoteArg(a: string): string {
  return `"${a.replace(/"/g, '\\"')}"`;
}
async function runFfmpeg(args: string[], opts: { timeout?: number } = {}): Promise<void> {
  const cmd = [findFfmpeg(), ...args].map(quoteArg).join(' ');
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

// PATH for HyperFrames subprocess — re-evaluated each call so it picks up the FFmpeg
// path after ensure-ffmpeg.ts finishes downloading (avoids stale module-load-time value).
const _hfEnv = () => {
  const ffmpegExe = findFfmpeg();
  return {
    ...process.env,
    PATH: [path.dirname(ffmpegExe), process.env.PATH].filter(Boolean).join(path.delimiter),
  };
};

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
    if (!r.ok) {
      console.warn(`[video-pipeline] postJson ${p} → HTTP ${r.status}`);
      return null;
    }
    return r.json() as Promise<T>;
  } catch (err) {
    console.warn(`[video-pipeline] postJson ${p} failed:`, (err as Error).message?.slice(0, 120));
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
    console.log(`[video-pipeline] marking ${stale.length} stale job(s) as failed (previous agent crash)`);
    await Promise.allSettled(stale.map((j) =>
      fetchWithTimeout(
        `${apiBase}/api/ai-video/jobs/${j.id}/progress`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'failed', progress: 0 }),
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
    // File not accessible on this machine (e.g. xian-rog picking up a CI runner's job).
    // Release back to pending so the agent that owns the file can pick it up instead of permanently failing.
    console.warn(`[video-pipeline] src_video not accessible locally (${videoPath}) — releasing job back to pending`);
    await fetchWithTimeout(
      `${apiBase}/api/ai-video/jobs/${id}/progress`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending', progress: 0 }),
      },
      5_000,
    ).catch(() => {});
    return;
  }
  if (!fs.statSync(videoPath).isFile()) {
    console.error(`[video-pipeline] ❌ src_video 是文件夹而非视频文件，请选择具体 .mp4/.mov 文件: ${videoPath}`);
    await reportComplete(apiBase, id, {
      error_msg: `[video-pipeline] src_video 是文件夹而非视频文件，请选择具体 .mp4/.mov 文件: ${videoPath}`,
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
      const ffprobePath = findFfmpeg().replace(/ffmpeg(\.exe)?$/i, (m) =>
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

    // Step 3.5: analyze transcript — AI marks keep/remove per segment
    type AnalyzedSegment = { start: number; end: number; text: string; keep: boolean; reason?: string };
    let analyzedSegments: AnalyzedSegment[] = segments.map((s) => ({ ...s, keep: true }));

    if (segments.length > 0) {
      const analyzeResult = await postJson<{ segments: AnalyzedSegment[] }>(
        apiBase, `/api/ai-video/jobs/${id}/analyze-transcript`,
        { segments, duration, topic },
        90_000,
      );
      if (analyzeResult?.segments?.length === segments.length) {
        analyzedSegments = analyzeResult.segments;
        const removedCount = analyzedSegments.filter((s) => !s.keep).length;
        console.log(`[video-pipeline] analyze: ${segments.length} segs, removing ${removedCount} (废话/气口)`);
      } else {
        console.warn('[video-pipeline] analyze-transcript unexpected shape, keeping all segments');
      }
    }
    fireProgress(apiBase, id, 44);

    // Step 3.6: FFmpeg rough cut — concat only "keep" segments
    const keptIntervals = analyzedSegments
      .filter((s) => s.keep)
      .map((s) => ({
        start: Math.max(0, s.start),
        end: Math.min(duration, Math.max(s.start + 0.1, s.end)),
        text: s.text,
      }));

    let roughCutPath = videoPath;
    let refinedSegments = segments;
    let refinedDuration = duration;

    if (keptIntervals.length > 0 && keptIntervals.length < analyzedSegments.length) {
      const rc = path.join(tmpDir, 'rough-cut.mp4');
      const filterParts: string[] = [];
      const concatInputs: string[] = [];
      keptIntervals.forEach((seg, i) => {
        filterParts.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[v${i}]`);
        filterParts.push(`[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${i}]`);
        concatInputs.push(`[v${i}][a${i}]`);
      });
      filterParts.push(`${concatInputs.join('')}concat=n=${keptIntervals.length}:v=1:a=1[outv][outa]`);

      try {
        await runFfmpeg([
          '-y', '-i', videoPath,
          '-filter_complex', filterParts.join(';'),
          '-map', '[outv]', '-map', '[outa]',
          '-c:v', 'libx264', '-crf', '23', '-c:a', 'aac', '-b:a', '128k',
          rc,
        ], { timeout: 300_000 });
        roughCutPath = rc;
        console.log(`[video-pipeline] rough cut done: ${keptIntervals.length}/${analyzedSegments.length} segs kept`);
      } catch (rcErr) {
        console.warn('[video-pipeline] rough cut failed, using original video:', (rcErr as Error).message?.slice(0, 120));
      }

      // Step 3.7: re-calculate timestamps relative to rough-cut timeline
      if (roughCutPath === rc) {
        let offset = 0;
        refinedSegments = keptIntervals.map((seg) => {
          const newStart = offset;
          const dur = seg.end - seg.start;
          offset += dur;
          return { start: newStart, end: newStart + dur, text: seg.text };
        });
        refinedDuration = offset;
        transcript = refinedSegments.map((s) => s.text).join('。');
      }
    }
    fireProgress(apiBase, id, 48);

    // ── Template shortcut: skip AI design/compose-html, use server-rendered template ──
    if (job.template_id) {
      const composeResult = await postJson<{ html?: string }>(
        apiBase, `/api/ai-video/jobs/${id}/compose-template`,
        {
          transcript: transcript || topic || '精彩视频',
          duration: refinedDuration,
          video_filename: path.basename(roughCutPath),
        },
        20_000,
      );
      fireProgress(apiBase, id, 65);

      const output916 = path.join(outputDir, '9_16.mp4');
      const output169 = path.join(outputDir, '16_9.mp4');
      if (!composeResult?.html) {
        throw new Error('[video-pipeline] compose-template 步骤失败，未返回 HTML');
      }
      const htmlContent = composeResult.html;

      const hfDir = path.join(tmpDir, 'hf');
      fs.mkdirSync(hfDir, { recursive: true });
      fs.copyFileSync(roughCutPath, path.join(hfDir, path.basename(roughCutPath)));
      fs.writeFileSync(path.join(hfDir, 'index.html'), htmlContent, 'utf-8');
      const rendered = path.join(hfDir, 'rendered.mp4');
      console.log('[video-pipeline] HyperFrames template render...');
      const hfCmd1 = await ensureHyperframes();
      await execAsync(hfCmd1 + ' render --output ' + JSON.stringify(rendered), {
        cwd: hfDir, timeout: 600_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true,
        env: _hfEnv(),
      });
      // Merge rough-cut audio into HyperFrames output (HF renders silent video)
      const mergedPath = path.join(tmpDir, 'rendered_with_audio.mp4');
      try {
        await runFfmpeg([
          '-y', '-i', rendered, '-i', roughCutPath,
          '-map', '0:v', '-map', '1:a',
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
          '-shortest', mergedPath,
        ], { timeout: 120_000 });
      } catch {
        fs.copyFileSync(rendered, mergedPath);
      }
      fs.copyFileSync(mergedPath, output169);
      await runFfmpeg(['-y', '-i', mergedPath,
        '-vf', 'crop=ih*9/16:ih:(iw-ih*9/16)/2:0',
        '-c:v', 'libx264', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', output916,
      ], { timeout: 300_000 });
      console.log('[video-pipeline] template render done');

      console.log(`[video-pipeline] template job ${id} done — outputs at ${outputDir}`);
      await reportComplete(apiBase, id, { output_dir: outputDir });
      return;
    }

    // Step 4: design scenes using refined transcript + re-timed segments
    type SceneItem = { start: number; duration: number; layout: string; eyebrow: string; title: string; body: string; tags?: string[] };
    const designResult = await postJson<{ scenes: SceneItem[] }>(
      apiBase, `/api/ai-video/jobs/${id}/design`,
      {
        transcript: transcript || '精彩内容',
        segments: refinedSegments.length
          ? refinedSegments
          : [{ start: 0, end: refinedDuration, text: transcript || '精彩内容' }],
        duration: refinedDuration, topic,
      },
      120_000,
    );
    if (!designResult?.scenes?.length) {
      throw new Error('[video-pipeline] design 步骤失败，未返回场景数据');
    }
    const scenes = designResult.scenes;
    fireProgress(apiBase, id, 55);

    // Step 5: compose HTML using rough-cut video filename
    const htmlPath = path.join(tmpDir, 'hyperframe.html');
    const htmlResult = await postJson<{ html?: string }>(
      apiBase, `/api/ai-video/jobs/${id}/compose-html`,
      { scenes, duration: refinedDuration, video_filename: path.basename(roughCutPath) },
      20_000,
    );
    if (!htmlResult?.html) {
      throw new Error('[video-pipeline] compose-html 步骤失败，未返回 HTML');
    }
    fs.writeFileSync(htmlPath, htmlResult.html, 'utf-8');
    fireProgress(apiBase, id, 65);

    fireProgress(apiBase, id, 75);

    // Step 7: HyperFrames render with rough-cut video
    const output916 = path.join(outputDir, '9_16.mp4');
    const output169 = path.join(outputDir, '16_9.mp4');
    const htmlContent = htmlResult.html!;

    const hfDir = path.join(tmpDir, 'hf');
    fs.mkdirSync(hfDir, { recursive: true });
    fs.copyFileSync(roughCutPath, path.join(hfDir, path.basename(roughCutPath)));
    fs.writeFileSync(path.join(hfDir, 'index.html'), htmlContent, 'utf-8');
    const rendered = path.join(hfDir, 'rendered.mp4');
    console.log('[video-pipeline] starting HyperFrames render...');
    const hfCmd2 = await ensureHyperframes();
    await execAsync(hfCmd2 + ' render --output ' + JSON.stringify(rendered), {
      cwd: hfDir, timeout: 600_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true,
      env: _hfEnv(),
    });
    // Merge rough-cut audio into HyperFrames output (HF renders silent video)
    const mergedPath2 = path.join(tmpDir, 'rendered2_with_audio.mp4');
    try {
      await runFfmpeg([
        '-y', '-i', rendered, '-i', roughCutPath,
        '-map', '0:v', '-map', '1:a',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
        '-shortest', mergedPath2,
      ], { timeout: 120_000 });
    } catch {
      fs.copyFileSync(rendered, mergedPath2);
    }
    fs.copyFileSync(mergedPath2, output169);
    await runFfmpeg(['-y', '-i', mergedPath2,
      '-vf', 'crop=ih*9/16:ih:(iw-ih*9/16)/2:0',
      '-c:v', 'libx264', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', output916,
    ], { timeout: 300_000 });
    console.log('[video-pipeline] HyperFrames render done');

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

export function startVideoPipelineLoop(apiBase: string, licenseKey?: string, intervalMs = 15_000): NodeJS.Timeout {
  const tick = async () => {
    if (!_staleRecovered) {
      _staleRecovered = true;
      await recoverStaleJobs(apiBase);
    }
    if (_running) return;
    _running = true;
    try {
      const headers: Record<string, string> = {};
      if (licenseKey) headers['Authorization'] = `Bearer ${licenseKey}`;
      const r = await fetchWithTimeout(`${apiBase}/api/ai-video/jobs?status=pending`, { headers }, 10_000);
      if (!r.ok) {
        console.warn(`[video-pipeline] poll HTTP ${r.status}`);
        return;
      }
      const data = await r.json() as { data?: VideoPipelineJob[] };
      const jobCount = data?.data?.length ?? 0;
      if (jobCount === 0) {
        console.log('[video-pipeline] poll: 0 pending jobs');
      } else {
        const job = data.data![0];
        console.log(`[video-pipeline] picking up job ${job.id} src=${job.src_video}`);
        await fetchWithTimeout(
          `${apiBase}/api/ai-video/jobs/${job.id}/progress`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ status: 'processing', progress: 1 }),
          },
          5_000,
        ).catch((e) => console.warn('[video-pipeline] mark-processing failed:', e.message));
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
