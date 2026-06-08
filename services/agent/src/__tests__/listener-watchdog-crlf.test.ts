// Regression test: listener-watchdog.bat must NOT exist (removed in v1.1.109).
// History: .bat handled CRLF-strip for .env parsing (see git log for pre-removal code).
// Current: startWechatListener in wechat-rpa.ts handles the restart loop internally;
//          no .bat file needed. This test locks the deletion to prevent accidental re-add.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';

const INSTALL_PACK = resolve(__dirname, '../../install-pack');

describe('listener-watchdog.bat — deletion regression', () => {
  it('listener-watchdog.bat does not exist (intentionally removed in v1.1.109)', () => {
    const batPath = resolve(INSTALL_PACK, 'listener-watchdog.bat');
    expect(existsSync(batPath)).toBe(false);
  });
});
