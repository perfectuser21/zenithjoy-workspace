import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const navSrc = readFileSync(join(__dirname, '../navigation.config.ts'), 'utf8');
const ctxSrc = readFileSync(join(__dirname, '../../contexts/InstanceContext.tsx'), 'utf8');

describe('充值页三件套', () => {
  it('① 菜单项已注册且带 featureKey', () => {
    expect(navSrc).toMatch(/path:\s*'\/credits'[\s\S]{0,200}featureKey:\s*'credits'/);
  });

  it('② 路由表已注册 CreditsPage 且要求登录', () => {
    expect(navSrc).toMatch(
      /{\s*path:\s*'\/credits',\s*component:\s*'CreditsPage',\s*requireAuth:\s*true\s*}/
    );
  });

  it('③ InstanceContext features 含 credits（漏掉这条菜单会静默消失）', () => {
    expect(ctxSrc).toMatch(/'credits':\s*true/);
  });
});
