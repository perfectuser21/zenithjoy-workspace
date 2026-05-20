import { describe, it, expect, vi } from 'vitest';
import { getHyperframesCmd, ensureHyperframes } from '../handlers/ensure-hyperframes';

describe('ensure-hyperframes', () => {
  it('getHyperframesCmd 返回 hyperframes', () => {
    expect(getHyperframesCmd()).toBe('hyperframes');
  });

  it('hyperframes 已安装 → 只调用 version check，不触发安装', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: 'hyperframes/0.6.28', stderr: '' });
    const cmd = await ensureHyperframes(exec);
    expect(cmd).toBe('hyperframes');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toContain('--version');
  });

  it('hyperframes 未安装 → 调用 npm install -g hyperframes --registry npmmirror', async () => {
    const exec = vi.fn()
      .mockRejectedValueOnce(new Error('command not found'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' });
    const cmd = await ensureHyperframes(exec);
    expect(cmd).toBe('hyperframes');
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[1][0]).toMatch(/npm install -g hyperframes.*npmmirror/);
  });

  it('npm install 失败 → 仍返回 hyperframes（调用方有 try/catch 降级）', async () => {
    const exec = vi.fn()
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('network error'));
    const cmd = await ensureHyperframes(exec);
    expect(cmd).toBe('hyperframes');
  });
});
