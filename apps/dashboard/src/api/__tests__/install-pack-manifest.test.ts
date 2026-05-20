import { describe, it, expect } from 'vitest';
import type { InstallPackManifest } from '../walking-skeleton-1.api';

describe('InstallPackManifest type', () => {
  it('supports optional cos_url field', () => {
    const m: InstallPackManifest = {
      version: '1.1.2',
      sha256: 'abc123',
      download_url: '/download/zenithjoy-agent-v1.1.2.tar.gz',
      size: 169264145,
      build_time: '2026-05-19T07:41:24Z',
      cos_url: 'https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/agent/zenithjoy-agent-v1.1.2.tar.gz',
    };
    expect(m.cos_url).toContain('cos.accelerate.myqcloud.com');
  });

  it('cos_url is optional — manifest without it is valid', () => {
    const m: InstallPackManifest = {
      version: '1.1.2',
      sha256: 'abc123',
      download_url: '/download/zenithjoy-agent-v1.1.2.tar.gz',
      size: 169264145,
      build_time: '2026-05-19T07:41:24Z',
    };
    expect(m.cos_url).toBeUndefined();
  });
});
