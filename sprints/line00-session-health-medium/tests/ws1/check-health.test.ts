import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('WS1 — check-health.js 修复 [BEHAVIOR]', () => {
  const checkHealthPath = 'scripts/sessions/check-health.js';
  const ghaYamlPath = '.github/workflows/session-health-check.yml';
  const smokePath = '.github/workflows/scripts/smoke/session-health-medium-smoke.sh';

  it('check-health.js 不含任何 *_MAIN secretEnv 赋值', () => {
    const content = fs.readFileSync(checkHealthPath, 'utf8');
    const mainRefs = content.match(/secretEnv:\s*['"][A-Z]+_MAIN['"]/g);
    expect(mainRefs).toBeNull();
  });

  it('check-health.js 含 DOUYIN_COOKIES secretEnv', () => {
    const content = fs.readFileSync(checkHealthPath, 'utf8');
    expect(content).toContain('DOUYIN_COOKIES');
  });

  it('check-health.js 含 8 个 *_COOKIES 主号条目', () => {
    const content = fs.readFileSync(checkHealthPath, 'utf8');
    const cookieKeys = [
      'DOUYIN_COOKIES',
      'KUAISHOU_COOKIES',
      'XIAOHONGSHU_COOKIES',
      'SHIPINHAO_COOKIES',
      'TOUTIAO_COOKIES',
      'WEIBO_COOKIES',
      'ZHIHU_COOKIES',
      'GONGZHONGHAO_COOKIES',
    ];
    for (const key of cookieKeys) {
      expect(content, `缺少 ${key}`).toContain(key);
    }
  });

  it('GHA YAML 含 DOUYIN_COOKIES: 引用（非 DOUYIN_MAIN）', () => {
    const content = fs.readFileSync(ghaYamlPath, 'utf8');
    expect(content).toContain('DOUYIN_COOKIES:');
    expect(content).not.toMatch(/DOUYIN_MAIN:\s*\$\{\{/);
  });

  it('GHA YAML 含全部 8 个 *_COOKIES: 引用', () => {
    const content = fs.readFileSync(ghaYamlPath, 'utf8');
    const keys = [
      'DOUYIN_COOKIES:',
      'KUAISHOU_COOKIES:',
      'XIAOHONGSHU_COOKIES:',
      'SHIPINHAO_COOKIES:',
      'TOUTIAO_COOKIES:',
      'WEIBO_COOKIES:',
      'ZHIHU_COOKIES:',
      'GONGZHONGHAO_COOKIES:',
    ];
    for (const key of keys) {
      expect(content, `GHA YAML 缺少 ${key}`).toContain(key);
    }
  });

  it('smoke script 文件存在且含 SKIP_HTTP_CHECK + check-health 调用', () => {
    expect(fs.existsSync(smokePath)).toBe(true);
    const content = fs.readFileSync(smokePath, 'utf8');
    expect(content).toContain('SKIP_HTTP_CHECK');
    expect(content).toContain('check-health');
  });
});
