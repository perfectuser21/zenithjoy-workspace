// services/agent/src/handlers/__tests__/kuaishou-publish.test.ts
//
// 验证 resolveKuaishouScriptPath：
//   - image → 含 kuaishou-image-dryrun
//   - video → 含 kuaishou-video-dryrun
//   - unknown → 抛 Error 含 'no script for type'
//   - ZENITHJOY_AGENT_REAL_PUBLISH=true → 路径不含 -dryrun

import { describe, it, expect } from 'vitest';
import { resolveKuaishouScriptPath } from '../kuaishou-publish';

describe('resolveKuaishouScriptPath', () => {
  it('image dryrun: returns path containing kuaishou-image-dryrun', () => {
    const p = resolveKuaishouScriptPath('image', {});
    expect(p).toContain('kuaishou-image-dryrun');
  });

  it('video dryrun: returns path containing kuaishou-video-dryrun', () => {
    const p = resolveKuaishouScriptPath('video', {});
    expect(p).toContain('kuaishou-video-dryrun');
  });

  it('unknown type: throws Error containing no script for type', () => {
    expect(() => resolveKuaishouScriptPath('unknown', {})).toThrow('no script for type');
  });

  it('ZENITHJOY_AGENT_REAL_PUBLISH=true: image path does not contain -dryrun', () => {
    const p = resolveKuaishouScriptPath('image', { ZENITHJOY_AGENT_REAL_PUBLISH: 'true' });
    expect(p).not.toContain('-dryrun');
    expect(p).toContain('kuaishou-image');
  });
});
