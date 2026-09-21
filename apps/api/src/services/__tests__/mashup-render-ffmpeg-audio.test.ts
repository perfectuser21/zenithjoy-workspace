/**
 * 批量混剪配音刀（GP line05/batch_mashup#step4）：renderMashupWithAudio 单测。
 *
 * 与 mashup-render-ffmpeg.test.ts（真调 ffmpeg）不同口径——本文件专测新增的
 * "横竖屏可选 + 每段裁剪时长 + 挂音轨 + 烧字幕"编排逻辑，覆盖字幕烧录场景，
 * 而本机 ffmpeg 没有编译 libass（-filters 零命中 subtitles），真跑必炸。
 * 改为 mock spawnSync + fs.existsSync，断言生成的 ffmpeg 参数数组正确，不真跑
 * 二进制——真实字幕烧录效果在容器里用 mashup-render-smoke.sh 的静默失效守卫验证。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const spawnSyncMock = vi.fn();
vi.mock('child_process', () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

const existsSyncMock = vi.fn(() => true);
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
}));

import { renderMashupWithAudio } from '../mashup-render-ffmpeg';

beforeEach(() => {
  spawnSyncMock.mockReset();
  spawnSyncMock.mockReturnValue({ status: 0 });
  existsSyncMock.mockReset();
  existsSyncMock.mockReturnValue(true);
});

function lastArgs(): string[] {
  expect(spawnSyncMock).toHaveBeenCalledTimes(1);
  const call = spawnSyncMock.mock.calls[0] as [string, string[]];
  expect(call[0]).toBe('ffmpeg');
  return call[1];
}

describe('renderMashupWithAudio', () => {
  it('输入为空数组：返回 false，不调用 ffmpeg', () => {
    const ok = renderMashupWithAudio([], '/tmp/out.mp4');
    expect(ok).toBe(false);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('任一素材文件不存在：返回 false，不调用 ffmpeg', () => {
    existsSyncMock.mockImplementation((p: unknown) => p !== '/tmp/missing.mp4');
    const ok = renderMashupWithAudio([{ path: '/tmp/missing.mp4' }], '/tmp/out.mp4');
    expect(ok).toBe(false);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('竖屏 1080x1920：filter_complex 的 scale/pad 用竖屏尺寸，不是默认 1920x1080', () => {
    const ok = renderMashupWithAudio(
      [{ path: '/tmp/a.mp4' }],
      '/tmp/out.mp4',
      { width: 1080, height: 1920 },
    );
    expect(ok).toBe(true);
    const args = lastArgs();
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('scale=1080:1920:force_original_aspect_ratio=decrease');
    expect(fc).toContain('pad=1080:1920:(ow-iw)/2:(oh-ih)/2');
  });

  it('横屏默认 1920x1080：不传 width/height 时维持终版成片档默认值', () => {
    renderMashupWithAudio([{ path: '/tmp/a.mp4' }], '/tmp/out.mp4');
    const args = lastArgs();
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('scale=1920:1080:force_original_aspect_ratio=decrease');
  });

  it('每段指定 durationSec：生成 trim=0:N,setpts=PTS-STARTPTS 裁剪链', () => {
    renderMashupWithAudio(
      [{ path: '/tmp/a.mp4', durationSec: 1.8 }, { path: '/tmp/b.mp4', durationSec: 2.5 }],
      '/tmp/out.mp4',
    );
    const args = lastArgs();
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('[0:v]trim=0:1.8,setpts=PTS-STARTPTS,scale=');
    expect(fc).toContain('[1:v]trim=0:2.5,setpts=PTS-STARTPTS,scale=');
    expect(fc).toContain('concat=n=2:v=1:a=0');
  });

  it('未指定 durationSec 的段：不裁剪，直接进 scale（向后兼容素材原时长）', () => {
    renderMashupWithAudio([{ path: '/tmp/a.mp4' }], '/tmp/out.mp4');
    const args = lastArgs();
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).not.toContain('trim=');
    expect(fc).toContain('[0:v]scale=');
  });

  it('未传 audioPath：保持原有无音轨行为，输出带 -an，不额外加音频输入', () => {
    renderMashupWithAudio([{ path: '/tmp/a.mp4' }], '/tmp/out.mp4');
    const args = lastArgs();
    expect(args).toContain('-an');
    expect(args.filter((a) => a === '-i')).toHaveLength(1);
  });

  it('传入 audioPath：追加音频输入 + -map 到该输入的 :a + -c:a aac，不再 -an', () => {
    renderMashupWithAudio(
      [{ path: '/tmp/a.mp4' }, { path: '/tmp/b.mp4' }],
      '/tmp/out.mp4',
      { audioPath: '/tmp/voice.mp3' },
    );
    const args = lastArgs();
    expect(args).not.toContain('-an');
    // 视频输入 2 个（index 0,1），音频输入追加在 index 2
    expect(args).toEqual(expect.arrayContaining(['-i', '/tmp/a.mp4', '-i', '/tmp/b.mp4', '-i', '/tmp/voice.mp3']));
    expect(args).toEqual(expect.arrayContaining(['-map', '2:a']));
    expect(args).toEqual(expect.arrayContaining(['-c:a', 'aac']));
    expect(args).toEqual(expect.arrayContaining(['-shortest']));
  });

  it('audioPath 文件不存在：返回 false，不调用 ffmpeg', () => {
    existsSyncMock.mockImplementation((p: unknown) => p !== '/tmp/missing-voice.mp3');
    const ok = renderMashupWithAudio(
      [{ path: '/tmp/a.mp4' }],
      '/tmp/out.mp4',
      { audioPath: '/tmp/missing-voice.mp3' },
    );
    expect(ok).toBe(false);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('传入 srtPath：filter_complex 追加 subtitles 滤镜，且 force_style 内的逗号被转义（避免被当作 filter 链分隔符）', () => {
    renderMashupWithAudio(
      [{ path: '/tmp/a.mp4' }],
      '/tmp/out.mp4',
      { srtPath: '/tmp/sub.srt' },
    );
    const args = lastArgs();
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain("subtitles=filename='/tmp/sub.srt':force_style='");
    // force_style 内部字段分隔的逗号必须转义成 \, ——否则会被 filter_complex 顶层解析成下一个滤镜
    const styleMatch = fc.match(/force_style='([^']*)'/);
    expect(styleMatch).not.toBeNull();
    const style = styleMatch![1];
    expect(style).toContain('\\,');
    expect(style).not.toMatch(/[^\\],/); // 不允许出现"未转义的逗号"
    // 抖音带货字幕标准：底部区域、白字黑描边
    expect(style).toContain('Alignment=2');
    expect(style).toContain('PrimaryColour=&H00FFFFFF');
    expect(style).toContain('OutlineColour=&H00000000');
  });

  it('srtPath 文件不存在：返回 false，不调用 ffmpeg', () => {
    existsSyncMock.mockImplementation((p: unknown) => p !== '/tmp/missing.srt');
    const ok = renderMashupWithAudio(
      [{ path: '/tmp/a.mp4' }],
      '/tmp/out.mp4',
      { srtPath: '/tmp/missing.srt' },
    );
    expect(ok).toBe(false);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('未传 srtPath：不追加 subtitles 滤镜', () => {
    renderMashupWithAudio([{ path: '/tmp/a.mp4' }], '/tmp/out.mp4');
    const args = lastArgs();
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).not.toContain('subtitles=');
  });

  it('ffmpeg 返回非 0 状态码：返回 false', () => {
    spawnSyncMock.mockReturnValue({ status: 1 });
    const ok = renderMashupWithAudio([{ path: '/tmp/a.mp4' }], '/tmp/out.mp4');
    expect(ok).toBe(false);
  });

  it('preset/crf 透传：与 concatAndScale 同口径', () => {
    renderMashupWithAudio(
      [{ path: '/tmp/a.mp4' }],
      '/tmp/out.mp4',
      { preset: 'ultrafast', crf: 28 },
    );
    const args = lastArgs();
    expect(args).toEqual(expect.arrayContaining(['-preset', 'ultrafast', '-crf', '28']));
  });
});
