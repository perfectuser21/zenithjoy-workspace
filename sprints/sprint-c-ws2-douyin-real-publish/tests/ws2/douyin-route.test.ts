import { describe, it, expect, vi } from 'vitest';

describe('Workstream 2 — Agent resolveDouyinScriptPath 按 type 路由 [BEHAVIOR]', () => {
  it('type=video, real=false → 路径含 publish-douyin-video-dryrun.cjs', async () => {
    const { resolveDouyinScriptPath } = await import('../../../../services/agent/src/handlers/douyin-publish.js');
    const p = (resolveDouyinScriptPath as any)({ type: 'video' }, { ZENITHJOY_AGENT_REAL_PUBLISH: '0' });
    expect(p).toMatch(/publish-douyin-video-dryrun\.cjs$/);
  });

  it('type=video, real=true → 路径含 publish-douyin-video.cjs', async () => {
    const { resolveDouyinScriptPath } = await import('../../../../services/agent/src/handlers/douyin-publish.js');
    const p = (resolveDouyinScriptPath as any)({ type: 'video' }, { ZENITHJOY_AGENT_REAL_PUBLISH: '1' });
    expect(p).toMatch(/publish-douyin-video\.cjs$/);
    expect(p).not.toMatch(/dryrun/);
  });

  it('type=article (无脚本) → 抛 Error 含 "no script for type article"', async () => {
    const { resolveDouyinScriptPath } = await import('../../../../services/agent/src/handlers/douyin-publish.js');
    expect(() => (resolveDouyinScriptPath as any)({ type: 'article' }, {})).toThrow(/no script for type article|unsupported type article/i);
  });

  it('handleDouyinPublishTask 选脚本失败时 onTaskComplete({status:"failed", reason})', async () => {
    const { handleDouyinPublishTask } = await import('../../../../services/agent/src/handlers/douyin-publish.js');
    const onTaskComplete = vi.fn();
    await (handleDouyinPublishTask as any)(
      { id: 't1', platform: 'douyin', type: 'article', payload: {} },
      { onTaskComplete },
    );
    expect(onTaskComplete).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', reason: expect.stringMatching(/article|unsupported|no script/i) }),
    );
  });

  it('严禁 fallback image：type=article 不能 spawn image 脚本', async () => {
    const cp = await import('node:child_process');
    const spawnSpy = vi.spyOn(cp, 'spawn').mockImplementation(() => ({ on: vi.fn(), stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any));
    const { handleDouyinPublishTask } = await import('../../../../services/agent/src/handlers/douyin-publish.js');
    try {
      await (handleDouyinPublishTask as any)(
        { id: 't2', platform: 'douyin', type: 'article', payload: {} },
        { onTaskComplete: vi.fn() },
      );
    } catch {}
    const spawnedScripts = spawnSpy.mock.calls.map((c) => JSON.stringify(c));
    expect(spawnedScripts.join('\n')).not.toMatch(/publish-douyin-image/);
  });
});
