/**
 * services/agent/src/handlers/video-pipeline.ts
 *
 * Windows Agent — 视频本地流水线处理器
 *
 * 流程：
 *   轮询 GET /api/ai-video/jobs?status=pending
 *   → 下载源视频到本地 temp
 *   → FFmpeg 提取音频
 *   → POST /:id/transcribe (Gemini via 中台)
 *   → POST /:id/design (Claude via 中台)
 *   → POST /:id/compose-html
 *   → POST /:id/bgm (PiAPI via 中台)
 *   → FFmpeg 生成 9:16 + 16:9 MP4
 *   → POST /:id/upload-output 把 MP4 上传回 Mac 中台
 */

import { execFile, execSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import https from 'https';
import http from 'http';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

// ── FFmpeg 路径查找 ─────────────────────────────────────────────────────────

function findFfmpeg(): string {
  // 1. 同目录 ffmpeg.exe (install pack 捆绑)
  const exeDir = path.dirname(process.execPath);
  const bundled = path.join(exeDir, 'ffmpeg.exe');
  if (fs.existsSync(bundled)) return bundled;

  // 2. 常见 Windows 手动安装路径
  const candidates = [
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(os.homedir(), 'ffmpeg\\bin\\ffmpeg.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // 3. PATH 中的 ffmpeg (开发环境 fallback)
  try {
    const which = execSync('where ffmpeg', { stdio: 'pipe' }).toString().split('\n')[0].trim();
    if (which) return which;
  } catch { /* not in PATH */ }

  // 4. 非 Windows (开发/测试环境)
  return 'ffmpeg';
}

const FFMPEG = findFfmpeg();

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function apiGet<T>(apiBase: string, path: string): Promise<T> {
  const res = await fetch(`${apiBase}${path}`);
  return res.json() as Promise<T>;
}

async function apiPost<T>(apiBase: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

async function apiPatch(apiBase: string, path: string, body: unknown): Promise<void> {
  await fetch(`${apiBase}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => { /* non-fatal */ });
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    proto.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`download ${url} → ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

// ── progress helper ──────────────────────────────────────────────────────────

async function progress(apiBase: string, jobId: string, pct: number): Promise<void> {
  await apiPatch(apiBase, `/api/ai-video/jobs/${jobId}/progress`, {
    progress: pct,
    status: 'processing',
  });
}

// ── upload output MP4 back to 中台 ───────────────────────────────────────────

async function uploadMp4(apiBase: string, jobId: string, field: '9_16' | '16_9', filePath: string): Promise<void> {
  const formData = new FormData();
  const buf = fs.readFileSync(filePath);
  formData.append(field, new Blob([buf], { type: 'video/mp4' }), `${field}.mp4`);
  await fetch(`${apiBase}/api/ai-video/jobs/${jobId}/upload-output`, {
    method: 'POST',
    body: formData,
  });
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
  const tmpDir = path.join(os.tmpdir(), `zj-video-${id}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log(`[video-pipeline] processing job ${id}`);

  try {
    // ── Step 1: claim job ──────────────────────────────────────────────────
    await apiPatch(apiBase, `/api/ai-video/jobs/${id}/progress`, { progress: 2, status: 'processing' });

    // ── Step 2: download source video from 中台 ────────────────────────────
    const videoPath = path.join(tmpDir, 'source.mp4');
    await downloadToFile(`${apiBase}/api/ai-video/jobs/${id}/source`, videoPath);
    console.log(`[video-pipeline] downloaded source → ${videoPath}`);
    await progress(apiBase, id, 15);

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
      // fallback: silent audio
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
      if (data.transcript || data.segments?.length) {
        transcribeResult = data;
      }
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
    } catch (err) {
      console.warn('[video-pipeline] design error:', err);
    }
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
        video_filename: 'source.mp4',
      });
      if (htmlRes.html) fs.writeFileSync(htmlPath, htmlRes.html, 'utf-8');
    } catch (err) {
      console.warn('[video-pipeline] compose-html error:', err);
    }
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
    } catch (err) {
      console.warn('[video-pipeline] BGM error (non-fatal):', err);
    }
    await progress(apiBase, id, 75);

    // ── Step 9: FFmpeg outputs ─────────────────────────────────────────────
    const output916 = path.join(tmpDir, '9_16.mp4');
    const output169 = path.join(tmpDir, '16_9.mp4');
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

    // ── Step 10: upload outputs to 中台 ────────────────────────────────────
    await uploadMp4(apiBase, id, '9_16', output916);
    await uploadMp4(apiBase, id, '16_9', output169);
    console.log(`[video-pipeline] job ${id} complete — outputs uploaded to 中台`);
    await progress(apiBase, id, 100);

  } catch (err) {
    console.error('[video-pipeline] job failed:', err);
    await fetch(`${apiBase}/api/ai-video/jobs/${id}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error_msg: String(err) }),
    }).catch(() => {});
  } finally {
    // cleanup temp files
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── polling loop ─────────────────────────────────────────────────────────────

let _running = false;

export async function pollVideoPipeline(apiBase: string): Promise<void> {
  if (_running) return;
  try {
    const { data } = await apiGet<{ data: VideoPipelineJob[] }>(
      apiBase,
      '/api/ai-video/jobs?status=pending',
    );
    if (!data?.length) return;

    // Claim first job immediately before processing
    const job = data[0];
    _running = true;
    try {
      await processVideoPipelineJob(apiBase, job);
    } finally {
      _running = false;
    }
  } catch (err) {
    _running = false;
    console.warn('[video-pipeline] poll error:', (err as Error).message);
  }
}

export function startVideoPipelineLoop(apiBase: string, intervalMs = 15_000): NodeJS.Timeout {
  console.log(`[video-pipeline] polling loop started (${intervalMs / 1000}s interval)`);
  pollVideoPipeline(apiBase);
  return setInterval(() => pollVideoPipeline(apiBase), intervalMs);
}
