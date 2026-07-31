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
    expect(android).toContain('attempt_marker:');
    expect(android).toContain('android-cancel-evidence');
    expect(android).toContain('line02-android-cancel-realmachine-smoke.sh');
    for (const evidenceField of [
      'github_run_id',
      'head_sha',
      'attempt_marker',
      'repeat_index',
      'cancel_requested_at',
      'command_received_at',
    ]) {
      expect(android).toContain(evidenceField);
    }
  });

  it('独立 E2E runner 直接执行完整取消链', () => {
    const runner = readFileSync(
      'sprints/07310943-kernel-0e82adad/e2e-verify.sh',
      'utf8',
    );

    for (const oracle of [
      'e2e-verify.ps1',
      'gh workflow run',
      'DISPATCHED_AT',
      'ATTEMPT_MARKER',
      'android-cancel-evidence',
      'safe_exit',
      'cancel-requested.png',
      'cancel-cooldown.png',
    ]) {
      expect(runner).toContain(oracle);
    }
    expect(runner).not.toContain('contract-draft.md');
    expect(runner).not.toContain('awk');
  });
});
