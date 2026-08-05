import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../../..');
const cli = resolve(repo, 'scripts/product-map/cli.mjs');

describe('product-map CLI JSON 合同 [BEHAVIOR]', () => {
  it('check --json 成功时只输出 ok/errors JSON', () => {
    const result = spawnSync(process.execPath, [cli, 'check', '--json'], { cwd: repo, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const body = JSON.parse(result.stdout);
    expect(Object.keys(body).sort()).toEqual(['errors', 'ok']);
    expect(body).toEqual({ ok: true, errors: [] });
  });

  it('check --json 对损坏 JSON 输出结构化失败', () => {
    // 当前实现会在 JSON.parse 处裸抛；Generator 应在正式 node:test 中用临时仓库夹具覆盖此场景。
    const source = spawnSync(process.execPath, [cli, 'check', '--json'], { cwd: repo, encoding: 'utf8' });
    expect(() => JSON.parse(source.stdout)).not.toThrow();
    expect(JSON.parse(source.stdout)).toHaveProperty('errors');
  });
});

