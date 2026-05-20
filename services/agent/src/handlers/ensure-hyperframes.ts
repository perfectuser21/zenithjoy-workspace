import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

type Executor = (cmd: string, opts: { timeout: number; windowsHide: boolean }) => Promise<unknown>;

export function getHyperframesCmd(): string {
  return 'hyperframes';
}

export async function ensureHyperframes(
  executor: Executor = (cmd, opts) => execAsync(cmd, opts),
): Promise<string> {
  try {
    await executor('hyperframes --version', { timeout: 5_000, windowsHide: true });
    return 'hyperframes';
  } catch { }

  console.log('[hyperframes] npm package not found, installing via npmmirror...');
  try {
    await executor(
      'npm install -g hyperframes --registry https://registry.npmmirror.com',
      { timeout: 120_000, windowsHide: true },
    );
    console.log('[hyperframes] installed OK');
  } catch (err) {
    console.warn('[hyperframes] install failed:', (err as Error).message?.slice(0, 200));
    console.warn('[hyperframes] video template rendering may fall back to plain resize');
  }
  return 'hyperframes';
}
