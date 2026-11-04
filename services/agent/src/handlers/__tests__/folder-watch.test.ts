// services/agent/src/handlers/__tests__/folder-watch.test.ts
//
// Walking Skeleton #1 — folder-watch handler unit test
//
// 验证：
//   - bind() 记录路径，getBoundPath() 取回
//   - listMp4s() / pickFirstMp4() 从绑定目录返回 mp4
//   - stop() 关闭 watcher
//   - 多次 bind() 切换目录时旧 watcher 关闭

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import { createFolderWatchManager } from '../folder-watch';

describe('folder-watch', () => {
  let tmpDir: string;
  let managers: ReturnType<typeof createFolderWatchManager>[];
  let watchers: { close: ReturnType<typeof vi.fn>; listener: fs.WatchListener<string> }[];

  // Keep directory/file operations real; inject only the native watcher boundary.
  function createUnitManager(onChange?: (file: string) => void) {
    const fsWatch = vi.fn((_path: fs.PathLike, _options: fs.WatchOptions, listener: fs.WatchListener<string>) => {
      const watcher = { close: vi.fn(), listener };
      watchers.push(watcher);
      return watcher as unknown as fs.FSWatcher;
    }) as unknown as typeof fs.watch;
    const manager = createFolderWatchManager({ fsWatch, onChange });
    managers.push(manager);
    return manager;
  }

  beforeEach(() => {
    managers = [];
    watchers = [];
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zj-agent-fw-')));
  });
  afterEach(() => {
    try {
      for (const manager of managers) manager.stop();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('bind() / getBoundPath() and actual onChange filename/null handling', () => {
    const onChange = vi.fn();
    const m = createUnitManager(onChange);
    expect(m.getBoundPath()).toBeNull();
    m.bind(tmpDir);
    expect(m.getBoundPath()).toBe(tmpDir);
    watchers[0].listener('rename', 'new.mp4');
    expect(onChange).toHaveBeenCalledWith(path.join(tmpDir, 'new.mp4'));
    watchers[0].listener('change', null);
    expect(onChange).toHaveBeenCalledTimes(1);
    m.stop();
    expect(watchers[0].close).toHaveBeenCalledTimes(1);
  });

  it('listMp4s() returns only mp4 files', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.mp4'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'nope');
    fs.writeFileSync(path.join(tmpDir, 'c.MP4'), 'fake');

    const m = createUnitManager();
    m.bind(tmpDir);
    const list = m.listMp4s().sort();
    expect(list.length).toBe(2);
    expect(list[0].endsWith('.MP4') || list[0].endsWith('.mp4')).toBe(true);
    m.stop();
  });

  it('pickFirstMp4() returns first mp4 by name', () => {
    fs.writeFileSync(path.join(tmpDir, 'b.mp4'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'a.mp4'), 'fake');

    const m = createUnitManager();
    m.bind(tmpDir);
    const first = m.pickFirstMp4();
    expect(first).toBe(path.join(tmpDir, 'a.mp4'));
    m.stop();
  });

  it('pickFirstMp4() returns null when folder empty / no mp4', () => {
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'nope');
    const m = createUnitManager();
    m.bind(tmpDir);
    expect(m.pickFirstMp4()).toBeNull();
    m.stop();
  });

  it('returns null when not bound', () => {
    const m = createUnitManager();
    expect(m.pickFirstMp4()).toBeNull();
    expect(m.listMp4s()).toEqual([]);
    m.stop();
  });

  it('bind() to a new path closes the previous watcher', () => {
    const m = createUnitManager();
    m.bind(tmpDir);
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-agent-fw2-'));
    try {
      m.bind(otherDir);
      expect(m.getBoundPath()).toBe(otherDir);
      expect(watchers).toHaveLength(2);
      expect(watchers[0].close).toHaveBeenCalledTimes(1);
      expect(watchers[1].close).not.toHaveBeenCalled();
      m.stop();
      expect(watchers[0].close).toHaveBeenCalledTimes(1);
      expect(watchers[1].close).toHaveBeenCalledTimes(1);
    } finally {
      m.stop();
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it('delivers a real native file event through the production manager', () => {
    const fixture=fileURLToPath(new URL('./fixtures/folder-watch-native.mjs',import.meta.url));
    const loader=createRequire(import.meta.url).resolve('tsx');
    const result=spawnSync(process.execPath,['--import',pathToFileURL(loader).href,fixture,tmpDir],{
      encoding:'utf8',timeout:10000,cwd:fileURLToPath(new URL('../../../',import.meta.url)),
    });
    expect(result.error?.message).toBeUndefined();
    expect(result.status,result.stderr).toBe(0);
    const report=JSON.parse(result.stdout);
    const target=path.join(tmpDir,'watched','native-event.mp4');
    expect(report.target).toBe(target);
    expect(report.registration.registered).toBe(true);
    expect(report.registration.errors).toEqual([]);
    expect(report.rawEvents.some((event:{filename:string|null})=>event.filename==='native-event.mp4')).toBe(true);
    expect(report.published).toBe(1);
    expect(report.events.some((event:{file:string})=>event.file===target)).toBe(true);
    expect(report.elapsedMs).toBeLessThan(8000);
    expect(fs.readFileSync(target,'utf8')).toBe('native video publication');
  }, 12000);
});
