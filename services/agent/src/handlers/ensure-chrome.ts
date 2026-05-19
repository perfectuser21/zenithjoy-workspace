import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

const CHROME_VERSION = 'win64-131.0.6778.85';
const CHROME_EXE = path.join(
  os.homedir(),
  '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell',
  CHROME_VERSION, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe',
);

const ZIP_URL =
  'https://zenithjoy-static-1333590468.cos.ap-guangzhou.myqcloud.com/agent-deps/chrome-headless-shell-win64.zip';

export async function ensureChromeHeadlessShell(): Promise<void> {
  if (fs.existsSync(CHROME_EXE)) {
    const size = fs.statSync(CHROME_EXE).size;
    if (size > 100 * 1024 * 1024) {
      console.log('[chrome] headless shell already installed');
      return;
    }
    // Corrupt or incomplete — delete and re-download
    console.warn(`[chrome] headless shell exists but too small (${size} bytes), re-downloading`);
    fs.rmSync(path.dirname(CHROME_EXE), { recursive: true, force: true });
  }

  const destDir = path.dirname(CHROME_EXE); // …/chrome-headless-shell-win64/
  const parentDir = path.dirname(destDir);   // …/win64-131.0.6778.85/
  const zipPath = path.join(os.tmpdir(), 'zj-chrome-headless.zip');

  console.log('[chrome] downloading headless shell (~101MB) from domestic CDN…');
  fs.mkdirSync(parentDir, { recursive: true });

  try {
    // PowerShell Invoke-WebRequest + Expand-Archive — no external npm deps
    await execAsync(
      `powershell -NoProfile -Command "` +
      `Invoke-WebRequest -Uri '${ZIP_URL}' -OutFile '${zipPath}'; ` +
      `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${parentDir}'; ` +
      `Remove-Item -Force '${zipPath}'"`,
      { timeout: 600_000, windowsHide: true },
    );

    if (!fs.existsSync(CHROME_EXE)) {
      throw new Error('chrome-headless-shell.exe not found after extraction');
    }
    console.log('[chrome] headless shell installed successfully');
  } catch (err) {
    console.error('[chrome] install failed (HyperFrames render will fall back to FFmpeg):', (err as Error).message?.slice(0, 200));
    try { fs.rmSync(zipPath, { force: true }); } catch { }
  }
}
