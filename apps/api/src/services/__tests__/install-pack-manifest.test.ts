import { describe, it, expect } from 'vitest';
import { readInstallPackManifest } from '../install-pack-manifest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('readInstallPackManifest', () => {
  it('文件不存在 → null', () => {
    const result = readInstallPackManifest('/nonexistent/path/manifest.json');
    expect(result).toBeNull();
  });

  it('合法 manifest → 解析对象', () => {
    const tmpFile = path.join(os.tmpdir(), `manifest-test-${Date.now()}.json`);
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({
        version: '1.0.0',
        sha256: 'a'.repeat(64),
        download_url: '/download/zenithjoy-agent-v1.0.0.tar.gz',
        size: 22637557,
        build_time: '2026-05-09T03:01:22Z',
      })
    );
    try {
      const result = readInstallPackManifest(tmpFile);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('1.0.0');
      expect(result?.sha256).toHaveLength(64);
      expect(result?.download_url).toMatch(/^\/download\//);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('损坏 JSON → null', () => {
    const tmpFile = path.join(os.tmpdir(), `manifest-bad-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, '{not valid json');
    try {
      expect(readInstallPackManifest(tmpFile)).toBeNull();
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('缺字段 → null', () => {
    const tmpFile = path.join(os.tmpdir(), `manifest-missing-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify({ version: '1.0.0' })); // missing sha256/url
    try {
      expect(readInstallPackManifest(tmpFile)).toBeNull();
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
