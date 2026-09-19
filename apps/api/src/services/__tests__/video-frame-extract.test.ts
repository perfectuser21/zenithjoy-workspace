/**
 * video-frame-extract.ts 单测。
 *
 * 从 video-remake.service.ts 抽出来的共享工具（S1「批量混剪」GP f6f96e17 复用），
 * 两处调用方（video-remake N02 抽帧 + material-tagging 打标签）都靠它拿关键帧，
 * 抽出来后必须有自己的测试，不能只靠调用方间接覆盖。
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { extractFrameBase64 } from '../video-frame-extract';

/** ubuntu-latest / 本机开发环境都自带 ffmpeg；缺失时跳过真抽帧正向用例，不假绿。 */
function hasFfmpeg(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('extractFrameBase64', () => {
  it('非视频/损坏 buffer → 返回 null，不抛异常', () => {
    expect(extractFrameBase64(Buffer.from('not a real video, just some garbage bytes'))).toBeNull();
  });

  it('空 buffer → 返回 null', () => {
    expect(extractFrameBase64(Buffer.alloc(0))).toBeNull();
  });

  const runIfFfmpeg = hasFfmpeg() ? it : it.skip;
  runIfFfmpeg('真实视频 → 返回合法 data:image/jpeg;base64 URL', () => {
    // 用 ffmpeg 自带的 testsrc lavfi 合成源现场生成最小视频，不依赖任何外部下载/fixture 文件
    const videoPath = join(tmpdir(), `vfe-test-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
    execSync(`ffmpeg -f lavfi -i "testsrc=duration=1:size=32x32:rate=1" -y "${videoPath}"`, { stdio: 'ignore' });
    const buffer = readFileSync(videoPath);
    unlinkSync(videoPath);

    const result = extractFrameBase64(buffer);

    expect(result).not.toBeNull();
    expect(result).toMatch(/^data:image\/jpeg;base64,/);
    const base64Body = (result as string).replace('data:image/jpeg;base64,', '');
    expect(Buffer.from(base64Body, 'base64').length).toBeGreaterThan(0);
  });
});
