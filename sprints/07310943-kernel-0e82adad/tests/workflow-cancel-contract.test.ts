import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('取消链 CI workflow 合同', () => {
  it('Windows 与 Android workflow 执行真实取消链', () => {
    const windows = readFileSync('.github/workflows/e2e-orphan-consolidation-windows.yml', 'utf8');
    const android = readFileSync('.github/workflows/e2e-line02-android-collect.yml', 'utf8');

    expect(windows).toContain('acquisition-cancel.spec.ts');
    expect(windows).toContain('apps/api');
    expect(windows).toContain('Repeat cancel E2E');
    expect(android).toContain('scenario:');
    expect(android).toContain('repeat:');
    expect(android).toContain('android-cancel-evidence');
    expect(android).toContain('line02-android-cancel-realmachine-smoke.sh');
  });
});
