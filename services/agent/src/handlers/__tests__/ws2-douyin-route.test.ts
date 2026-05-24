import { describe, it, expect, vi } from 'vitest';
import { resolveDouyinScriptPath, handleDouyinPublishTask } from '../douyin-publish';

describe('Workstream 2 — Agent resolveDouyinScriptPath 按 type 路由 [BEHAVIOR]', () => {
  it('type=video, real=false → 路径含 publish-douyin-video-dryrun.cjs', () => {
    const p = (resolveDouyinScriptPath as any)({ type: 'video' }, { ZENITHJOY_AGENT_REAL_PUBLISH: '0' });
    expect(p).toMatch(/publish-douyin-video-dryrun\.cjs$/);
  });

  it('type=video, real=true → 路径含 publish-douyin-video.cjs', () => {
    const p = (resolveDouyinScriptPath as any)({ type: 'video' }, { ZENITHJOY_AGENT_REAL_PUBLISH: '1' });
    expect(p).toMatch(/publish-douyin-video\.cjs$/);
    expect(p).not.toMatch(/dryrun/);
  });

  it('type=article → 路径含 publish-douyin-article-dryrun.cjs（WS2 article 已加入 SUPPORTED_DOUYIN_TYPES）', () => {
    // WS2 后 article 不再 throw，按 dryrun 默认返回 article-dryrun 路径
    const p = (resolveDouyinScriptPath as any)({ type: 'article' }, {});
    expect(p).toMatch(/publish-douyin-article-dryrun\.cjs/);
    expect(p).not.toMatch(/video|image/);
  });

  it('handleDouyinPublishTask payload.type=article → 路由到 article 脚本并 spawn（WS2 新支持）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as any);
    const fakeChild = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn().mockImplementation((event: string, cb: Function) => {
        if (event === 'close') cb(0);
      }),
    };
    const spawnImpl = vi.fn().mockReturnValue(fakeChild);
    const r = await (handleDouyinPublishTask as any)(
      { task_id: 't1', folder_path: '/tmp/non-existent', type: 'article' },
      { apiBase: 'http://localhost:3001', fetchImpl, spawnImpl, pickFirstMp4: () => '/tmp/x.mp4' },
    );
    expect(spawnImpl).toHaveBeenCalled();
    const spawnedPath = JSON.stringify(spawnImpl.mock.calls);
    expect(spawnedPath).toMatch(/publish-douyin-article/);
    expect(r.status).toBe('success');
  });

  it('严禁 fallback image：type=article 不能 spawn image 脚本', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as any);
    const fakeChild = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn().mockImplementation((event: string, cb: Function) => {
        if (event === 'close') cb(0);
      }),
    };
    const spawnImpl = vi.fn().mockReturnValue(fakeChild);
    await (handleDouyinPublishTask as any)(
      { task_id: 't2', folder_path: '/tmp/non-existent', type: 'article' },
      { apiBase: 'http://localhost:3001', fetchImpl, spawnImpl, pickFirstMp4: () => '/tmp/x.mp4' },
    );
    const calls = JSON.stringify(spawnImpl.mock.calls);
    expect(calls).not.toMatch(/publish-douyin-image/);
  });
});
