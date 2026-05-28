import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureHyperframes } from './ensure-hyperframes';

const execAsync = promisify(exec);

// ── withRetry: retry a step up to maxAttempts times with exponential backoff ─
async function withRetry<T>(
  stepName: string,
  fn: () => Promise<T>,
  maxAttempts = 3,
  initialDelayMs = 2_000,
): Promise<T> {
  let delay = initialDelayMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err as Error).message?.slice(0, 120) ?? String(err);
      if (attempt < maxAttempts) {
        console.warn(`[${stepName}] attempt ${attempt}/${maxAttempts} failed: ${msg}. Retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 1.5, 15_000);
      } else {
        throw new Error(`[${stepName} FAILED after ${maxAttempts} attempts] ${msg}`);
      }
    }
  }
  throw new Error(`[${stepName}] unreachable`);
}

// PKG's execFile wrapper fails with spawn UNKNOWN on Windows; shell-based exec works
function quoteArg(a: string): string {
  return `"${a.replace(/"/g, '\\"')}"`;
}
async function runFfmpeg(args: string[], opts: { timeout?: number } = {}): Promise<void> {
  const cmd = [findFfmpeg(), ...args].map(quoteArg).join(' ');
  await execAsync(cmd, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout });
}

// ── 中文字体检测 ─────────────────────────────────────────────────────────────
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

// PATH for HyperFrames subprocess
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

// ── fireProgress: fire-and-forget, includes step name for diagnostics ────────
export function fireProgress(apiBase: string, jobId: string, pct: number, step?: string): void {
  fetchWithTimeout(
    `${apiBase}/api/ai-video/jobs/${jobId}/progress`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress: pct, status: 'processing', ...(step ? { step } : {}) }),
    },
    5_000,
  ).catch(() => {});
}

// ── reportComplete: retry 3x with 2s backoff, never throws ──────────────────
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

// ── postJson: returns null on HTTP error or network failure ──────────────────
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
  target_aspect?: string | null;
}

export async function processVideoPipelineJob(
  apiBase: string,
  job: VideoPipelineJob,
): Promise<void> {
  const { id, topic } = job;
  const videoPath = job.src_video;
  if (!videoPath || !fs.existsSync(videoPath)) {
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
    const msg = `src_video is a directory, not a video file: ${videoPath}`;
    console.error('[video-pipeline] ❌ [Step 0 FAILED]', msg);
    await reportComplete(apiBase, id, { error_msg: `[Step 0 FAILED] ${msg}` });
    return;
  }

  const outputDir = path.join(path.dirname(videoPath), 'zenithjoy-output', id);
  fs.mkdirSync(outputDir, { recursive: true });
  const tmpDir = path.join(os.tmpdir(), `zj-video-${id}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  console.log(`[video-pipeline] ▶ job ${id} template=${job.template_id ?? 'none'} src=${videoPath}`);

  try {
    fireProgress(apiBase, id, 2, 'start');

    // ── Step 1: ffprobe — duration + rotation (REQUIRED, retry 3x) ──
    console.log(`[Step 1/7] ffprobe: measuring duration + rotation`);
    let duration = 0;
    let videoRotation = 0;

    const ffprobePath = findFfmpeg().replace(/ffmpeg(\.exe)?$/i, (m) =>
      m.replace(/ffmpeg/i, 'ffprobe'));
    await withRetry('Step 1/7 ffprobe-duration', async () => {
      const durationCmd = `${quoteArg(ffprobePath)} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${quoteArg(videoPath)}`;
      const { stdout } = await execAsync(durationCmd, { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
      duration = parseFloat(stdout.trim());
      if (!(duration > 0)) throw new Error(`invalid duration output: "${stdout.trim()}"`);
    }, 3, 1_000);

    // Rotation + dimension detection — non-fatal (defaults are safe).
    // JSON mode captures both legacy stream_tags.rotate AND modern Display Matrix side data.
    // Modern iPhones and Android phones store rotation in Display Matrix, not the rotate tag.
    let rawWidth = 0;
    let rawHeight = 0;
    try {
      const rotCmd = `${quoteArg(ffprobePath)} -v error -select_streams v:0 -print_format json -show_streams ${quoteArg(videoPath)}`;
      const { stdout: rotOut } = await execAsync(rotCmd, { windowsHide: true, timeout: 10_000, maxBuffer: 512 * 1024 });
      interface FfprobeStream {
        width?: number;
        height?: number;
        tags?: { rotate?: string };
        side_data_list?: Array<{ side_data_type?: string; rotation?: number }>;
      }
      const probe = JSON.parse(rotOut) as { streams?: FfprobeStream[] };
      const vStream = probe.streams?.[0];
      rawWidth = vStream?.width ?? 0;
      rawHeight = vStream?.height ?? 0;
      // 1. Display Matrix (modern phones): rotation is negative-CCW, -90 = needs 90° CW correction
      const displayMatrix = vStream?.side_data_list?.find(
        (sd) => sd.side_data_type === 'Display Matrix',
      );
      if (displayMatrix?.rotation !== undefined) {
        videoRotation = Math.abs(Math.round(displayMatrix.rotation));
      }
      // 2. Legacy stream tag fallback
      if (!videoRotation && vStream?.tags?.rotate) {
        videoRotation = parseInt(vStream.tags.rotate, 10) || 0;
      }
    } catch { /* non-fatal */ }

    // Swap dimensions when video is rotated 90° or 270° (phone portrait video)
    const effectiveWidth = (videoRotation === 90 || videoRotation === 270) ? rawHeight : rawWidth;
    const effectiveHeight = (videoRotation === 90 || videoRotation === 270) ? rawWidth : rawHeight;
    const detectedAspect: '9:16' | '16:9' = (effectiveWidth > 0 && effectiveWidth < effectiveHeight) ? '9:16' : '16:9';

    // PATCH detected_aspect back to API (fire-and-forget, non-fatal)
    fetch(`${apiBase}/api/ai-video/jobs/${id}/progress`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ detected_aspect: detectedAspect }),
    }).catch(() => {});

    const effectiveTarget: '9:16' | '16:9' =
      (job.target_aspect === '9:16' || job.target_aspect === '16:9')
        ? job.target_aspect
        : detectedAspect;

    console.log(`[Step 1/7] ✓ duration=${duration.toFixed(1)}s rotation=${videoRotation}° dim=${effectiveWidth}×${effectiveHeight} detectedAspect=${detectedAspect} effectiveTarget=${effectiveTarget}`);
    fireProgress(apiBase, id, 20, 'step1_probe');

    // ── Step 2: audio extraction (REQUIRED, retry 3x) ──────────────────────
    console.log(`[Step 2/7] audio: extracting WAV`);
    const audioPath = path.join(tmpDir, 'audio.wav');
    await withRetry('Step 2/7 audio-extract', async () => {
      try {
        await runFfmpeg([
          '-y', '-i', videoPath,
          '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
          audioPath,
        ], { timeout: 120_000 });
        console.log(`[Step 2/7] attempt ✓ real audio extracted`);
      } catch (primaryErr) {
        console.warn(`[Step 2/7] no audio stream (${(primaryErr as Error).message?.slice(0, 60)}), generating silent WAV`);
        await runFfmpeg([
          '-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono',
          '-t', String(duration), '-acodec', 'pcm_s16le', audioPath,
        ], { timeout: 30_000 });
        console.log(`[Step 2/7] attempt ✓ silent WAV generated`);
      }
    }, 3, 2_000);
    console.log(`[Step 2/7] ✓ audio ready`);
    fireProgress(apiBase, id, 28, 'step2_audio');

    // ── Step 3: transcription (retry 3x, topic fallback if all fail) ────────
    console.log(`[Step 3/7] transcribe: uploading ${Math.round(fs.statSync(audioPath).size / 1024)}KB audio`);
    let transcript = '';
    let segments: Array<{ start: number; end: number; text: string }> = [];
    try {
      await withRetry('Step 3/7 transcribe', async () => {
        const audioBuffer = fs.readFileSync(audioPath);
        const form = new FormData();
        form.append('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 60_000);
        try {
          const r = await fetch(`${apiBase}/api/ai-video/jobs/${id}/transcribe`, {
            method: 'POST', body: form, signal: ctrl.signal,
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json() as { transcript?: string; segments?: typeof segments };
          transcript = data.transcript ?? '';
          segments = data.segments ?? [];
          console.log(`[Step 3/7] attempt ✓ transcript ${transcript.length} chars, ${segments.length} segments`);
        } finally { clearTimeout(timer); }
      }, 3, 3_000);
    } catch (err) {
      console.warn(`[Step 3/7] transcribe failed after 3 attempts: ${(err as Error).message}`);
    }

    if (!transcript && topic) {
      console.warn(`[Step 3/7] ⚠ using topic as transcript fallback: "${topic.slice(0, 50)}"`);
      transcript = topic;
    }
    if (!transcript) {
      throw new Error('[Step 3 FAILED after 3 retries] no transcript and no topic');
    }
    console.log(`[Step 3/7] ✓ transcript ready (${transcript.length} chars)`);
    fireProgress(apiBase, id, 40, 'step3_transcribe');

    // ── Step 3.5: analyze (non-critical, soft warn) ──────────────────────────
    console.log(`[Step 3.5/7] analyze: AI keep/remove on ${segments.length} segments`);
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
        console.log(`[Step 3.5/7] ✓ removing ${removedCount}/${segments.length} segments`);
      } else {
        console.warn(`[Step 3.5/7] ⚠ unexpected analyze shape — keeping all ${segments.length} segments`);
      }
    } else {
      console.log(`[Step 3.5/7] ✓ no segments (no Whisper output), skipping`);
    }
    fireProgress(apiBase, id, 44, 'step35_analyze');

    // ── Step 3.6: rough cut (REQUIRED if any cuts needed) ───────────────────
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
      console.log(`[Step 3.6/7] rough-cut: keeping ${keptIntervals.length}/${analyzedSegments.length} segments`);
      const rc = path.join(tmpDir, 'rough-cut.mp4');
      const filterParts: string[] = [];
      const concatInputs: string[] = [];
      keptIntervals.forEach((seg, i) => {
        filterParts.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[v${i}]`);
        filterParts.push(`[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${i}]`);
        concatInputs.push(`[v${i}][a${i}]`);
      });
      filterParts.push(`${concatInputs.join('')}concat=n=${keptIntervals.length}:v=1:a=1[outv][outa]`);

      await withRetry('Step 3.6/7 rough-cut', async () => {
        await runFfmpeg([
          '-y', '-i', videoPath,
          '-filter_complex', filterParts.join(';'),
          '-map', '[outv]', '-map', '[outa]',
          '-c:v', 'libx264', '-crf', '23', '-c:a', 'aac', '-b:a', '128k',
          rc,
        ], { timeout: 300_000 });
      }, 3, 2_000);
      roughCutPath = rc;
      console.log(`[Step 3.6/7] ✓ rough cut done`);

      // Re-calculate timestamps relative to rough-cut timeline
      let offset = 0;
      refinedSegments = keptIntervals.map((seg) => {
        const newStart = offset;
        const dur = seg.end - seg.start;
        offset += dur;
        return { start: newStart, end: newStart + dur, text: seg.text };
      });
      refinedDuration = offset;
      transcript = refinedSegments.map((s) => s.text).join('。');
    } else if (keptIntervals.length === 0 && analyzedSegments.length > 0) {
      console.warn('[Step 3.6/7] ⚠ all segments marked remove — keeping original video');
    } else {
      console.log('[Step 3.6/7] ✓ no cuts needed, using original video');
    }
    fireProgress(apiBase, id, 48, 'step36_roughcut');

    // ── Step 3.7: normalize rotation (non-template path only) ────────────────
    // rough-cut re-encodes strip rotation metadata; bake it into pixels so
    // HyperFrames renders the video in the correct orientation.
    // Template path handles rotation in Step 6 via -noautorotate + transpose filter — skip here.
    if (!job.template_id && videoRotation && videoRotation !== 0) {
      const rotMap: Record<number, string[]> = {
        90:  ['transpose=1'],
        270: ['transpose=2'],
        180: ['hflip,vflip'],
      };
      const vfArg = rotMap[videoRotation];
      if (vfArg) {
        const rotated = path.join(tmpDir, 'rotated.mp4');
        console.log(`[Step 3.7/7] normalizing rotation ${videoRotation}° via ${vfArg[0]}`);
        await withRetry('Step 3.7/7 normalize-rotation', async () => {
          await runFfmpeg([
            '-y', '-i', roughCutPath,
            '-vf', vfArg[0],
            '-c:v', 'libx264', '-crf', '22', '-c:a', 'copy',
            '-metadata:s:v:0', 'rotate=0',
            rotated,
          ], { timeout: 300_000 });
          if (!fs.existsSync(rotated)) throw new Error('rotation normalize produced no output');
        }, 2, 2_000);
        roughCutPath = rotated;
        console.log(`[Step 3.7/7] ✓ rotation normalized`);
      }
    }

    // ── Template path ────────────────────────────────────────────────────────
    if (job.template_id) {
      type PhoneRect = { x: number; y: number; w: number; h: number };

      // Step 4: compose-template (REQUIRED)
      console.log(`[Step 4/7] compose-template: generating HTML for template "${job.template_id}"`);
      let composeResult!: { html?: string; aspect?: string; phoneRect?: PhoneRect | null };
      await withRetry('Step 4/7 compose-template', async () => {
        const _cr = await postJson<{ html?: string; aspect?: string; phoneRect?: PhoneRect | null }>(
          apiBase, `/api/ai-video/jobs/${id}/compose-template`,
          {
            transcript: transcript || topic || '精彩视频',
            segments: refinedSegments,
            duration: refinedDuration,
            video_filename: path.basename(roughCutPath),
          },
          60_000,
        );
        if (!_cr?.html) throw new Error('compose-template returned no HTML');
        composeResult = _cr;
      }, 3, 3_000);
      const htmlContent = composeResult.html!;
      const templateAspect = composeResult.aspect ?? '16:9';
      const phoneRect = composeResult.phoneRect ?? null;
      console.log(`[Step 4/7] ✓ HTML ${htmlContent.length} chars, aspect=${templateAspect}, phoneRect=${JSON.stringify(phoneRect)}`);
      fireProgress(apiBase, id, 60, 'step4_compose');

      // Step 5: HyperFrames render (REQUIRED)
      console.log(`[Step 5/7] HyperFrames: rendering template to video`);
      const hfDir = path.join(tmpDir, 'hf');
      fs.mkdirSync(hfDir, { recursive: true });
      fs.writeFileSync(path.join(hfDir, 'index.html'), htmlContent, 'utf-8');
      const rendered = path.join(hfDir, 'rendered.mp4');
      const hfCmd = await ensureHyperframes();
      await withRetry('Step 5/7 hf-render', async () => {
        await execAsync(hfCmd + ' render --output ' + JSON.stringify(rendered), {
          cwd: hfDir, timeout: 600_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true,
          env: _hfEnv(),
        });
        if (!fs.existsSync(rendered)) throw new Error('HyperFrames produced no output file');
      }, 2, 3_000);
      console.log(`[Step 5/7] ✓ HyperFrames rendered`);
      fireProgress(apiBase, id, 75, 'step5_hf');

      // Step 6: phone overlay (REQUIRED if phoneRect exists, throw on failure)
      console.log(`[Step 6/7] overlay: compositing rough-cut into template phone screen`);
      const mergedPath = path.join(tmpDir, 'final.mp4');

      if (phoneRect) {
        const { x, y, w, h } = phoneRect;
        // Rotation: phone videos encoded landscape with rotate=90 metadata need transpose
        const rotPrefix = videoRotation === 90 ? 'transpose=1,' :
                          videoRotation === 270 ? 'transpose=2,' :
                          videoRotation === 180 ? 'hflip,vflip,' : '';
        const filterComplex =
          `[1:v]${rotPrefix}scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}[ph];` +
          `[0:v][ph]overlay=${x}:${y}:shortest=1[out]`;
        console.log(`[Step 6/7] phoneRect x=${x} y=${y} w=${w} h=${h} rotation=${videoRotation}°`);
        await withRetry('Step 6/7 overlay', async () => {
          // -noautorotate on roughCutPath prevents FFmpeg from auto-applying rotate metadata
          // before our filter sees the raw frame. We apply rotation manually via transpose.
          await runFfmpeg([
            '-y', '-i', rendered, '-noautorotate', '-i', roughCutPath,
            '-filter_complex', filterComplex,
            '-map', '[out]', '-map', '1:a?',
            '-c:v', 'libx264', '-crf', '23', '-c:a', 'aac', '-b:a', '128k',
            '-t', String(refinedDuration),
            mergedPath,
          ], { timeout: 300_000 });
        }, 3, 2_000);
        console.log(`[Step 6/7] ✓ phone overlay done (rotation=${videoRotation}°)`);
      } else {
        // No phoneRect — full-frame template, merge audio only
        console.log(`[Step 6/7] no phoneRect — full-frame template, merging audio only`);
        try {
          await runFfmpeg([
            '-y', '-i', rendered, '-i', roughCutPath,
            '-map', '0:v', '-map', '1:a',
            '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
            '-shortest', mergedPath,
          ], { timeout: 120_000 });
        } catch {
          console.warn(`[Step 6/7] ⚠ audio merge failed, using silent template`);
          fs.copyFileSync(rendered, mergedPath);
        }
        console.log(`[Step 6/7] ✓ audio merged`);
      }
      fireProgress(apiBase, id, 92, 'step6_overlay');

      // Step 7: copy to output
      console.log(`[Step 7/7] output: writing to ${outputDir}`);
      if (templateAspect === '9:16') {
        fs.copyFileSync(mergedPath, path.join(outputDir, '9_16.mp4'));
      } else if (templateAspect === '16:9') {
        fs.copyFileSync(mergedPath, path.join(outputDir, '16_9.mp4'));
      } else {
        throw new Error(`[Step 7 FAILED] unsupported aspect: ${templateAspect}`);
      }
      console.log(`[Step 7/7] ✓ template job ${id} done → ${outputDir}`);
      await reportComplete(apiBase, id, { output_dir: outputDir });
      return;
    }

    // ── Non-template path ────────────────────────────────────────────────────

    // Step 4B: design scenes
    console.log(`[Step 4/7] design: generating scene layout`);
    type SceneItem = { start: number; duration: number; layout: string; eyebrow: string; title: string; body: string; tags?: string[] };
    let designResult: { scenes: SceneItem[] } | null = null;
    await withRetry('Step 4/7 design', async () => {
      designResult = await postJson<{ scenes: SceneItem[] }>(
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
      if (!designResult?.scenes?.length) throw new Error('design returned no scenes');
    }, 3, 3_000);
    if (!designResult || !(designResult as { scenes: SceneItem[] }).scenes?.length) {
      throw new Error('[Step 4 FAILED after 3 retries] design returned no scenes');
    }
    const scenes = (designResult as { scenes: SceneItem[] }).scenes;
    console.log(`[Step 4/7] ✓ design: ${scenes.length} scenes`);
    fireProgress(apiBase, id, 55, 'step4_design');

    // Step 5B: compose HTML
    console.log(`[Step 5/7] compose-html: building HyperFrames HTML`);
    let htmlResult!: { html?: string };
    await withRetry('Step 5/7 compose-html', async () => {
      const _hr = await postJson<{ html?: string }>(
        apiBase, `/api/ai-video/jobs/${id}/compose-html`,
        { scenes, duration: refinedDuration, video_filename: path.basename(roughCutPath) },
        20_000,
      );
      if (!_hr?.html) throw new Error('compose-html returned no HTML');
      htmlResult = _hr;
    }, 3, 3_000);
    console.log(`[Step 5/7] ✓ compose-html: ${htmlResult.html!.length} chars`);
    fireProgress(apiBase, id, 65, 'step5_html');

    // Step 6B: HyperFrames render
    console.log(`[Step 6/7] HyperFrames: rendering HTML animation (target=${effectiveTarget})`);
    const output916 = path.join(outputDir, '9_16.mp4');
    const output169 = path.join(outputDir, '16_9.mp4');

    const hfDir2 = path.join(tmpDir, 'hf');
    fs.mkdirSync(hfDir2, { recursive: true });
    fs.copyFileSync(roughCutPath, path.join(hfDir2, path.basename(roughCutPath)));
    fs.writeFileSync(path.join(hfDir2, 'index.html'), htmlResult.html!, 'utf-8');
    const rendered2 = path.join(hfDir2, 'rendered.mp4');
    const hfCmd2 = await ensureHyperframes();
    await withRetry('Step 6/7 hf-render', async () => {
      await execAsync(hfCmd2 + ' render --output ' + JSON.stringify(rendered2), {
        cwd: hfDir2, timeout: 600_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true,
        env: _hfEnv(),
      });
      if (!fs.existsSync(rendered2)) throw new Error('HyperFrames produced no output file');
    }, 2, 3_000);
    console.log(`[Step 6/7] ✓ HyperFrames rendered`);
    fireProgress(apiBase, id, 85, 'step6_hf');

    // Step 7B: merge audio + single-file output based on effectiveTarget
    console.log(`[Step 7/7] output: merging audio, writing ${effectiveTarget}`);
    const mergedPath2 = path.join(tmpDir, 'rendered_with_audio.mp4');
    try {
      await runFfmpeg([
        '-y', '-i', rendered2, '-i', roughCutPath,
        '-map', '0:v', '-map', '1:a',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
        '-shortest', mergedPath2,
      ], { timeout: 120_000 });
    } catch {
      console.warn('[Step 7/7] ⚠ audio merge failed, using silent rendered video');
      fs.copyFileSync(rendered2, mergedPath2);
    }
    if (effectiveTarget === '9:16') {
      await runFfmpeg(['-y', '-i', mergedPath2,
        '-vf', 'crop=ih*9/16:ih:(iw-ih*9/16)/2:0',
        '-c:v', 'libx264', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', output916,
      ], { timeout: 300_000 });
    } else {
      fs.copyFileSync(mergedPath2, output169);
    }
    console.log(`[Step 7/7] ✓ job ${id} done → ${outputDir}`);
    await reportComplete(apiBase, id, { output_dir: outputDir });

  } catch (err) {
    const errMsg = String(err);
    console.error('[video-pipeline] ❌ FAILED:', errMsg);
    await reportComplete(apiBase, id, { error_msg: errMsg });
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
        console.log(`[video-pipeline] picking up job ${job.id} template=${job.template_id ?? 'none'} src=${job.src_video}`);
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
