// Regression test: start.bat must kill any existing zenithjoy-agent.exe before starting a new one.
// Root cause for "又掉了" / repeated disconnects: two agents running with the same license ID
// both connect to the server WS; the second connection kicks the first, which triggers reconnects
// that look like drops to the user. Fix: Step 6.95 in start.bat kills existing instances first.
// Failing scenario (pre-fix): upgrade by running new start.bat without closing old agent →
// PID 19512 (old) + PID 23144 (new) fight for WS → server kicks one → "agent 掉了".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const INSTALL_PACK = resolve(__dirname, '../../install-pack');
const START_BAT = readFileSync(resolve(INSTALL_PACK, 'start.bat'), 'utf-8');

describe('start.bat — single-instance guard (regression)', () => {
  it('contains PowerShell Get-Process kill for existing zenithjoy-agent processes', () => {
    expect(START_BAT).toContain('Get-Process -Name zenithjoy-agent');
    expect(START_BAT).toContain('Stop-Process -Force');
  });

  it('single-instance guard appears before the agent start command', () => {
    const killIdx = START_BAT.indexOf('Get-Process -Name zenithjoy-agent');
    // The actual invocation is a bare "zenithjoy-agent.exe" on its own line (not in a REM comment)
    const startIdx = START_BAT.indexOf('\nzenithjoy-agent.exe');
    expect(killIdx).toBeGreaterThan(-1);
    expect(startIdx).toBeGreaterThan(-1);
    expect(killIdx).toBeLessThan(startIdx);
  });

  it('uses -ErrorAction SilentlyContinue so first-run (no prior process) does not fail', () => {
    expect(START_BAT).toContain('ErrorAction SilentlyContinue');
  });
});
