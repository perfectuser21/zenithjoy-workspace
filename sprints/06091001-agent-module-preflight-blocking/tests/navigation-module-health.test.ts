import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const NAV_CONFIG_PATH = path.join(REPO_ROOT, 'apps/dashboard/src/config/navigation.config.ts');

describe('/module-health nav item [BEHAVIOR]', () => {
  it('navigation.config.ts 文件存在', () => {
    expect(() => fs.accessSync(NAV_CONFIG_PATH)).not.toThrow();
  });

  it('/module-health nav 项无 requireSuperAdmin: true', () => {
    const src = fs.readFileSync(NAV_CONFIG_PATH, 'utf8');
    const lines = src.split('\n');

    let inModuleHealth = false;
    let startLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("path: '/module-health'")) {
        inModuleHealth = true;
        startLine = i;
      }
      // 进入下一个 path 项时退出 /module-health 块
      if (inModuleHealth && i > startLine + 1 && line.includes("path: '/")) {
        inModuleHealth = false;
      }
      if (inModuleHealth && line.includes('requireSuperAdmin: true')) {
        throw new Error(
          `/module-health nav 项仍含 requireSuperAdmin: true（line ${i + 1}）。` +
          `需删除此行让普通账号可访问模块健康看板。`
        );
      }
    }

    // 确认 /module-health 路径确实在 nav 配置中
    expect(src).toContain("path: '/module-health'");
  });
});
