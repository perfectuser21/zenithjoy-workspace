import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

function getAppDataFfmpegDir(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'ZenithJoy', 'runtime', 'ffmpeg');
}

export function getAppDataFfmpegExe(): string {
  return path.join(getAppDataFfmpegDir(), 'ffmpeg.exe');
}

export function getAppDataFfprobeExe(): string {
  return path.join(getAppDataFfmpegDir(), 'ffprobe.exe');
}

const ZIP_URL =
  'https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/agent-deps/ffmpeg-win64.zip';

export async function ensureFfmpeg(): Promise<void> {
  const ffmpegExe = getAppDataFfmpegExe();
  const ffprobeExe = getAppDataFfprobeExe();

  if (fs.existsSync(ffmpegExe) && fs.existsSync(ffprobeExe)) {
    const size = fs.statSync(ffmpegExe).size;
    if (size > 50 * 1024 * 1024) {
      console.log('[ffmpeg] already installed at AppData');
      return;
    }
    console.warn(`[ffmpeg] exists but too small (${size} bytes), re-downloading`);
    fs.rmSync(getAppDataFfmpegDir(), { recursive: true, force: true });
  }

  const destDir = getAppDataFfmpegDir();
  const zipPath = path.join(os.tmpdir(), 'zj-ffmpeg-win64.zip');

  console.log('[ffmpeg] downloading (~138MB) from domestic CDN...');
  fs.mkdirSync(destDir, { recursive: true });

  try {
    await execAsync(
      `powershell -NoProfile -Command "` +
      `Invoke-WebRequest -Uri '${ZIP_URL}' -OutFile '${zipPath}'; ` +
      `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'; ` +
      `Remove-Item -Force '${zipPath}'"`,
      { timeout: 600_000, windowsHide: true },
    );

    if (!fs.existsSync(ffmpegExe)) {
      throw new Error('ffmpeg.exe not found after extraction');
    }
    console.log('[ffmpeg] installed successfully at AppData');
  } catch (err) {
    console.error('[ffmpeg] install failed (will fall back to system ffmpeg):', (err as Error).message?.slice(0, 200));
    try { fs.rmSync(zipPath, { force: true }); } catch { }
  }
}
