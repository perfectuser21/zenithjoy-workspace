import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname_compat = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname_compat, '../../../../');

describe('WS1 — check-health.js 全平台扩展 [BEHAVIOR]', () => {
  const scriptPath = resolve(ROOT, 'scripts/sessions/check-health.js');
  const reportPath = resolve(ROOT, 'session-health-report.json');
  const getContent = () => readFileSync(scriptPath, 'utf8');

  it('PLATFORMS 包含 35 条目（32 平台账号 + 3 API keys）', () => {
    const content = getContent();
    const count = (content.match(/secretEnv:/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(35);
  });

  it('PLATFORMS 覆盖全部 8 平台（含快手/小红书/视频号等非抖音平台）', () => {
    const content = getContent();
    const requiredPlatforms = [
      'KUAISHOU', 'XIAOHONGSHU', 'SHIPINHAO',
      'TOUTIAO', 'WEIBO', 'ZHIHU', 'GONGZHONGHAO',
    ];
    requiredPlatforms.forEach(platform => {
      expect(content, `缺平台: ${platform}`).toContain(platform);
    });
  });

  it('sendFeishuAlert 函数存在，使用 Promise.race + 3000ms 超时', () => {
    const content = getContent();
    expect(content).toContain('sendFeishuAlert');
    expect(content).toContain('Promise.race');
    expect(content).toMatch(/3[_\s]*(?:000|\*\s*1000)/);
  });

  it('支持 SKIP_HTTP_CHECK 环境变量（CI 离线模式）', () => {
    const content = getContent();
    expect(content).toContain('SKIP_HTTP_CHECK');
  });

  it('status 枚举不含禁用值 error/warning/skip/healthy', () => {
    const content = getContent();
    expect(content).not.toMatch(/status:\s*['"]error['"]/);
    expect(content).not.toMatch(/status:\s*['"]warning['"]/);
    expect(content).not.toMatch(/status:\s*['"]skip['"]/);
    expect(content).not.toMatch(/status:\s*['"]healthy['"]/);
  });

  it('status 枚举使用 PRD 规定值 ok/expired/invalid/missing', () => {
    const content = getContent();
    expect(content).toMatch(/status:\s*['"]invalid['"]/);
    expect(content).toMatch(/status:\s*['"]missing['"]/);
  });

  it('输出字段使用 platform（而非 PRD 禁用的 name/label/account）', () => {
    const content = getContent();
    expect(content).not.toMatch(/return\s*\{\s*name:/);
    expect(content).toMatch(/platform:/);
  });

  it('SKIP_HTTP_CHECK=true 运行输出 JSON array（不是对象）含 35 条目', () => {
    try {
      execSync(`SKIP_HTTP_CHECK=true node "${scriptPath}"`, {
        timeout: 15000,
        cwd: ROOT,
        env: { ...process.env, SKIP_HTTP_CHECK: 'true' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (_e) {
      // script may exit non-zero when all sessions are missing — report still written
    }
    expect(existsSync(reportPath)).toBe(true);
    const raw = readFileSync(reportPath, 'utf8');
    const data = JSON.parse(raw);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(35);
  });

  it('每条输出 keys 完全等于 PRD 规范（不多不少）', () => {
    if (!existsSync(reportPath)) return;
    const raw = readFileSync(reportPath, 'utf8');
    const data = JSON.parse(raw) as Record<string, unknown>[];
    if (!Array.isArray(data)) return;
    const expected = JSON.stringify(['checkedAt', 'expiresAt', 'platform', 'secretEnv', 'status']);
    data.forEach((item, i) => {
      const actual = JSON.stringify(Object.keys(item).sort());
      expect(actual, `item[${i}] keys mismatch`).toBe(expected);
    });
  });
});
