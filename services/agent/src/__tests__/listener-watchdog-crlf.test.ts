// Regression test: listener-watchdog.bat must strip \r from .env before the `for /f` loop.
// Root cause: Windows `for /f "usebackq tokens=1,* delims==="` keeps the trailing \r when
// parsing CRLF .env files. ZENITHJOY_API_BASE gets a trailing \r, making all HTTP calls fail:
// "TypeError: Failed to parse URL from https://api.com\r/api/listen/..."
// Same vulnerability fixed in start.bat (v1.1.91 Step 1.8); watchdog needs identical treatment.
// Failing scenario (pre-fix): listener-watchdog.bat reads CRLF .env → ZENITHJOY_API_BASE
// contains \r → listen_chat.py receives malformed --middleware-url → HTTP fails → watchdog
// keeps restarting but listen_chat immediately errors every 30s.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const INSTALL_PACK = resolve(__dirname, '../../install-pack');
const WATCHDOG_BAT = readFileSync(resolve(INSTALL_PACK, 'listener-watchdog.bat'), 'utf-8');

describe('listener-watchdog.bat — CRLF strip regression', () => {
  it('contains PowerShell CRLF normalization before reading .env', () => {
    expect(WATCHDOG_BAT).toContain("ReadAllText('.env')");
    expect(WATCHDOG_BAT).toContain("-replace '\\r',''");
    expect(WATCHDOG_BAT).toContain("WriteAllText('.env'");
  });

  it('CRLF strip appears before the for/f .env parsing loop', () => {
    const stripIdx = WATCHDOG_BAT.indexOf("ReadAllText('.env')");
    const forIdx = WATCHDOG_BAT.indexOf('for /f "usebackq tokens=1,* delims==');
    expect(stripIdx).toBeGreaterThan(-1);
    expect(forIdx).toBeGreaterThan(-1);
    expect(stripIdx).toBeLessThan(forIdx);
  });

  it('uses -NoProfile to avoid loading user PS profile that might block script', () => {
    const stripBlock = WATCHDOG_BAT.slice(0, WATCHDOG_BAT.indexOf('for /f "usebackq tokens=1,* delims=='));
    expect(stripBlock).toContain('-NoProfile');
  });
});
