/**
 * 批量混剪配音刀（GP line05/batch_mashup#step4）：字级时间戳 → srt 字幕文件单测。
 *
 * 输入形状对接并行任务（TTS 服务契约，不改它）：
 *   words: Array<{ word: string; startMs: number; endMs: number }>
 *
 * 断句事实标准（调研确认）：单行 ≤13~15 个汉字，按标点自然停顿断，不允许跨行拆词。
 * 纯逻辑、无 I/O，本机可全量真跑（不依赖 ffmpeg/libass）。
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { wordsToSrt, writeSrtFile, type WordTimestamp } from '../mashup-subtitle';

function w(word: string, startMs: number, endMs: number): WordTimestamp {
  return { word, startMs, endMs };
}

describe('wordsToSrt', () => {
  it('空数组：返回空字符串，不抛异常', () => {
    expect(wordsToSrt([])).toBe('');
  });

  it('短句（未超行宽、无标点）：合成单行一条字幕，时间戳取首词开始/末词结束', () => {
    const words = [w('厨', 0, 235), w('房', 235, 460), w('好', 460, 700)];
    const srt = wordsToSrt(words);
    expect(srt).toContain('1\n');
    expect(srt).toContain('00:00:00,000 --> 00:00:00,700');
    expect(srt).toContain('厨房好');
  });

  it('按标点断句：句号/逗号/问号/感叹号处强制换行到下一条字幕', () => {
    const words = [
      w('厨', 0, 100), w('房', 100, 200), w('好', 200, 300), w('，', 300, 320),
      w('蟑', 320, 420), w('螂', 420, 520), w('走', 520, 620), w('。', 620, 640),
    ];
    const srt = wordsToSrt(words);
    const blocks = srt.trim().split('\n\n');
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toContain('厨房好，');
    expect(blocks[1]).toContain('蟑螂走。');
  });

  it('单行超过 15 个汉字（无标点断句机会）：按长度上限强制断行，不跨词拆字', () => {
    const chars = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'.split('');
    const words = chars.map((c, i) => w(c, i * 100, i * 100 + 100));
    const srt = wordsToSrt(words);
    const blocks = srt.trim().split('\n\n');
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      const lines = block.split('\n');
      const textLine = lines[lines.length - 1];
      expect(textLine.length).toBeLessThanOrEqual(15);
    }
    // 断行拼回去必须与原文完全一致（不允许丢字/重复字/跨词拆分）
    const rejoined = blocks.map((b) => b.split('\n').slice(2).join('')).join('');
    expect(rejoined).toBe(chars.join(''));
  });

  it('srt 时间戳格式为 HH:MM:SS,mmm', () => {
    const words = [w('测', 61234, 62000)];
    const srt = wordsToSrt(words);
    expect(srt).toMatch(/00:01:01,234 --> 00:01:02,000/);
  });

  it('序号从 1 开始连续递增', () => {
    const words = [
      w('甲', 0, 100), w('。', 100, 120),
      w('乙', 200, 300), w('。', 300, 320),
      w('丙', 400, 500), w('。', 500, 520),
    ];
    const srt = wordsToSrt(words);
    const indices = srt.trim().split('\n\n').map((b) => b.split('\n')[0]);
    expect(indices).toEqual(['1', '2', '3']);
  });
});

describe('writeSrtFile', () => {
  let dir: string;

  it('落盘：写入的文件内容与 wordsToSrt 一致', () => {
    dir = mkdtempSync(join(tmpdir(), 'mashup-subtitle-test-'));
    const out = join(dir, 'sub.srt');
    const words = [w('厨', 0, 235), w('房', 235, 460)];
    writeSrtFile(words, out);
    const content = readFileSync(out, 'utf-8');
    expect(content).toBe(wordsToSrt(words));
    rmSync(dir, { recursive: true, force: true });
  });

  it('空数组也能落盘为空文件，不抛异常', () => {
    dir = mkdtempSync(join(tmpdir(), 'mashup-subtitle-test-'));
    const out = join(dir, 'empty.srt');
    expect(() => writeSrtFile([], out)).not.toThrow();
    expect(readFileSync(out, 'utf-8')).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });
});
