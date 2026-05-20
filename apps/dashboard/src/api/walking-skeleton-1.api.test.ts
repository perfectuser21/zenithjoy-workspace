import { describe, it, expect } from 'vitest';
import {
  postAgentHeartbeat,
  getAgentStatus,
  postFolderBind,
  postPublishTask,
  getPublishTask,
  listPublishTasks,
  postQrBind,
  getPlatformSessions,
  getInstallPackManifest,
  getInstallPackDotenv,
} from './walking-skeleton-1.api';
import type { InstallPackManifest } from './walking-skeleton-1.api';

describe('walking-skeleton-1 api client (export sanity)', () => {
  it('exports the 8 public async functions', () => {
    expect(typeof postAgentHeartbeat).toBe('function');
    expect(typeof getAgentStatus).toBe('function');
    expect(typeof postFolderBind).toBe('function');
    expect(typeof postPublishTask).toBe('function');
    expect(typeof getPublishTask).toBe('function');
    expect(typeof listPublishTasks).toBe('function');
    expect(typeof postQrBind).toBe('function');
    expect(typeof getPlatformSessions).toBe('function');
  });

  it('exports getInstallPackManifest + getInstallPackDotenv', () => {
    expect(typeof getInstallPackManifest).toBe('function');
    expect(typeof getInstallPackDotenv).toBe('function');
  });

  it('InstallPackManifest type accepts cos_url optional field', () => {
    const m: InstallPackManifest = {
      version: '1.1.3',
      sha256: 'a'.repeat(64),
      download_url: '/download/zenithjoy-agent-v1.1.3.tar.gz',
      cos_url: 'https://cdn.example.com/zenithjoy-agent-v1.1.3.tar.gz',
      size: 169197376,
      build_time: '2026-05-20T00:00:00Z',
    };
    expect(m.cos_url).toBe('https://cdn.example.com/zenithjoy-agent-v1.1.3.tar.gz');
    const m2: InstallPackManifest = {
      version: '1.1.3',
      sha256: 'a'.repeat(64),
      download_url: '/download/zenithjoy-agent-v1.1.3.tar.gz',
      size: 169197376,
      build_time: '2026-05-20T00:00:00Z',
    };
    expect(m2.cos_url).toBeUndefined();
  });
});
