import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

type Executor = (cmd: string, opts: { timeout: number; windowsHide: boolean }) => Promise<unknown>;

const APP_DATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const ZJ_RUNTIME = path.join(APP_DATA, 'ZenithJoy', 'runtime');
const ZJ_NODE_EXE = path.join(ZJ_RUNTIME, 'nodejs', 'node.exe');
const ZJ_NPM_CLI = path.join(ZJ_RUNTIME, 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js');
const ZJ_HF_DIR = path.join(ZJ_RUNTIME, 'hyperframes');
const ZJ_HF_MAIN = path.join(ZJ_HF_DIR, 'node_modules', 'hyperframes', 'dist', 'cli.js');

function getLocalHyperframesCmd(): string | null {
  if (fs.existsSync(ZJ_NODE_EXE) && fs.existsSync(ZJ_HF_MAIN)) {
    return `"${ZJ_NODE_EXE}" "${ZJ_HF_MAIN}"`;
  }
  return null;
}

export function getHyperframesCmd(): string {
  return getLocalHyperframesCmd() ?? 'hyperframes';
}

export async function ensureHyperframes(
  executor: Executor = (cmd, opts) => execAsync(cmd, opts),
): Promise<string> {
  const localCmd = getLocalHyperframesCmd();
  if (localCmd) return localCmd;

  try {
    await executor('hyperframes --version', { timeout: 5_000, windowsHide: true });
    return 'hyperframes';
  } catch { }

  if (fs.existsSync(ZJ_NODE_EXE) && fs.existsSync(ZJ_NPM_CLI)) {
    console.log('[hyperframes] 使用内置 Node.js 安装 hyperframes (npmmirror)...');
    try {
      await executor(
        `"${ZJ_NODE_EXE}" "${ZJ_NPM_CLI}" install hyperframes --prefix "${ZJ_HF_DIR}" --registry https://registry.npmmirror.com`,
        { timeout: 180_000, windowsHide: true },
      );
      const after = getLocalHyperframesCmd();
      if (after) {
        console.log('[hyperframes] 安装完成');
        return after;
      }
    } catch (err) {
      console.warn('[hyperframes] 安装失败:', (err as Error).message?.slice(0, 200));
    }
  }

  console.log('[hyperframes] 降级到系统 npm 安装...');
  try {
    await executor(
      'npm install -g hyperframes --registry https://registry.npmmirror.com',
      { timeout: 120_000, windowsHide: true },
    );
    console.log('[hyperframes] installed via system npm');
  } catch (err) {
    console.warn('[hyperframes] install failed:', (err as Error).message?.slice(0, 200));
    console.warn('[hyperframes] video template rendering may fall back to plain resize');
  }
  return 'hyperframes';
}
