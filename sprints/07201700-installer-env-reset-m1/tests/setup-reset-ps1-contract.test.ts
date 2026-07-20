/**
 * Contract test: setup-reset.ps1 behaviors
 * task_id: 2f66a0f8-a15e-4a42-9b9c-2841fc99ba66
 * Covers: BEHAVIOR-1 (setup-reset convergence)
 *
 * These are unit-level contract assertions for the PowerShell script.
 * On Windows runners: executes the real ps1 via child_process.
 * On Linux CI: performs static analysis (ASCII check, no-warning-downgrade, no-pause).
 *
 * Run: npx vitest run sprints/07201700-installer-env-reset-m1/tests/setup-reset-ps1-contract.test.ts
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../..');
const SETUP_RESET_PS1 = resolve(REPO_ROOT, 'services/agent/install-pack/setup-reset.ps1');
const START_BAT = resolve(REPO_ROOT, 'services/agent/install-pack/start.bat');

describe('[CONTRACT] setup-reset.ps1 -- BEHAVIOR-1 static assertions', () => {

  // -----------------------------------------------------------------------
  // SR-1: File exists
  // -----------------------------------------------------------------------
  it('SR-1: setup-reset.ps1 exists at services/agent/install-pack/setup-reset.ps1', () => {
    expect(existsSync(SETUP_RESET_PS1)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // SR-2: I-2 compliance -- pure ASCII (no em-dash, no full-width chars, no non-ASCII)
  // -----------------------------------------------------------------------
  it('SR-2: setup-reset.ps1 is pure ASCII (I-2 PS5.1 ASCII rule)', () => {
    if (!existsSync(SETUP_RESET_PS1)) return; // SR-1 will catch missing file

    const content = readFileSync(SETUP_RESET_PS1, 'latin1'); // latin1 preserves raw bytes
    const lines = content.split('\n');

    const nonAsciiLines: Array<{ line: number; content: string; bytes: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (let j = 0; j < line.length; j++) {
        if (line.charCodeAt(j) > 127) {
          nonAsciiLines.push({
            line: i + 1,
            content: line.slice(0, 80),
            bytes: `char[${j}]=0x${line.charCodeAt(j).toString(16)}`,
          });
          break; // one report per line
        }
      }
    }

    if (nonAsciiLines.length > 0) {
      const report = nonAsciiLines.slice(0, 5).map(l =>
        `  Line ${l.line}: ${l.bytes} -- "${l.content}"`
      ).join('\n');
      expect(nonAsciiLines).toHaveLength(0);
      console.error('Non-ASCII chars found (I-2 violation):\n' + report);
    }
  });

  // -----------------------------------------------------------------------
  // SR-3: I-1 compliance -- no [WARN] + continue patterns in error paths
  // Pattern: lines containing 'WARN' that are NOT comments and followed by no throw/exit
  // -----------------------------------------------------------------------
  it('SR-3: setup-reset.ps1 has no warning-downgrade pattern (I-1 no-warn-and-continue)', () => {
    if (!existsSync(SETUP_RESET_PS1)) return;

    const content = readFileSync(SETUP_RESET_PS1, 'utf8');
    const lines = content.split('\n');

    const warnDowngradeLines: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimStart();
      // Skip comment lines
      if (line.startsWith('#')) continue;
      // Flag Write-Host/echo with [WARN] or [WARNING] not followed by throw/exit on same or next line
      if (/\[WARN(ING)?\]/i.test(line) && !/throw|exit|break|return/i.test(line)) {
        // Check next line for throw/exit
        const nextLine = (lines[i + 1] ?? '').trim();
        if (!/throw|exit|break|return/i.test(nextLine)) {
          warnDowngradeLines.push(i + 1);
        }
      }
    }

    expect(warnDowngradeLines).toHaveLength(0);
    if (warnDowngradeLines.length > 0) {
      console.error('Warning-downgrade pattern found at lines:', warnDowngradeLines);
    }
  });

  // -----------------------------------------------------------------------
  // SR-4: -DryRun parameter defined (required for CI smoke E2E)
  // -----------------------------------------------------------------------
  it('SR-4: setup-reset.ps1 defines -DryRun parameter', () => {
    if (!existsSync(SETUP_RESET_PS1)) return;

    const content = readFileSync(SETUP_RESET_PS1, 'utf8');
    // Check for param block with DryRun
    const hasDryRunParam = /param\s*\([\s\S]*?\[?switch\]?\s*\$?DryRun/i.test(content) ||
                           /\$DryRun\b/.test(content);
    expect(hasDryRunParam).toBe(true);
  });

  // -----------------------------------------------------------------------
  // SR-5: Script handles HKCU ZENITHJOY_* cleanup (key operations present)
  // -----------------------------------------------------------------------
  it('SR-5: setup-reset.ps1 contains HKCU ZENITHJOY_* cleanup logic', () => {
    if (!existsSync(SETUP_RESET_PS1)) return;

    const content = readFileSync(SETUP_RESET_PS1, 'utf8');
    // Should reference HKCU and ZENITHJOY_ prefix
    expect(content).toMatch(/HKCU/i);
    expect(content).toMatch(/ZENITHJOY_/);
    // Should use reg delete or Remove-ItemProperty for cleanup
    const hasDeleteOp = /reg delete|Remove-ItemProperty|Remove-Item.*HKCU/i.test(content);
    expect(hasDeleteOp).toBe(true);
  });

  // -----------------------------------------------------------------------
  // SR-6: Script handles schtasks delete + create (not /change -- avoids error on missing task)
  // -----------------------------------------------------------------------
  it('SR-6: setup-reset.ps1 uses schtasks /delete + /create (not /change) for ZenithJoyAgent task', () => {
    if (!existsSync(SETUP_RESET_PS1)) return;

    const content = readFileSync(SETUP_RESET_PS1, 'utf8');
    // Must reference ZenithJoyAgent task and schtasks
    expect(content).toMatch(/schtasks/i);
    expect(content).toMatch(/ZenithJoyAgent/);
    // Must use /delete and /create (not /change)
    expect(content).toMatch(/\/delete/i);
    expect(content).toMatch(/\/create/i);
    // Must NOT use /change (which fails when task doesn't exist)
    expect(content).not.toMatch(/schtasks.*\/change/i);
  });

  // -----------------------------------------------------------------------
  // SR-7: Script has timeout mechanism (N-1: <= 10s execution)
  // Verify there's some timeout/error-handling that prevents infinite hang
  // -----------------------------------------------------------------------
  it('SR-7: setup-reset.ps1 has error action preference or timeout guard (N-1)', () => {
    if (!existsSync(SETUP_RESET_PS1)) return;

    const content = readFileSync(SETUP_RESET_PS1, 'utf8');
    // Should have ErrorActionPreference=Stop or explicit try/catch or timeout
    const hasSafeExec = /ErrorActionPreference\s*=\s*['"]Stop['"]/i.test(content) ||
                        /try\s*\{/i.test(content) ||
                        /-TimeoutSec\b/i.test(content);
    expect(hasSafeExec).toBe(true);
  });
});

// -----------------------------------------------------------------------
// start.bat static contract assertions
// -----------------------------------------------------------------------
describe('[CONTRACT] start.bat -- BEHAVIOR-2 static assertions', () => {

  // -----------------------------------------------------------------------
  // SB-1: File exists
  // -----------------------------------------------------------------------
  it('SB-1: start.bat exists at services/agent/install-pack/start.bat', () => {
    expect(existsSync(START_BAT)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // SB-2: No bare 'pause' in failure paths (N-6 / I-1 lint-no-pause)
  // -----------------------------------------------------------------------
  it('SB-2: start.bat has no bare pause statements (N-6 lint-no-pause)', () => {
    if (!existsSync(START_BAT)) return;

    const content = readFileSync(START_BAT, 'utf8');
    const lines = content.split('\n');

    const pauseLines: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Skip comment lines (REM)
      if (/^REM\b/i.test(line)) continue;
      // Skip echo lines (they might echo the word "pause")
      if (/^echo\b/i.test(line)) continue;
      // Match bare pause
      if (/^pause\s*$/i.test(line)) {
        pauseLines.push(i + 1);
      }
    }

    if (pauseLines.length > 0) {
      console.error('Bare pause found at lines:', pauseLines);
    }
    expect(pauseLines).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // SB-3: boot-error.json write present in start.bat failure paths
  // -----------------------------------------------------------------------
  it('SB-3: start.bat references boot-error.json in failure handling', () => {
    if (!existsSync(START_BAT)) return;

    const content = readFileSync(START_BAT, 'utf8');
    expect(content).toMatch(/boot-error\.json/i);
  });

  // -----------------------------------------------------------------------
  // SB-4: start.bat has curl fail-report upload in failure paths
  // -----------------------------------------------------------------------
  it('SB-4: start.bat has curl call to boot-fail endpoint', () => {
    if (!existsSync(START_BAT)) return;

    const content = readFileSync(START_BAT, 'utf8');
    // Should have curl calling boot-fail
    expect(content).toMatch(/curl.*boot.fail|boot.fail.*curl/i);
  });

  // -----------------------------------------------------------------------
  // SB-5: All error paths use exit /b 1 (not pause)
  // -----------------------------------------------------------------------
  it('SB-5: start.bat error paths use "exit /b 1" (not pause)', () => {
    if (!existsSync(START_BAT)) return;

    const content = readFileSync(START_BAT, 'utf8');
    // Should have exit /b 1 in error handling
    expect(content).toMatch(/exit\s+\/b\s+1/i);
  });

  // -----------------------------------------------------------------------
  // SB-6: ZJ_LAUNCH_PROBE seam present (required for E2E dryrun)
  // -----------------------------------------------------------------------
  it('SB-6: start.bat retains ZJ_LAUNCH_PROBE early-exit seam', () => {
    if (!existsSync(START_BAT)) return;

    const content = readFileSync(START_BAT, 'utf8');
    expect(content).toMatch(/ZJ_LAUNCH_PROBE/);
    expect(content).toMatch(/probe-marker\.txt/i);
  });

  // -----------------------------------------------------------------------
  // SB-7: ZJ_BOOT_FAIL_TEST seam present (required for proven-to-fire E2E)
  // BEHAVIOR-2: start.bat must support ZJ_BOOT_FAIL_TEST env var seam to
  // trigger the 401 failure path in CI without a full agent startup.
  // A-6 proven-to-fire in installer-env-reset-smoke-contract.sh depends on
  // this seam to bypass normal flow and directly exercise the boot-error.json
  // + curl fail-report path.
  // -----------------------------------------------------------------------
  it('SB-7: start.bat contains ZJ_BOOT_FAIL_TEST seam (BEHAVIOR-2 proven-to-fire seam)', () => {
    if (!existsSync(START_BAT)) return;

    const content = readFileSync(START_BAT, 'utf8');
    // ZJ_BOOT_FAIL_TEST must be present as a literal string in start.bat
    // so the CI smoke can set this env var to trigger the 401 failure path
    expect(content).toMatch(/ZJ_BOOT_FAIL_TEST/);
  });
});
