import { execSync, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

// ── FFmpeg 路径查找 ─────────────────────────────────────────────────────────
function findFfmpeg(): string {
  const exeDir = path.dirname(process.execPath);
  const bundled = path.join(exeDir, 'ffmpeg.exe');
  if (fs.existsSync(bundled)) return bundled;
  const candidates = [
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(os.homedir(), 'ffmpeg\\bin\\ffmpeg.exe'),
  ];
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  try {
    const which = execSync('where ffmpeg', { stdio: 'pipe' }).toString().split('\n')[0].trim();
    if (which) return which;
  } catch { }
  return 'ffmpeg';
}

const FFMPEG = findFfmpeg();

// ── HTTP helpers ─────────────────────────────────────────────────────────────
async function apiGet<T>(apiBase: string, p: string): Promise<T> {
  const r = await fetch(`${apiBase}${p}`);
  return r.json() as Promise<T>;
}

async function apiPost<T>(apiBase: string, p: string, body: unknown): Promise<T> {
  const r = await fetch(`${apiBase}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json() as Promise<T>;
}

async function apiPatch(apiBase: string, p: string, body: unknown): Promise<void> {
  await fetch(`${apiBase}${p}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${url} → ${r.status}`);
  const buf = await r.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(buf));
}

async function progress(apiBase: string, jobId: string, pct: number): Promise<void> {
  await apiPatch(apiBase, `/api/ai-video/jobs/${jobId}/progress`, { progress: pct, status: 'processing' });
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

  // videoPath = Windows 本地路径，直接来自 job.src_video
  const videoPath = job.src_video;
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`[video-pipeline] src_video not found on local disk: ${videoPath}`);
  }

  // 输出目录：视频同级 zenithjoy-output/<id>/
  const outputDir = path.join(path.dirname(videoPath), 'zenithjoy-output', id);
  fs.mkdirSync(outputDir, { recursive: true });

  const tmpDir = path.join(os.tmpdir(), `zj-video-${id}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log(`[video-pipeline] processing job ${id} — source: ${videoPath}`);

  try {
    // ── Step 1: claim job ──────────────────────────────────────────────────
    await apiPatch(apiBase, `/api/ai-video/jobs/${id}/progress`, { progress: 2, status: 'processing' });

    // Step 2 已删除：视频直接来自本地路径，不需要下载

    // ── Step 3: probe duration ─────────────────────────────────────────────
    let duration = 30;
    try {
      const probe = execSync(
        `"${FFMPEG.replace('ffmpeg', 'ffprobe')}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      ).toString().trim();
      const d = parseFloat(probe);
      if (d > 0) duration = d;
    } catch { /* use default */ }
    await progress(apiBase, id, 20);

    // ── Step 4: extract audio ──────────────────────────────────────────────
    const audioPath = path.join(tmpDir, 'audio.wav');
    try {
      await execFileAsync(FFMPEG, [
        '-y', '-i', videoPath,
        '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
        audioPath,
      ]);
    } catch {
      await execFileAsync(FFMPEG, [
        '-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono',
        '-t', String(duration), '-acodec', 'pcm_s16le', audioPath,
      ]);
    }
    await progress(apiBase, id, 28);

    // ── Step 5: transcribe ─────────────────────────────────────────────────
    const audioBuffer = fs.readFileSync(audioPath);
    const transcribeForm = new FormData();
    transcribeForm.append('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');
    let transcribeResult: { transcript: string; segments: { start: number; end: number; text: string }[] } =
      { transcript: topic || '', segments: [] };
    try {
      const r = await fetch(`${apiBase}/api/ai-video/jobs/${id}/transcribe`, {
        method: 'POST',
        body: transcribeForm,
      });
      const data = await r.json() as typeof transcribeResult;
      if (data.transcript || data.segments?.length) transcribeResult = data;
      if (!transcribeResult.transcript && topic) transcribeResult.transcript = topic;
    } catch (err) {
      console.warn('[video-pipeline] transcribe error:', err);
      if (topic) transcribeResult.transcript = topic;
    }
    await progress(apiBase, id, 40);

    // ── Step 6: design scenes ──────────────────────────────────────────────
    let designResult: { scenes: Array<{ start: number; duration: number; layout: string; eyebrow: string; title: string; body: string; tags?: string[] }> } =
      { scenes: [] };
    try {
      designResult = await apiPost(apiBase, `/api/ai-video/jobs/${id}/design`, {
        transcript: transcribeResult.transcript || topic || '精彩内容',
        segments: transcribeResult.segments.length
          ? transcribeResult.segments
          : [{ start: 0, end: duration, text: topic || '精彩内容' }],
        duration,
        topic,
      }) as typeof designResult;
    } catch (err) { console.warn('[video-pipeline] design error:', err); }
    await progress(apiBase, id, 55);

    // ── Step 7: compose HTML ───────────────────────────────────────────────
    const htmlPath = path.join(tmpDir, 'hyperframe.html');
    try {
      const scenes = designResult.scenes.length
        ? designResult.scenes
        : [{ start: 0, duration, layout: 'burst', eyebrow: '精彩内容', title: topic || '视频', body: '', tags: [] }];
      const htmlRes = await apiPost<{ html?: string }>(apiBase, `/api/ai-video/jobs/${id}/compose-html`, {
        scenes,
        duration,
        video_filename: path.basename(videoPath),
      });
      if (htmlRes.html) fs.writeFileSync(htmlPath, htmlRes.html, 'utf-8');
    } catch (err) { console.warn('[video-pipeline] compose-html error:', err); }
    await progress(apiBase, id, 65);

    // ── Step 8: BGM ────────────────────────────────────────────────────────
    const bgmPath = path.join(tmpDir, 'bgm.mp3');
    let hasBgm = false;
    try {
      const bgmRes = await apiPost<{ url?: string }>(apiBase, `/api/ai-video/jobs/${id}/bgm`, {
        style: 'upbeat motivational, electronic, no vocals, 120 BPM',
      });
      if (bgmRes.url) {
        await downloadToFile(bgmRes.url, bgmPath);
        hasBgm = true;
        console.log('[video-pipeline] BGM downloaded');
      }
    } catch (err) { console.warn('[video-pipeline] BGM error (non-fatal):', err); }
    await progress(apiBase, id, 75);

    // ── Step 9: FFmpeg outputs → 写到本地 outputDir ────────────────────────
    const output916 = path.join(outputDir, '9_16.mp4');
    const output169 = path.join(outputDir, '16_9.mp4');
    const bgmArgs: string[] = hasBgm
      ? ['-map', '0:v:0', '-map', '1:a:0', '-shortest']
      : ['-map', '0'];

    const mkOutput = async (outPath: string, w: number, h: number) => {
      const scale = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`;
      try {
        await execFileAsync(FFMPEG, [
          '-y', '-i', videoPath,
          ...(hasBgm ? ['-i', bgmPath] : []),
          '-vf', scale,
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
          '-c:a', 'aac', '-b:a', '128k',
          ...bgmArgs,
          '-t', String(Math.min(duration, 60)),
          outPath,
        ]);
      } catch (err) {
        console.error(`[video-pipeline] FFmpeg ${w}x${h} failed:`, (err as Error).message?.slice(0, 100));
        fs.copyFileSync(videoPath, outPath);
      }
    };

    await mkOutput(output916, 1080, 1920);
    await progress(apiBase, id, 87);
    await mkOutput(output169, 1920, 1080);
    await progress(apiBase, id, 93);

    // ── Step 10: 通知中台完成，带本地 output_dir ───────────────────────────
    console.log(`[video-pipeline] job ${id} complete — outputs at ${outputDir}`);
    await fetch(`${apiBase}/api/ai-video/jobs/${id}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ output_dir: outputDir }),
    });
    await progress(apiBase, id, 100);

  } catch (err) {
    console.error('[video-pipeline] job failed:', err);
    await fetch(`${apiBase}/api/ai-video/jobs/${id}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error_msg: String(err) }),
    }).catch(() => {});
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── polling loop ─────────────────────────────────────────────────────────────
let _running = false;

export function startVideoPipelineLoop(apiBase: string, intervalMs = 15_000): NodeJS.Timeout {
  const tick = async () => {
    if (_running) return;
    _running = true;
    try {
      const data = await apiGet<{ data?: VideoPipelineJob[] }>(apiBase, '/api/ai-video/jobs?status=pending');
      if (data?.data?.length) {
        const job = data.data[0];
        await apiPatch(apiBase, `/api/ai-video/jobs/${job.id}/progress`, { status: 'processing', progress: 1 });
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
