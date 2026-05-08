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

  it('type=article (无脚本) → 抛 Error 含 "no script for type article"', () => {
    expect(() => (resolveDouyinScriptPath as any)({ type: 'article' }, {})).toThrow(/no script for type article|unsupported type article/i);
  });

  it('handleDouyinPublishTask payload.type=article → 返回 status=failed + result.error 含 article', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as any);
    const spawnImpl = vi.fn();
    const r = await (handleDouyinPublishTask as any)(
      { task_id: 't1', folder_path: '/tmp/non-existent', type: 'article' },
      { apiBase: 'http://localhost:3001', fetchImpl, spawnImpl, pickFirstMp4: () => '/tmp/x.mp4' },
    );
    expect(r.status).toBe('failed');
    expect(JSON.stringify(r.result)).toMatch(/article|unsupported|no script/i);
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('严禁 fallback image：type=article 不能 spawn image 脚本', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as any);
    const spawnImpl = vi.fn();
    await (handleDouyinPublishTask as any)(
      { task_id: 't2', folder_path: '/tmp/non-existent', type: 'article' },
      { apiBase: 'http://localhost:3001', fetchImpl, spawnImpl, pickFirstMp4: () => '/tmp/x.mp4' },
    );
    const calls = JSON.stringify(spawnImpl.mock.calls);
    expect(calls).not.toMatch(/publish-douyin-image/);
  });
});
