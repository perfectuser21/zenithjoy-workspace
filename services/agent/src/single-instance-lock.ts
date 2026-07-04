// services/agent/src/single-instance-lock.ts
//
// 单实例锁（PID 复用免疫版，2026-07-04 decision 72740815）。
//
// 旧实现只存 PID、只用 process.kill(pid,0) 判活：agent 全灭后锁残留，PID 被系统
// 复用给任意其它进程 → 新实例误判"已在运行"集体秒退（07-03/07-04 两晚生产实锤）。
// 本模块锁内容为 `pid|imageName`，判"已在运行"要求 PID 存活【且】镜像名匹配。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

export const AGENT_IMAGE_NAME = 'zenithjoy-agent.exe';

export interface LockInfo {
  pid: number;
  // null = 旧格式锁（裸 PID），无法验证镜像名
  imageName: string | null;
}

export function formatLockContent(pid: number, imageName: string): string {
  return `${pid}|${imageName}`;
}

export function parseLockContent(content: string): LockInfo | null {
  const raw = (content || '').trim();
  if (!raw) return null;
  const [pidStr, imageName] = raw.split('|');
  const pid = parseInt(pidStr, 10);
  if (isNaN(pid) || pid <= 0) return null;
  return { pid, imageName: imageName || null };
}

// probe(pid) → 该 PID 当前进程的镜像名；进程不存在 → null。
export type ImageNameProbe = (pid: number) => string | null;

// 纯判定（CI 锚点）：锁是否被【活着的 agent 进程】持有。
// - PID 死 → false（陈旧锁，可接管）
// - PID 活但镜像名不符（PID 被复用）→ false（可接管）
// - PID 活且镜像名匹配 → true
// - 旧格式锁（无镜像名）→ 保守：PID 活即 true（不破坏旧版共存语义）
export function isLockHeldByLiveAgent(lock: LockInfo, probe: ImageNameProbe): boolean {
  const liveName = probe(lock.pid);
  if (liveName === null) return false;
  if (lock.imageName === null) return true;
  return liveName.toLowerCase() === lock.imageName.toLowerCase();
}

// 真实 probe：Windows 用 tasklist 按 PID 查镜像名；非 Windows 退回 kill(0) 存在性
// （非 Windows 无生产 agent，仅保证行为不崩）。
export function probeImageName(pid: number): string | null {
  try {
    process.kill(pid, 0);
  } catch {
    return null;
  }
  if (process.platform !== 'win32') return 'non-windows-process';
  try {
    const out = execFileSync(
      'tasklist',
      ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh'],
      { encoding: 'utf8', windowsHide: true, timeout: 10_000 },
    );
    // CSV 行: "zenithjoy-agent.exe","1234",...；查不到时 tasklist 输出提示文本（无引号列）
    const m = out.match(/^"([^"]+)"/m);
    return m ? m[1] : null;
  } catch {
    // tasklist 本身失败 → 保守认为进程在（kill(0) 已确认 PID 存在）
    return 'unknown-image';
  }
}

export function lockFilePath(): string {
  return path.join(os.homedir(), '.zenithjoy-agent', 'agent.lock');
}

// 抢单实例锁。true = 拿到锁可继续启动；false = 确有活 agent 在跑，应退出。
// 锁机制自身故障一律放行（宁可双跑一瞬，不把客户机锁死）。
export function acquireSingleInstanceLock(
  probe: ImageNameProbe = probeImageName,
  log: (msg: string) => void = console.log,
): boolean {
  try {
    const lockFile = lockFilePath();
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    if (fs.existsSync(lockFile)) {
      const lock = parseLockContent(fs.readFileSync(lockFile, 'utf8'));
      if (lock && isLockHeldByLiveAgent(lock, probe)) {
        log(`[agent] another instance already running (PID ${lock.pid}), exiting`);
        return false;
      }
      if (lock) {
        log(`[agent] stale lock (PID ${lock.pid} dead or reused), taking over`);
      }
    }
    fs.writeFileSync(lockFile, formatLockContent(process.pid, AGENT_IMAGE_NAME), 'utf8');
    const cleanLock = () => {
      try {
        // 只删自己写的锁（退出竞态下不误删接管者的新锁）
        const cur = parseLockContent(fs.readFileSync(lockFile, 'utf8'));
        if (cur && cur.pid === process.pid) fs.unlinkSync(lockFile);
      } catch { /* ignore */ }
    };
    process.on('exit', cleanLock);
    process.on('SIGTERM', () => { cleanLock(); process.exit(0); });
    return true;
  } catch (e) {
    log(`[agent] single-instance lock failed (non-fatal): ${e}`);
    return true;
  }
}
