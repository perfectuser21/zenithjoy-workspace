import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

describe('agent-python-embedded [BEHAVIOR] — TDD Red Phase', () => {
  it('build-install-pack.sh 含 python-embedded 下载步骤', () => {
    const script = readFileSync(
      resolve(REPO_ROOT, 'services/agent/scripts/build-install-pack.sh'),
      'utf8'
    );
    expect(script).toMatch(/python-embedded/);
    expect(script).toMatch(/embeddable/i);
  });

  it('start.bat 含讲述人解锁命令 Start-Process Narrator', () => {
    const bat = readFileSync(
      resolve(REPO_ROOT, 'services/agent/install-pack/start.bat'),
      'utf8'
    );
    expect(bat).toMatch(/Start-Process Narrator/i);
    expect(bat).toMatch(/Stop-Process/i);
  });

  it('wechat-rpa.ts handler 含 python-embedded 路径优先 + python3 回退', () => {
    const handler = readFileSync(
      resolve(REPO_ROOT, 'services/agent/src/handlers/wechat-rpa.ts'),
      'utf8'
    );
    expect(handler).toMatch(/python-embedded[/\\]python\.exe/);
    expect(handler).toMatch(/['"]python3['"]/);
  });

  it('startWechatListener 函数体含 python-embedded 优先逻辑', () => {
    const handler = readFileSync(
      resolve(REPO_ROOT, 'services/agent/src/handlers/wechat-rpa.ts'),
      'utf8'
    );
    const fnStart = handler.indexOf('startWechatListener');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = handler.slice(fnStart, fnStart + 600);
    expect(fnBody).toMatch(/python-embedded/);
  });

  it('agent-python-embedded-smoke.sh 存在且含真实验证内容', () => {
    const smokePath = resolve(
      REPO_ROOT,
      '.github/workflows/scripts/smoke/agent-python-embedded-smoke.sh'
    );
    expect(existsSync(smokePath)).toBe(true);
    const content = readFileSync(smokePath, 'utf8');
    const realLines = content
      .split('\n')
      .filter(l => l.trim() && !l.trim().startsWith('#'));
    expect(realLines.length).toBeGreaterThan(5);
    expect(content).toMatch(/python-embedded/);
  });

  it('services/agent/package.json 版本号为 1.1.78', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'services/agent/package.json'), 'utf8')
    );
    expect(pkg.version).toBe('1.1.78');
  });

  it('e2e-verify.ps1 存在（windows_cloud 验收脚本）', () => {
    const ps1Path = resolve(
      REPO_ROOT,
      'sprints/06031608-agent-python-embedded/e2e-verify.ps1'
    );
    expect(existsSync(ps1Path)).toBe(true);
    const content = readFileSync(ps1Path, 'utf8');
    expect(content).toMatch(/python-embedded/);
  });
});
