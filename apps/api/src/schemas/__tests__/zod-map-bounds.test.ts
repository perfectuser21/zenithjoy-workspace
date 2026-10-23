import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('Map上界在Zod 4解析元素前生效', () => {
  it('max和size拒绝超量Map且不执行键值验证', () => {
    let parsed = 0;
    const element = z.string().refine(() => { parsed += 1; return true; });
    const map = z.map(element, element);
    const input = new Map([['a', 'one'], ['b', 'two']]);
    for (const schema of [map.max(1), map.size(1)]) {
      const result = schema.safeParse(input);
      expect(result.success).toBe(false);
      expect(parsed).toBe(0);
      if (!result.success) expect(result.error.issues.map(issue => issue.code)).toEqual(['too_big']);
    }
  });

  it('限内Map仍解析键值并拒绝错误元素类型', () => {
    let parsed = 0;
    const element = z.string().refine(() => { parsed += 1; return true; });
    const schema = z.map(element, element).max(1);
    expect(schema.parse(new Map([['a', 'one']]))).toEqual(new Map([['a', 'one']]));
    expect(parsed).toBe(2);
    expect(schema.safeParse(new Map([['a', 1]])).success).toBe(false);
  });
});
