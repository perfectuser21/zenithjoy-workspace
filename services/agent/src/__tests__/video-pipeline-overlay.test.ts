import { describe, it, expect } from 'vitest';

// 从 video-pipeline.ts 中导出这两个函数（需要 export）
// commit-1: 函数尚未 export，以下 import 会导致运行时错误或测试失败
import { escapeDT, buildOverlayFilters } from '../handlers/video-pipeline';

describe('escapeDT', () => {
  it('转义单引号', () => {
    expect(escapeDT("it's")).toBe("it\\'s");
  });

  it('转义反斜杠', () => {
    expect(escapeDT('a\\b')).toBe('a\\\\b');
  });

  it('转义冒号', () => {
    expect(escapeDT('a:b')).toBe('a\\:b');
  });

  it('转义方括号', () => {
    expect(escapeDT('[test]')).toBe('\\[test\\]');
  });

  it('转义逗号', () => {
    expect(escapeDT('a,b')).toBe('a\\,b');
  });

  it('转义分号', () => {
    expect(escapeDT('a;b')).toBe('a\\;b');
  });

  it('去掉首尾空格', () => {
    expect(escapeDT('  hello  ')).toBe('hello');
  });
});

describe('buildOverlayFilters', () => {
  it('无场景时返回空数组', () => {
    expect(buildOverlayFilters([], 1080, 1920, 'font.ttf')).toEqual([]);
  });

  it('无字体时返回空数组', () => {
    const scenes = [{ start: 0, duration: 5, layout: 'burst', eyebrow: '测试', title: '标题', body: '正文' }];
    expect(buildOverlayFilters(scenes, 1080, 1920, '')).toEqual([]);
  });

  it('有场景有字体时包含 drawbox', () => {
    const scenes = [{ start: 0, duration: 5, layout: 'burst', eyebrow: '测试', title: '标题', body: '正文' }];
    const filters = buildOverlayFilters(scenes, 1080, 1920, '/fonts/test.ttf');
    const hasDrawbox = filters.some(f => f.startsWith('drawbox='));
    expect(hasDrawbox).toBe(true);
  });

  it('有场景有字体时包含 drawtext（eyebrow）', () => {
    const scenes = [{ start: 0, duration: 5, layout: 'burst', eyebrow: '精彩', title: '主标题', body: '' }];
    const filters = buildOverlayFilters(scenes, 1080, 1920, '/fonts/test.ttf');
    const hasDrawtext = filters.some(f => f.startsWith('drawtext='));
    expect(hasDrawtext).toBe(true);
  });

  it('body 为空时不生成 body drawtext', () => {
    const scenes = [{ start: 0, duration: 5, layout: 'burst', eyebrow: 'EP', title: 'Title', body: '' }];
    const filters = buildOverlayFilters(scenes, 1080, 1920, '/fonts/test.ttf');
    // eyebrow + title = 2 drawtext，加 1 drawbox = 3 条
    expect(filters.length).toBe(3);
  });

  it('body 非空时生成 body drawtext', () => {
    const scenes = [{ start: 0, duration: 5, layout: 'burst', eyebrow: 'EP', title: 'Title', body: 'Body' }];
    const filters = buildOverlayFilters(scenes, 1080, 1920, '/fonts/test.ttf');
    // eyebrow + title + body = 3 drawtext，加 1 drawbox = 4 条
    expect(filters.length).toBe(4);
  });

  it('时间区间 enable 表达式正确', () => {
    const scenes = [{ start: 2, duration: 4, layout: 'burst', eyebrow: 'EP', title: 'T', body: '' }];
    const filters = buildOverlayFilters(scenes, 1080, 1920, '/fonts/test.ttf');
    const box = filters.find(f => f.startsWith('drawbox='));
    expect(box).toContain("between(t,2.00,6.00)");
  });

  it('多场景生成多组滤镜', () => {
    const scenes = [
      { start: 0, duration: 5, layout: 'burst', eyebrow: 'EP1', title: 'T1', body: '' },
      { start: 5, duration: 5, layout: 'burst', eyebrow: 'EP2', title: 'T2', body: '' },
    ];
    const filters = buildOverlayFilters(scenes, 1080, 1920, '/fonts/test.ttf');
    // 每个场景：1 drawbox + 2 drawtext = 3，2 场景 = 6
    expect(filters.length).toBe(6);
  });
});
