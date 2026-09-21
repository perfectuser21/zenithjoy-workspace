/**
 * 批量混剪配音字幕上线前的文案合规检查（GP line05/batch_mashup#step4）。
 *
 * 背景：批量混剪即将把客户文案 TTS 念出来 + 烧字幕。现有内容安全 Gate
 * （mashup-render.ts 的 buildSafetyPrompt）只审画面首帧，完全不审文案。
 * 客户是农药/卫生杀虫剂类目（蟑螂药），一旦文案里的极限词/违规宣称被念出来+
 * 写在屏幕上，触发的是账号级处罚（比视频没人看严重得多）。
 * 更麻烦的是文案分段本身用 AI 生成（mashup-slot-assignment.ts 的
 * generateTemplateFromScript），AI 自己就容易生成这类词，系统必须能拦住。
 *
 * 本测试锁定 checkCopy() 的行为：纯本地规则匹配（不调 AI，确定性、可测试），
 * 给出命中词、分类、原文位置、可选替换建议。
 */
import { describe, it, expect } from 'vitest';
import { checkCopy } from '../copy-compliance';

describe('copy-compliance: checkCopy', () => {
  describe('正例（应当通过，不误伤正常蟑螂药文案）', () => {
    it('厨房蟑螂反复出没？一喷就见效 —— 常规卖点表述，不应命中', () => {
      const result = checkCopy('厨房蟑螂反复出没？一喷就见效');
      expect(result.passed).toBe(true);
      expect(result.issues).toEqual([]);
    });

    it('蟑螂药安全使用，请按说明书操作，适合家庭厨房卫生间使用 —— 不应命中', () => {
      const result = checkCopy('蟑螂药安全使用，请按说明书操作，适合家庭厨房卫生间使用');
      expect(result.passed).toBe(true);
      expect(result.issues).toEqual([]);
    });

    it('持续有效，长效抑制蟑螂滋生，配合日常清洁效果更好 —— 不应命中', () => {
      const result = checkCopy('持续有效，长效抑制蟑螂滋生，配合日常清洁效果更好');
      expect(result.passed).toBe(true);
      expect(result.issues).toEqual([]);
    });
  });

  describe('反例（应当命中，覆盖四大类词库）', () => {
    it('根治蟑螂，无毒无害，三天彻底消灭 —— 应命中多条（农药高危宣称）', () => {
      const text = '根治蟑螂，无毒无害，三天彻底消灭';
      const result = checkCopy(text);
      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(3);

      const terms = result.issues.map((i) => i.term);
      expect(terms).toContain('根治');
      expect(terms).toContain('无毒无害');
      expect(terms).toContain('彻底消灭');

      for (const cat of result.issues.map((i) => i.category)) {
        expect(cat).toBe('农药高危宣称');
      }

      const genzhi = result.issues.find((i) => i.term === '根治');
      expect(genzhi?.position).toBe(text.indexOf('根治'));
      expect(genzhi?.suggestion).toBeTruthy();
    });

    it('全网第一，顶级灭蟑药，绝对安全 —— 应命中绝对化用语 + 农药高危宣称', () => {
      const text = '全网第一，顶级灭蟑药，绝对安全';
      const result = checkCopy(text);
      expect(result.passed).toBe(false);

      const byTerm = new Map(result.issues.map((i) => [i.term, i]));
      expect(byTerm.get('第一')?.category).toBe('绝对化用语');
      expect(byTerm.get('顶级')?.category).toBe('绝对化用语');
      expect(byTerm.get('绝对安全')?.category).toBe('农药高危宣称');

      expect(byTerm.get('第一')?.position).toBe(text.indexOf('第一'));
      expect(byTerm.get('顶级')?.position).toBe(text.indexOf('顶级'));
    });

    it('本产品可治疗蟑螂过敏，药到病除 —— 应命中医疗功效暗示', () => {
      const text = '本产品可治疗蟑螂过敏，药到病除';
      const result = checkCopy(text);
      expect(result.passed).toBe(false);

      const terms = result.issues.map((i) => i.term);
      expect(terms).toContain('治疗');
      expect(terms).toContain('药到病除');
      for (const issue of result.issues) {
        expect(issue.category).toBe('医疗功效暗示');
      }
    });

    it('喷一次当天灭绝，三天见效 —— 应命中时效承诺', () => {
      const text = '喷一次当天灭绝，三天见效';
      const result = checkCopy(text);
      expect(result.passed).toBe(false);

      const terms = result.issues.map((i) => i.term);
      expect(terms).toContain('当天灭绝');
      expect(terms).toContain('三天见效');
      for (const issue of result.issues) {
        expect(issue.category).toBe('时效承诺');
      }
    });

    it('客户原话样例：根治蟑螂，无毒无害，三天彻底消灭，全网第一 —— 综合命中四类中的三类', () => {
      const text = '根治蟑螂，无毒无害，三天彻底消灭，全网第一';
      const result = checkCopy(text);
      const categories = new Set(result.issues.map((i) => i.category));
      expect(categories.has('农药高危宣称')).toBe(true);
      expect(categories.has('绝对化用语')).toBe(true);
    });
  });

  describe('变体规避（大小写/全半角/中间插字符）', () => {
    it('"最 佳"（中间插空格）应命中绝对化用语', () => {
      const text = '最 佳灭蟑喷雾，效果好';
      const result = checkCopy(text);
      expect(result.passed).toBe(false);
      const hit = result.issues.find((i) => i.category === '绝对化用语');
      expect(hit).toBeTruthy();
      expect(hit?.position).toBe(0);
    });

    it('"第①"（圆圈数字代替汉字数字）应命中绝对化用语', () => {
      const text = '全网第①，绝对安全';
      const result = checkCopy(text);
      const terms = result.issues.map((i) => i.category);
      expect(terms).toContain('绝对化用语');
      expect(terms).toContain('农药高危宣称');
    });

    it('全角数字与百分号（１００％）应命中农药高危宣称的 100% 表述', () => {
      const text = '顶级除虫，１００％有效';
      const result = checkCopy(text);
      const categories = result.issues.map((i) => i.category);
      expect(categories).toContain('绝对化用语'); // 顶级
      expect(categories).toContain('农药高危宣称'); // 100%
    });

    it('英文占比词大小写不敏感：100% 与 100%（保持一致命中）', () => {
      const text = 'kill 100% of roaches guaranteed';
      const result = checkCopy(text);
      expect(result.issues.some((i) => i.term.toLowerCase().includes('100%'))).toBe(true);
    });
  });

  describe('结果结构', () => {
    it('无命中时 passed=true 且 issues 为空数组', () => {
      const result = checkCopy('日常清洁小帮手，用起来很方便');
      expect(result).toEqual({ passed: true, issues: [] });
    });

    it('issues 按 position 升序排列', () => {
      const text = '全网第一，顶级灭蟑药，绝对安全';
      const result = checkCopy(text);
      const positions = result.issues.map((i) => i.position);
      const sorted = [...positions].sort((a, b) => a - b);
      expect(positions).toEqual(sorted);
    });
  });
});
