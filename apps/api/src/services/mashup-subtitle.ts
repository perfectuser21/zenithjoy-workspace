// apps/api/src/services/mashup-subtitle.ts
//
// 批量混剪配音刀（GP line05/batch_mashup#step4）：字级时间戳 → srt 字幕文件。
//
// 输入形状对接并行任务产出的 TTS 服务契约（tts-volcengine.ts，不改它、不猜签名）：
//   words: Array<{ word: string; startMs: number; endMs: number }>
//
// 断句规则（调研确认的抖音带货字幕事实标准）：单行 ≤13~15 个汉字，按标点自然停顿断，
// 不允许跨行拆词——每个字级 token 只归属一条字幕，不会被从中间切断。

import { writeFileSync } from 'fs';

export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

/** 单行最大汉字数（含标点）。超过且找不到标点断句点时按此上限强制换行。 */
const MAX_LINE_CHARS = 15;

/** 句内自然停顿标点——命中后强制断句（即使还没到长度上限）。 */
const BREAK_PUNCTUATION = new Set(['。', '，', '！', '？', '；', '.', ',', '!', '?', ';']);

/** ms → srt 时间戳 HH:MM:SS,mmm */
function formatSrtTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${pad3(millis)}`;
}

interface SubtitleLine {
  words: WordTimestamp[];
}

/**
 * 按"标点自然停顿 + 单行字数上限"把字级 token 流切成若干行。
 * 不允许跨词拆分——每个 token 完整地属于恰好一行。
 */
function splitIntoLines(words: WordTimestamp[]): SubtitleLine[] {
  const lines: SubtitleLine[] = [];
  let current: WordTimestamp[] = [];

  for (const token of words) {
    // 加入当前 token 会超过行宽上限，且当前行已有内容 → 先把已有内容断成一行，
    // 新 token 起新的一行（不允许因为超长而把 token 本身拆开）。
    if (current.length > 0 && current.length + token.word.length > MAX_LINE_CHARS) {
      lines.push({ words: current });
      current = [];
    }
    current.push(token);

    if (BREAK_PUNCTUATION.has(token.word)) {
      lines.push({ words: current });
      current = [];
    }
  }
  if (current.length > 0) lines.push({ words: current });

  return lines;
}

/** 字级时间戳数组 → srt 文件内容字符串。空数组返回空字符串。 */
export function wordsToSrt(words: WordTimestamp[]): string {
  if (words.length === 0) return '';

  const lines = splitIntoLines(words);
  const blocks = lines.map((line, i) => {
    const start = line.words[0].startMs;
    const end = line.words[line.words.length - 1].endMs;
    const text = line.words.map((t) => t.word).join('');
    return `${i + 1}\n${formatSrtTimestamp(start)} --> ${formatSrtTimestamp(end)}\n${text}`;
  });

  return `${blocks.join('\n\n')}\n`;
}

/** 字级时间戳数组 → 落盘为 srt 文件。 */
export function writeSrtFile(words: WordTimestamp[], outputPath: string): void {
  writeFileSync(outputPath, wordsToSrt(words), 'utf-8');
}
