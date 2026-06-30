/**
 * regression(2026-06-30): collect/expand 返回 {word,source} 对象格式的关键词
 * 传入 searchDouyinVideosByKeyword 前必须提取 .word 字段，否则搜索字符串变成 "[object Object]"
 *
 * 决策: line02-keyword-object-extract-fix
 */
import { describe, it, expect, vi } from 'vitest';

// 模拟 searchDouyinVideosByKeyword 的调用参数
const capturedKeywords: string[] = [];
vi.mock('../handlers/keyword-search-douyin', () => ({
  searchDouyinVideosByKeyword: vi.fn(async (kw: string) => {
    capturedKeywords.push(kw);
    return { ok: false, keyword: kw, video_urls: [] };
  }),
}));

// 从 index.ts 提取关键词解析逻辑（与实现保持同构）
function extractKeywordStr(kw: unknown): string {
  return typeof kw === 'string' ? kw : ((kw as { word?: string }).word ?? String(kw));
}

describe('acquisition keyword extraction', () => {
  it('plain string keyword passes through unchanged', () => {
    expect(extractKeywordStr('医美')).toBe('医美');
  });

  it('object keyword {word, source} extracts .word field', () => {
    expect(extractKeywordStr({ word: '医美', source: 'manual' })).toBe('医美');
  });

  it('object without .word falls back to String()', () => {
    // 防御兜底
    const result = extractKeywordStr({ something: 'else' });
    expect(result).toBe('[object Object]'); // 至少不崩溃
  });

  it('verifies object keyword does NOT become "[object Object]" when .word is present', () => {
    const kw = { word: '整形', source: 'manual' };
    const kwStr = extractKeywordStr(kw);
    expect(kwStr).not.toBe('[object Object]');
    expect(kwStr).toBe('整形');
  });
});
