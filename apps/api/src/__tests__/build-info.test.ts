import { describe, it, expect } from 'vitest';
import { getBuildInfo } from '../build-info';
import type { BuildInfo } from '../build-info';

describe('build-info — 发版"真上新代码"探针', () => {
  it('env BUILD_SHA/VERSION/TIME 优先（最权威来源）', () => {
    const info = getBuildInfo(
      { BUILD_SHA: 'abc1234', BUILD_VERSION: '1.2.3', BUILD_TIME: '2026-06-22T00:00:00Z' },
      () => ({ sha: 'fileSha', version: '9.9.9', buildTime: 'fileTime' }),
    );
    expect(info.sha).toBe('abc1234');
    expect(info.version).toBe('1.2.3');
    expect(info.buildTime).toBe('2026-06-22T00:00:00Z');
  });

  it('env 缺失时回落到 build-info.json', () => {
    const info = getBuildInfo(
      {},
      () => ({ sha: 'fileSha', version: '9.9.9', buildTime: 'fileTime' }),
    );
    expect(info.sha).toBe('fileSha');
    expect(info.version).toBe('9.9.9');
    expect(info.buildTime).toBe('fileTime');
  });

  it('env 与 file 都没有 → unknown 兜底，不抛错', () => {
    const info = getBuildInfo({}, () => null);
    expect(info.sha).toBe('unknown');
    expect(info.version).toBe('unknown');
    expect(info.buildTime).toBe('unknown');
  });

  it('空字符串 env 视为缺失，回落 file', () => {
    const info = getBuildInfo(
      { BUILD_SHA: '   ', BUILD_VERSION: '' },
      () => ({ sha: 'fileSha', version: '9.9.9' }),
    );
    expect(info.sha).toBe('fileSha');
    expect(info.version).toBe('9.9.9');
  });

  it('fileReader 抛错（坏 JSON / 读不到）→ 不崩，走 env 或 unknown', () => {
    const info = getBuildInfo(
      { BUILD_SHA: 'fromEnv' },
      () => {
        throw new Error('bad json');
      },
    );
    expect(info.sha).toBe('fromEnv');
    expect(info.version).toBe('unknown');
  });

  it('部分字段：env 给 sha，file 给 version，混合取', () => {
    const partial: Partial<BuildInfo> = { version: '2.0.0' };
    const info = getBuildInfo({ BUILD_SHA: 'envSha' }, () => partial);
    expect(info.sha).toBe('envSha');
    expect(info.version).toBe('2.0.0');
    expect(info.buildTime).toBe('unknown');
  });

  it('sha 首尾空白被 trim', () => {
    const info = getBuildInfo({ BUILD_SHA: '  deadbeef  ' }, () => null);
    expect(info.sha).toBe('deadbeef');
  });
});
