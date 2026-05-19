import { describe, it, expect } from 'vitest';
import path from 'path';

// commit-1: ensure-ffmpeg.ts 尚未创建，import 会失败 → 测试红
import { getAppDataFfmpegExe, getAppDataFfprobeExe } from '../handlers/ensure-ffmpeg';

describe('ensure-ffmpeg paths', () => {
  it('ffmpeg exe 路径包含 ZenithJoy/runtime/ffmpeg', () => {
    const p = getAppDataFfmpegExe();
    expect(p).toMatch(/ZenithJoy/i);
    expect(p).toMatch(/runtime/i);
    expect(p).toMatch(/ffmpeg\.exe$/i);
  });

  it('ffprobe exe 路径包含 ZenithJoy/runtime/ffmpeg', () => {
    const p = getAppDataFfprobeExe();
    expect(p).toMatch(/ZenithJoy/i);
    expect(p).toMatch(/runtime/i);
    expect(p).toMatch(/ffprobe\.exe$/i);
  });

  it('ffmpeg 和 ffprobe 在同一目录', () => {
    expect(path.dirname(getAppDataFfmpegExe())).toBe(path.dirname(getAppDataFfprobeExe()));
  });
});
