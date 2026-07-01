import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

// ── 完整版 Chromium（headful，qr-bind 扫码窗口用）────────────────────────────
// 存 ~/.zenithjoy-agent/chrome-win64/，跨 OTA 不丢。
// qr-bind-douyin-burner.cjs 的 findBundledChromium() 读同一路径。
export const HEADFUL_CHROME_EXE = path.join(
  os.homedir(), '.zenithjoy-agent', 'chrome-win64', 'chrome.exe',
);
const HEADFUL_CHROME_ZIP_URL =
  'https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/chromium-win64-1223.zip';

export async function ensureChromiumHeadful(): Promise<void> {
  if (process.platform !== 'win32') return;
  // chrome.exe 是 ~4MB 启动器，真正体积在 chrome.dll（~280MB）。用 chrome.dll 判断完整性。
  const chromeDllPath = path.join(path.dirname(HEADFUL_CHROME_EXE), 'chrome.dll');
  if (fs.existsSync(chromeDllPath) && fs.statSync(chromeDllPath).size > 100 * 1024 * 1024) {
    console.log('[chrome-headful] already installed');
    return;
  }
  if (fs.existsSync(HEADFUL_CHROME_EXE)) {
    console.warn('[chrome-headful] chrome.dll missing or too small, re-downloading');
    try {
      fs.rmSync(path.dirname(HEADFUL_CHROME_EXE), { recursive: true, force: true });
    } catch (rmErr) {
      // EBUSY: chrome 正在运行，无法删除 — 跳过本次重下，等下次空闲再修复
      console.warn('[chrome-headful] cannot remove old dir (EBUSY?), skipping:', (rmErr as Error).message?.slice(0, 100));
      return;
    }
  }

  const parentDir = path.dirname(path.dirname(HEADFUL_CHROME_EXE)); // ~/.zenithjoy-agent/
  const zipPath = path.join(os.tmpdir(), 'zj-chromium-win64.zip');

  console.log('[chrome-headful] downloading full Chromium (~182MB) for QR-bind…');
  fs.mkdirSync(parentDir, { recursive: true });

  try {
    await execAsync(
      `powershell -NoProfile -Command "` +
      `Invoke-WebRequest -Uri '${HEADFUL_CHROME_ZIP_URL}' -OutFile '${zipPath}'; ` +
      `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${parentDir}'; ` +
      `Remove-Item -Force '${zipPath}'"`,
      { timeout: 900_000, windowsHide: true },
    );
    if (!fs.existsSync(HEADFUL_CHROME_EXE)) {
      throw new Error('chrome.exe not found after extraction');
    }
    console.log('[chrome-headful] installed →', HEADFUL_CHROME_EXE);
  } catch (err) {
    console.error('[chrome-headful] install failed (QR-bind falls back to msedge):', (err as Error).message?.slice(0, 200));
    try { fs.rmSync(zipPath, { force: true }); } catch { /* ignore */ }
  }
}

const CHROME_VERSION = 'win64-131.0.6778.85';
const CHROME_EXE = path.join(
  os.homedir(),
  '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell',
  CHROME_VERSION, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe',
);

const ZIP_URL =
  'https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/agent-deps/chrome-headless-shell-win64.zip';

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
