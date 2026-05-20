import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import * as fs from 'fs';

vi.mock('fs');

import { getHyperframesCmd, ensureHyperframes } from '../ensure-hyperframes';

const ZJ_RUNTIME = path.join(os.homedir(), 'AppData', 'Roaming', 'ZenithJoy', 'runtime');
const NODE_EXE = path.join(ZJ_RUNTIME, 'nodejs', 'node.exe');
const HF_CLI = path.join(ZJ_RUNTIME, 'hyperframes', 'node_modules', 'hyperframes', 'dist', 'cli.js');

afterEach(() => vi.restoreAllMocks());

describe('getHyperframesCmd', () => {
  it('node.exe + cli.js 都存在时返回 "node.exe" "cli.js" 组合命令', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p) =>
      p === NODE_EXE || p === HF_CLI
    );
    const cmd = getHyperframesCmd();
    expect(cmd).toBe(`"${NODE_EXE}" "${HF_CLI}"`);
  });

  it('node.exe 不存在时返回 "hyperframes"（系统路径降级）', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false as any);
    expect(getHyperframesCmd()).toBe('hyperframes');
  });

  it('cli.js 不存在（hyperframes 未安装）时返回 "hyperframes"', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === NODE_EXE);
    expect(getHyperframesCmd()).toBe('hyperframes');
  });
});

describe('ensureHyperframes', () => {
  it('本地路径存在时直接返回，不调 executor', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p) =>
      p === NODE_EXE || p === HF_CLI
    );
    const mockExecutor = vi.fn();
    const cmd = await ensureHyperframes(mockExecutor as never);
    expect(cmd).toBe(`"${NODE_EXE}" "${HF_CLI}"`);
    expect(mockExecutor).not.toHaveBeenCalled();
  });
});
