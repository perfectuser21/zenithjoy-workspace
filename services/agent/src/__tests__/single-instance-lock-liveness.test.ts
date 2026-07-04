// services/agent/src/__tests__/single-instance-lock-liveness.test.ts
//
// 根因④（2026-07-03/07-04 两晚实锤）：agent.lock 只存 PID，判活只用 process.kill(pid,0)。
// agent 全灭后 lock 残留，PID 被系统复用给任意其它进程 → kill(pid,0) 不抛 →
// 所有新实例误判"已有实例在跑"集体秒退 → 客户机停机直到人工删锁。
//
// 守护：锁必须存 PID+镜像名，判"已在运行"必须 PID 存活【且】镜像名是 zenithjoy-agent，
// 否则视为陈旧锁可接管。任何人把名字校验去掉 → 本测试红。

import { describe, it, expect } from 'vitest';
import {
  formatLockContent,
  parseLockContent,
  isLockHeldByLiveAgent,
} from '../single-instance-lock';

describe('single-instance-lock — 锁内容格式（PID+镜像名）', () => {
  it('formatLockContent 输出 pid|imageName', () => {
    expect(formatLockContent(1234, 'zenithjoy-agent.exe')).toBe('1234|zenithjoy-agent.exe');
  });

  it('parseLockContent 解析新格式', () => {
    expect(parseLockContent('1234|zenithjoy-agent.exe')).toEqual({
      pid: 1234,
      imageName: 'zenithjoy-agent.exe',
    });
  });

  it('parseLockContent 兼容旧格式（裸 PID，无镜像名）', () => {
    expect(parseLockContent('4711')).toEqual({ pid: 4711, imageName: null });
  });

  it('parseLockContent 非法内容返回 null', () => {
    expect(parseLockContent('')).toBeNull();
    expect(parseLockContent('abc')).toBeNull();
  });
});

describe('single-instance-lock — 活性判定（PID 复用免疫）', () => {
  const probeAlive = (aliveName: string | null) => (_pid: number) => aliveName;

  it('PID 不存在（probe 返 null）→ 陈旧锁，可接管', () => {
    const lock = { pid: 1234, imageName: 'zenithjoy-agent.exe' };
    expect(isLockHeldByLiveAgent(lock, probeAlive(null))).toBe(false);
  });

  it('PID 存活但镜像名不是 agent（PID 被复用给别的进程）→ 陈旧锁，可接管', () => {
    const lock = { pid: 1234, imageName: 'zenithjoy-agent.exe' };
    expect(isLockHeldByLiveAgent(lock, probeAlive('notepad.exe'))).toBe(false);
  });

  it('PID 存活且镜像名匹配 → 真在运行，不可启动', () => {
    const lock = { pid: 1234, imageName: 'zenithjoy-agent.exe' };
    expect(isLockHeldByLiveAgent(lock, probeAlive('zenithjoy-agent.exe'))).toBe(true);
  });

  it('镜像名大小写不敏感（Windows 语义）', () => {
    const lock = { pid: 1234, imageName: 'zenithjoy-agent.exe' };
    expect(isLockHeldByLiveAgent(lock, probeAlive('ZenithJoy-Agent.EXE'))).toBe(true);
  });

  it('旧格式锁（无镜像名）→ PID 存活时保守判"在运行"，PID 死则可接管', () => {
    const legacy = { pid: 1234, imageName: null };
    expect(isLockHeldByLiveAgent(legacy, probeAlive('anything.exe'))).toBe(true);
    expect(isLockHeldByLiveAgent(legacy, probeAlive(null))).toBe(false);
  });
});
