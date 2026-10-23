import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('集合上界在元素解析前拒绝超量输入', () => {
  it('array.max 不遍历超量数组中的元素', () => {
    let parsed = 0;
    const element = z.string().refine(() => { parsed += 1; return true; });
    const result = z.array(element).max(2).safeParse(['a', 'b', 'c']);
    expect(result.success).toBe(false);
    expect(parsed).toBe(0);
    if (!result.success) expect(result.error.issues.map(issue => issue.code)).toEqual(['too_big']);
  });

  it('array.length 不遍历长度超限数组中的元素', () => {
    let parsed = 0;
    const element = z.string().refine(() => { parsed += 1; return true; });
    const result = z.array(element).length(2).safeParse(['a', 'b', 'c']);
    expect(result.success).toBe(false);
    expect(parsed).toBe(0);
    if (!result.success) expect(result.error.issues.map(issue => issue.code)).toEqual(['too_big']);
  });

  it('set.max 不遍历超量集合中的元素', () => {
    let parsed = 0;
    const element = z.string().refine(() => { parsed += 1; return true; });
    const result = z.set(element).max(1).safeParse(new Set(['a', 'b']));
    expect(result.success).toBe(false);
    expect(parsed).toBe(0);
    if (!result.success) expect(result.error.issues.map(issue => issue.code)).toEqual(['too_big']);
  });

  it('set.size 不遍历大小超限集合中的元素', () => {
    let parsed = 0;
    const element = z.string().refine(() => { parsed += 1; return true; });
    const result = z.set(element).size(1).safeParse(new Set(['a', 'b']));
    expect(result.success).toBe(false);
    expect(parsed).toBe(0);
    if (!result.success) expect(result.error.issues.map(issue => issue.code)).toEqual(['too_big']);
  });

  it('限内数组仍逐项验证并保留结果', () => {
    let parsed = 0;
    const element = z.string().refine(() => { parsed += 1; return true; });
    expect(z.array(element).max(2).parse(['a', 'b'])).toEqual(['a', 'b']);
    expect(parsed).toBe(2);
  });

  it('限内集合仍逐项验证并拒绝错误值类型', () => {
    let parsed = 0;
    const element = z.string().refine(() => { parsed += 1; return true; });
    expect(z.set(element).max(2).parse(new Set(['a', 'b']))).toEqual(new Set(['a', 'b']));
    expect(parsed).toBe(2);
    expect(z.set(element).max(2).safeParse(new Set([1])).success).toBe(false);
  });
});
