import { spawn as childSpawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// 真机验证发现：核心进程 ws 连上中台成功('open')那一刻是唯一钩子，
// 作战窗WPF壳(apps/agent-panel-host)从未被拉起过，PrepPRD Step1"首次装机仪式"
// 在生产环境从未成立——之前所有验证都是 schtasks 手动拉起的。

export function resolveAgentPanelHostExePath(execDir: string): string {
  return path.join(execDir, 'agent-panel-host', 'ZenithJoyAgentPanel.exe');
}

let launched = false;

export interface LaunchAgentPanelHostOptions {
  platform?: NodeJS.Platform;
  execDir?: string;
  exists?: (p: string) => boolean;
  spawnFn?: typeof childSpawn;
}

export function launchAgentPanelHost(opts: LaunchAgentPanelHostOptions = {}): boolean {
  const platform = opts.platform ?? process.platform;
  const execDir = opts.execDir ?? path.dirname(process.execPath);
  const exists = opts.exists ?? fs.existsSync;
  const spawnFn = opts.spawnFn ?? childSpawn;

  if (platform !== 'win32') return false;
  if (launched) return false;

  const exePath = resolveAgentPanelHostExePath(execDir);
  if (!exists(exePath)) {
    console.warn('[agent] agent-panel-host exe 不存在，跳过拉起:', exePath);
    return false;
  }

  launched = true;
  try {
    const child = spawnFn(exePath, [], {
      detached: true,
      stdio: 'ignore',
      cwd: path.dirname(exePath),
    });
    child.unref();
    console.log('[agent] agent-panel-host 已拉起, pid=', child.pid);
    return true;
  } catch (err) {
    console.warn('[agent] agent-panel-host 拉起失败:', err);
    return false;
  }
}

export function __resetForTest(): void {
  launched = false;
}
