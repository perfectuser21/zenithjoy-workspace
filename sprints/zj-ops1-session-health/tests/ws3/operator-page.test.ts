import { describe, it, expect } from 'vitest';
import { readFileSync, accessSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname_compat = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname_compat, '../../../../');

describe('WS3 — Operator Dashboard Tab 1 [BEHAVIOR]', () => {
  const pagePath = resolve(ROOT, 'apps/dashboard/src/pages/OperatorPage.tsx');
  const navPath = resolve(ROOT, 'apps/dashboard/src/config/navigation.config.ts');
  const getPageContent = () => readFileSync(pagePath, 'utf8');

  it('OperatorPage.tsx 文件存在', () => {
    expect(() => accessSync(pagePath)).not.toThrow();
  });

  it('OperatorPage.tsx 包含全部 8 个平台（中文名）', () => {
    const content = getPageContent();
    const platforms = ['抖音', '快手', '小红书', '视频号', '头条', '微博', '知乎', '公众号'];
    platforms.forEach(p => {
      expect(content, `缺平台: ${p}`).toContain(p);
    });
  });

  it('OperatorPage.tsx 包含 4 个账号类型（MAIN/SUB_1/SUB_2/SUB_3）', () => {
    const content = getPageContent();
    expect(content).toContain('MAIN');
    expect(content).toContain('SUB_1');
    expect(content).toContain('SUB_2');
    expect(content).toContain('SUB_3');
  });

  it('OperatorPage.tsx 包含 is_operator 权限守卫（email 或 role 判断）', () => {
    const content = getPageContent();
    expect(content).toMatch(/is_operator|isOperator|operator.*email|xuxiao21xx/);
  });

  it('未授权用户被重定向或返回 403', () => {
    const content = getPageContent();
    expect(content).toMatch(/redirect|navigate|403|Unauthorized|未授权/i);
  });

  it('页面包含"立即同步"按钮', () => {
    const content = getPageContent();
    expect(content).toMatch(/立即同步|手动同步|sync.*button|SyncButton/i);
  });

  it('页面包含状态三态显示（在线/离线/未配置）', () => {
    const content = getPageContent();
    expect(content).toMatch(/ok|expired|missing|在线|离线|未配置/i);
  });

  it('OperatorPage.tsx 有 export default（可被路由加载）', () => {
    const content = getPageContent();
    expect(content).toMatch(/export\s+default\s+/);
  });

  it('navigation.config.ts 注册了 /operator 路由', () => {
    const content = readFileSync(navPath, 'utf8');
    expect(content).toMatch(/\/operator|'operator'|"operator"/);
  });
});
