/**
 * video-pipeline-worker.ts
 *
 * 本地视频流水线 worker — 运行在 Mac 本机。
 * 轮询 pending jobs → FFmpeg 处理 → AI 端点调用 → 生成输出 MP4 → 标记 complete。
 *
 * 启动：npx ts-node src/scripts/video-pipeline-worker.ts
 * 或编译后：node dist/scripts/video-pipeline-worker.js
 */

import { execSync, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import https from 'https';
import http from 'http';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

const API_BASE = process.env.API_BASE || 'http://localhost:5200';
const POLL_INTERVAL_MS = 10_000;

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function fetchJson<T>(url: string, opts: RequestInit = {}): Promise<T> {
  return fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then((r) => r.json() as Promise<T>);
}

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    proto.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

// ── progress reporting ───────────────────────────────────────────────────────

async function progress(jobId: string, pct: number, status = 'processing') {
  try {
    await fetchJson(`${API_BASE}/api/ai-video/jobs/${jobId}/progress`, {
      method: 'PATCH',
      body: JSON.stringify({ progress: pct, status }),
    });
  } catch {
    // non-fatal — worker continues
  }
}

// ── main pipeline ────────────────────────────────────────────────────────────

async function processJob(job: {
  id: string; src_video: string; src_logo?: string | null; topic?: string | null;
}) {
  const { id, src_video, src_logo, topic } = job;
  const jobDir = path.dirname(src_video);
  const outDir = path.join(jobDir, 'out');
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`[worker] processing job ${id}`);
  await progress(id, 5);

  // ── Step 1: probe video duration ─────────────────────────────────────────
  let duration = 3;
  try {
    const probe = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${src_video}"`,
    ).toString().trim();
    duration = parseFloat(probe) || 3;
  } catch { /* use default */ }
  await progress(id, 15);

  // ── Step 2: extract audio for transcription ───────────────────────────────
  const audioPath = path.join(jobDir, 'audio.wav');
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-i', src_video,
      '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
      audioPath,
    ]);
  } catch (err) {
    console.warn('[worker] audio extract failed (no audio track?):', err);
    // Create silent audio as fallback
    await execFileAsync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `anullsrc=r=16000:cl=mono`,
      '-t', String(duration), '-acodec', 'pcm_s16le', audioPath,
    ]);
  }
  await progress(id, 25);

  // ── Step 3: transcribe ────────────────────────────────────────────────────
  const audioBuffer = fs.readFileSync(audioPath);
  const formData = new FormData();
  formData.append('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');

  interface TranscribeResult { transcript: string; segments: { start: number; end: number; text: string }[] }
  let transcribeResult: TranscribeResult = { transcript: topic || '', segments: [] };
  try {
    const r = await fetch(`${API_BASE}/api/ai-video/jobs/${id}/transcribe`, {
      method: 'POST', body: formData,
    });
    transcribeResult = await r.json() as TranscribeResult;
    if (!transcribeResult.transcript && topic) transcribeResult.transcript = topic;
  } catch (err) {
    console.warn('[worker] transcribe failed:', err);
    if (topic) transcribeResult.transcript = topic;
  }
  await progress(id, 40);

  // ── Step 4: design scenes ─────────────────────────────────────────────────
  interface DesignResult { scenes: Array<{ start: number; duration: number; layout: string; eyebrow: string; title: string; body: string; tags?: string[] }> }
  let designResult: DesignResult = { scenes: [] };
  try {
    const r = await fetch(`${API_BASE}/api/ai-video/jobs/${id}/design`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: transcribeResult.transcript || topic || '精彩内容',
        segments: transcribeResult.segments.length
          ? transcribeResult.segments
          : [{ start: 0, end: duration, text: topic || '精彩内容' }],
        duration,
        topic,
      }),
    });
    designResult = await r.json() as DesignResult;
  } catch (err) {
    console.warn('[worker] design failed:', err);
  }
  await progress(id, 55);

  // ── Step 5: compose HTML ──────────────────────────────────────────────────
  const htmlPath = path.join(outDir, 'hyperframe.html');
  try {
    const r = await fetch(`${API_BASE}/api/ai-video/jobs/${id}/compose-html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenes: designResult.scenes.length
          ? designResult.scenes
          : [{ start: 0, duration, layout: 'burst', eyebrow: '精彩视频', title: topic || '内容', body: '', tags: [] }],
        duration,
        video_filename: 'src/video.mp4',
        logo_filename: src_logo ? 'src/logo' + path.extname(src_logo) : undefined,
      }),
    });
    const htmlResult = await r.json() as { html: string };
    if (htmlResult.html) fs.writeFileSync(htmlPath, htmlResult.html, 'utf-8');
  } catch (err) {
    console.warn('[worker] compose-html failed:', err);
  }
  await progress(id, 65);

  // ── Step 6: generate & download BGM ──────────────────────────────────────
  const bgmDir = path.join(outDir, 'bgm');
  fs.mkdirSync(bgmDir, { recursive: true });
  const bgmPath = path.join(bgmDir, 'bgm.mp3');
  try {
    const r = await fetch(`${API_BASE}/api/ai-video/jobs/${id}/bgm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style: 'upbeat motivational, electronic, no vocals, 120 BPM' }),
    });
    const bgmResult = await r.json() as { url?: string };
    if (bgmResult.url) {
      await downloadFile(bgmResult.url, bgmPath);
      console.log('[worker] BGM downloaded');
    }
  } catch (err) {
    console.warn('[worker] BGM failed (non-fatal):', err);
  }
  await progress(id, 75);

  // ── Step 7: FFmpeg — produce 9:16 and 16:9 MP4 outputs ───────────────────
  const output916 = path.join(outDir, '9_16.mp4');
  const output169 = path.join(outDir, '16_9.mp4');

  const hasBgm = fs.existsSync(bgmPath);
  const bgmArgs: string[] = hasBgm
    ? ['-map', '0:v:0', '-map', '1:a:0', '-shortest']
    : ['-map', '0'];

  try {
    await execFileAsync('ffmpeg', [
      '-y', '-i', src_video,
      ...(hasBgm ? ['-i', bgmPath] : []),
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      ...bgmArgs,
      '-t', String(Math.min(duration, 60)),
      output916,
    ]);
    console.log('[worker] 9:16 output created');
  } catch (err) {
    console.error('[worker] 9:16 FFmpeg failed:', err);
    fs.copyFileSync(src_video, output916);
  }
  await progress(id, 88);

  try {
    await execFileAsync('ffmpeg', [
      '-y', '-i', src_video,
      ...(hasBgm ? ['-i', bgmPath] : []),
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      ...bgmArgs,
      '-t', String(Math.min(duration, 60)),
      output169,
    ]);
    console.log('[worker] 16:9 output created');
  } catch (err) {
    console.error('[worker] 16:9 FFmpeg failed:', err);
    fs.copyFileSync(src_video, output169);
  }
  await progress(id, 95);

  // ── Step 8: mark complete ─────────────────────────────────────────────────
  try {
    await fetchJson(`${API_BASE}/api/ai-video/jobs/${id}/complete`, {
      method: 'PUT',
      body: JSON.stringify({
        result_url: outDir,
        output_916: output916,
        output_169: output169,
        html_path: htmlPath,
      }),
    });
    console.log(`[worker] job ${id} complete → ${outDir}`);
  } catch (err) {
    console.error('[worker] complete PUT failed:', err);
  }
}

// ── polling loop ─────────────────────────────────────────────────────────────

async function poll() {
  try {
    const { data } = await fetchJson<{ data: Array<{ id: string; src_video: string; src_logo?: string | null; topic?: string | null }> }>(
      `${API_BASE}/api/ai-video/jobs?status=pending`,
    );
    if (data && data.length > 0) {
      const job = data[0];
      // Mark in-progress first to prevent double-pickup
      try {
        await fetchJson(`${API_BASE}/api/ai-video/jobs/${job.id}/progress`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'processing', progress: 1 }),
        });
      } catch { /* if endpoint missing, continue */ }
      await processJob(job);
    }
  } catch (err) {
    console.warn('[worker] poll error:', err instanceof Error ? err.message : err);
  }
}

console.log(`[worker] starting — polling ${API_BASE} every ${POLL_INTERVAL_MS / 1000}s`);
poll();
setInterval(poll, POLL_INTERVAL_MS);
