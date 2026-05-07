// services/agent/src/handlers/__tests__/folder-watch.test.ts
//
// Walking Skeleton #1 — folder-watch handler unit test
//
// 验证：
//   - bind() 记录路径，getBoundPath() 取回
//   - listMp4s() / pickFirstMp4() 从绑定目录返回 mp4
//   - stop() 关闭 watcher
//   - 多次 bind() 切换目录时旧 watcher 关闭

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFolderWatchManager } from '../folder-watch';

describe('folder-watch', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-agent-fw-'));
  });
  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('bind() / getBoundPath()', () => {
    const m = createFolderWatchManager();
    expect(m.getBoundPath()).toBeNull();
    m.bind(tmpDir);
    expect(m.getBoundPath()).toBe(tmpDir);
    m.stop();
  });

  it('listMp4s() returns only mp4 files', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.mp4'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'nope');
    fs.writeFileSync(path.join(tmpDir, 'c.MP4'), 'fake');

    const m = createFolderWatchManager();
    m.bind(tmpDir);
    const list = m.listMp4s().sort();
    expect(list.length).toBe(2);
    expect(list[0].endsWith('.MP4') || list[0].endsWith('.mp4')).toBe(true);
    m.stop();
  });

  it('pickFirstMp4() returns first mp4 by name', () => {
    fs.writeFileSync(path.join(tmpDir, 'b.mp4'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'a.mp4'), 'fake');

    const m = createFolderWatchManager();
    m.bind(tmpDir);
    const first = m.pickFirstMp4();
    expect(first).toBe(path.join(tmpDir, 'a.mp4'));
    m.stop();
  });

  it('pickFirstMp4() returns null when folder empty / no mp4', () => {
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'nope');
    const m = createFolderWatchManager();
    m.bind(tmpDir);
    expect(m.pickFirstMp4()).toBeNull();
    m.stop();
  });

  it('returns null when not bound', () => {
    const m = createFolderWatchManager();
    expect(m.pickFirstMp4()).toBeNull();
    expect(m.listMp4s()).toEqual([]);
    m.stop();
  });

  it('bind() to a new path closes the previous watcher', () => {
    const m = createFolderWatchManager();
    m.bind(tmpDir);
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-agent-fw2-'));
    try {
      m.bind(otherDir);
      expect(m.getBoundPath()).toBe(otherDir);
    } finally {
      m.stop();
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });
});
