import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import * as fs from 'fs';

vi.mock('fs');

import { getHyperframesCmd, ensureHyperframes, getHyperframesProcess } from '../ensure-hyperframes';

const ZJ_RUNTIME = path.join(os.homedir(), 'AppData', 'Roaming', 'ZenithJoy', 'runtime');
const NODE_EXE = path.join(ZJ_RUNTIME, 'nodejs', 'node.exe');
const HF_CLI = path.join(ZJ_RUNTIME, 'hyperframes', 'node_modules', 'hyperframes', 'dist', 'cli.js');

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

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

describe('structured HyperFrames launch without a shell',()=>{
 it('launches bundled external Node and CLI as distinct path arguments',()=>{
  vi.spyOn(fs,'existsSync').mockImplementation(file=>file===NODE_EXE||file===HF_CLI);
  expect(getHyperframesProcess('win32')).toEqual({executable:NODE_EXE,args:[HF_CLI]});
 });
 it('resolves system Windows npm CLI directly instead of invoking a .cmd shell',()=>{
  const directory=path.join(os.tmpdir(),'Node & Hyperframes Fixture');vi.stubEnv('PATH',directory);
  const node=path.join(directory,'node.exe'),cli=path.join(directory,'node_modules','hyperframes','dist','cli.js');
  vi.spyOn(fs,'existsSync').mockImplementation(file=>file===node||file===cli);
  expect(getHyperframesProcess('win32')).toEqual({executable:node,args:[cli]});
 });
 it('fails closed when Windows has only a shell shim and no actual CLI/Node',()=>{
  vi.spyOn(fs,'existsSync').mockReturnValue(false);
  expect(()=>getHyperframesProcess('win32')).toThrow(/refusing a shell/);
  expect(getHyperframesProcess('linux')).toEqual({executable:'hyperframes',args:[]});
 });
});
