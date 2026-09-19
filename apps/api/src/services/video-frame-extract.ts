// apps/api/src/services/video-frame-extract.ts
//
// 从视频 buffer 抽一帧，编成 data URL（供多模态模型输入）。
// 抽出来是给 video-remake.service.ts 的 N02 和 material-tagging.ts 共用——
// 两处都要「从视频里挑一帧丢给 Gemini/图生视频模型」，同一段 ffmpeg 调用逻辑
// 只写一份（复用即引用，禁重建）。

import { randomUUID } from 'crypto';
import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/** 从视频 buffer 抽第一帧，返回 base64 data URL；ffmpeg 不在/抽帧失败返回 null。 */
export function extractFrameBase64(buffer: Buffer): string | null {
  const tmpVideo = join(tmpdir(), `vfe-in-${randomUUID()}.mp4`);
  const tmpFrame = join(tmpdir(), `vfe-frm-${randomUUID()}.jpg`);
  try {
    writeFileSync(tmpVideo, buffer);
    const r = spawnSync('ffmpeg', ['-i', tmpVideo, '-vframes', '1', '-q:v', '2', tmpFrame, '-y'], { encoding: 'utf8' });
    if (r.status !== 0 || !existsSync(tmpFrame)) return null;
    return `data:image/jpeg;base64,${readFileSync(tmpFrame).toString('base64')}`;
  } catch { return null; }
  finally {
    try { unlinkSync(tmpVideo); } catch { /* ignore */ }
    try { unlinkSync(tmpFrame); } catch { /* ignore */ }
  }
}
