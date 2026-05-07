// services/agent/src/handlers/__tests__/douyin-publish.test.ts
//
// Walking Skeleton #1 — douyin-publish task handler unit test
//
// 验证：
//   - handleDouyinPublishTask 从 folder_path 拉取首个 mp4
//   - spawn 调到 publisher dryrun 脚本
//   - 完成后 POST /api/publish/receipt 上报，body 含 task_id / status / result
//   - spawn 失败时 receipt status='failed'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleDouyinPublishTask } from '../douyin-publish';

function fakeChild(opts: {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  error?: Error;
}): any {
  const ee: any = new EventEmitter();
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  setImmediate(() => {
    if (opts.error) {
      ee.emit('error', opts.error);
      return;
    }
    if (opts.stdout) ee.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) ee.stderr.emit('data', Buffer.from(opts.stderr));
    ee.emit('close', opts.exitCode);
  });
  return ee;
}

describe('handleDouyinPublishTask', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-agent-dy-'));
    fs.writeFileSync(path.join(tmpDir, 'video1.mp4'), 'fake');
  });
  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('reads first mp4 from folder, spawns publisher, posts success receipt', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const spawnImpl = vi.fn((_cmd: string, args: string[]) => {
      // last arg should be a queue file path the handler wrote
      const queueFile = args[args.length - 1];
      const q = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
      expect(q.images.length).toBeGreaterThan(0);
      return fakeChild({
        exitCode: 0,
        stdout:
          '[DY-DRY] some log\n{"ok":true,"dryRun":true,"url":"https://creator.douyin.com/x"}\n',
      });
    });

    const res = await handleDouyinPublishTask(
      { task_id: 'task-1', folder_path: tmpDir },
      {
        apiBase: 'https://api.example.com',
        fetchImpl: fetchImpl as any,
        spawnImpl: spawnImpl as any,
        scriptPath: '/fake/publish-douyin-image-dryrun.cjs',
      },
    );

    expect(res.ok).toBe(true);
    expect(res.status).toBe('success');
    expect(spawnImpl).toHaveBeenCalledTimes(1);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/publish/receipt');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body.task_id).toBe('task-1');
    expect(body.status).toBe('success');
    expect(body.result?.url).toBe('https://creator.douyin.com/x');
  });

  it('reports failed receipt when spawn exits non-zero', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const spawnImpl = vi.fn(() =>
      fakeChild({ exitCode: 2, stderr: 'boom in publisher' }),
    );

    const res = await handleDouyinPublishTask(
      { task_id: 'task-2', folder_path: tmpDir },
      {
        apiBase: 'https://api.example.com',
        fetchImpl: fetchImpl as any,
        spawnImpl: spawnImpl as any,
        scriptPath: '/fake/publish-douyin-image-dryrun.cjs',
      },
    );

    expect(res.ok).toBe(false);
    expect(res.status).toBe('failed');
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.task_id).toBe('task-2');
    expect(body.status).toBe('failed');
    expect(body.result?.error).toMatch(/boom|exit/i);
  });

  it('reports failed receipt when folder has no mp4', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-agent-dy-empty-'));
    try {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      const spawnImpl = vi.fn();

      const res = await handleDouyinPublishTask(
        { task_id: 'task-3', folder_path: emptyDir },
        {
          apiBase: 'https://api.example.com',
          fetchImpl: fetchImpl as any,
          spawnImpl: spawnImpl as any,
          scriptPath: '/fake/publish-douyin-image-dryrun.cjs',
        },
      );

      expect(res.ok).toBe(false);
      expect(res.status).toBe('failed');
      expect(spawnImpl).not.toHaveBeenCalled();
      const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
      expect(body.result?.error).toMatch(/no.*mp4|empty/i);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
