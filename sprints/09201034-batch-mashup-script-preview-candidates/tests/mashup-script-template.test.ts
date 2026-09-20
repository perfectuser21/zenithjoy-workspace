// 批量混剪加厚 Step1：文案→动态分段模板。
// RED：本模块尚未实现 → import 解析失败即为预期红。
import { describe, it, expect } from 'vitest';
import {
  buildFallbackSegments,
  generateTemplateFromScript,
} from '../../../apps/api/src/services/mashup-script-template';

describe('文案动态分段 [BEHAVIOR]', () => {
  it('buildFallbackSegments 返回固定四槽位兜底分段（AI 不可用降级用）', () => {
    const segs = buildFallbackSegments();
    expect(Array.isArray(segs)).toBe(true);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    for (const s of segs) {
      expect(Array.isArray(s.matchTags)).toBe(true);
      expect(typeof s.suggestedCount).toBe('number');
      expect(s.suggestedCount).toBeGreaterThanOrEqual(1);
      expect(typeof s.fallbackMapped).toBe('boolean');
    }
  });

  it('空 script 被拒绝（INVALID_BODY 语义），拒绝发生在触碰 DB 之前', async () => {
    await expect(
      generateTemplateFromScript({ tenantId: 't', script: '' }),
    ).rejects.toThrow(/INVALID_BODY|script/i);
  });
});
