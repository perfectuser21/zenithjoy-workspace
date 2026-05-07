// services/agent/src/handlers/folder-watch.ts
//
// Walking Skeleton #1 — 本地视频文件夹绑定 + 监听
//
// 收到 task `folder/bind` 时：
//   1. 记录绑定路径（内存 + 后续可由 index.ts 持久化）
//   2. 起 fs.watch 监听该目录，新增/修改文件触发 onChange 回调
//   3. 提供 listMp4s() / pickFirstMp4() 供 douyin-publish 拉首个视频
//
// fs.watch 是平台相关的：Windows 走 ReadDirectoryChangesW，macOS 走 FSEvents，
// Linux 走 inotify。recursive 在 Linux 上要 Node 20+，这里暂不开 recursive，
// 只盯 bound dir 顶层。

import fs from 'node:fs';
import path from 'node:path';

export interface FolderWatchManager {
  bind(localPath: string): void;
  getBoundPath(): string | null;
  pickFirstMp4(): string | null;
  listMp4s(): string[];
  stop(): void;
}

export interface FolderWatchOptions {
  onChange?: (file: string) => void;
  fsWatch?: typeof fs.watch;
}

const MP4_EXT_RE = /\.mp4$/i;

export function createFolderWatchManager(
  opts: FolderWatchOptions = {},
): FolderWatchManager {
  let boundPath: string | null = null;
  let watcher: fs.FSWatcher | null = null;
  const watchFn = opts.fsWatch ?? fs.watch;

  function closeWatcher(): void {
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
      watcher = null;
    }
  }

  return {
    bind(localPath: string): void {
      const resolved = path.resolve(localPath);
      if (!fs.existsSync(resolved)) {
        // 路径不存在不报错；中台 push 任务下来时本地可能尚未创建，
        // 留给后续 fs.watch 的 ENOENT 走错误回调（onChange 时会自检）
        // 但仍记录绑定路径以便用户事后创建
      }
      closeWatcher();
      boundPath = resolved;
      try {
        watcher = watchFn(resolved, { persistent: false }, (_event, filename) => {
          if (filename && opts.onChange) {
            opts.onChange(path.join(resolved, filename.toString()));
          }
        });
      } catch {
        // 路径不存在或权限问题 — listMp4s/pickFirstMp4 会处理
      }
    },

    getBoundPath(): string | null {
      return boundPath;
    },

    listMp4s(): string[] {
      if (!boundPath) return [];
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(boundPath);
      } catch {
        return [];
      }
      return entries
        .filter((name) => MP4_EXT_RE.test(name))
        .sort()
        .map((name) => path.join(boundPath as string, name));
    },

    pickFirstMp4(): string | null {
      const list = this.listMp4s();
      return list.length > 0 ? list[0] : null;
    },

    stop(): void {
      closeWatcher();
    },
  };
}
