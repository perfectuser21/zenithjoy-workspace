/**
 * 批量混剪 S4（GP f6f96e17）：多段素材合成高清成片的 ffmpeg 编排层单测。
 *
 * 真调 ffmpeg（testsrc/testsrc2 合成源现场生成，不依赖外部文件）——与
 * video-frame-extract.test.ts 同口径：这一层就是纯 ffmpeg 编排，mock 掉就等于
 * 没测，真机验证成本又低（合成源几百毫秒生成），值得真跑。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { concatAndScale } from '../mashup-render-ffmpeg';

let workDir: string;

/** ubuntu-latest / 本机开发环境都自带 ffmpeg；缺失时跳过真合成正向用例，不假绿（同 video-frame-extract.test.ts 口径）。 */
function hasFfmpeg(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const runIfFfmpeg = hasFfmpeg() ? it : it.skip;

function makeTestClip(path: string, size: string) {
  const r = spawnSync('ffmpeg', ['-f', 'lavfi', '-i', `testsrc=duration=1:size=${size}:rate=10`, '-y', path]);
  if (r.status !== 0) throw new Error('造测试素材失败，smoke 环境应自带 ffmpeg');
}

afterEach(() => {
  if (workDir && existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
});

describe('concatAndScale', () => {
  runIfFfmpeg('多段不同分辨率素材合成后统一为 1920x1080，时长为各段之和', () => {
    workDir = mkdtempSync(join(tmpdir(), 'mashup-render-test-'));
    const clip1 = join(workDir, 'a.mp4');
    const clip2 = join(workDir, 'b.mp4');
    const out = join(workDir, 'out.mp4');
    makeTestClip(clip1, '320x240');
    makeTestClip(clip2, '640x480');

    const ok = concatAndScale([clip1, clip2], out);
    expect(ok).toBe(true);
    expect(existsSync(out)).toBe(true);

    const probe = spawnSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out,
    ]);
    expect(probe.stdout.toString().trim()).toBe('1920,1080');

    const durProbe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]);
    const duration = Number(durProbe.stdout.toString().trim());
    expect(duration).toBeGreaterThanOrEqual(1.8);
    expect(duration).toBeLessThanOrEqual(2.2);
  });

  runIfFfmpeg('单段素材也能正常合成（候选只有 1 个填充槽位时的边界情况）', () => {
    workDir = mkdtempSync(join(tmpdir(), 'mashup-render-test-'));
    const clip1 = join(workDir, 'only.mp4');
    const out = join(workDir, 'out.mp4');
    makeTestClip(clip1, '320x240');

    const ok = concatAndScale([clip1], out);
    expect(ok).toBe(true);
    expect(existsSync(out)).toBe(true);
  });

  it('输入为空数组：返回 false，不调用 ffmpeg，不抛异常', () => {
    workDir = mkdtempSync(join(tmpdir(), 'mashup-render-test-'));
    const out = join(workDir, 'out.mp4');
    const ok = concatAndScale([], out);
    expect(ok).toBe(false);
    expect(existsSync(out)).toBe(false);
  });

  it('输入文件不存在：返回 false，不抛异常', () => {
    workDir = mkdtempSync(join(tmpdir(), 'mashup-render-test-'));
    const out = join(workDir, 'out.mp4');
    const ok = concatAndScale([join(workDir, 'does-not-exist.mp4')], out);
    expect(ok).toBe(false);
  });
});
