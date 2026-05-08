/**
 * Path 4 Sprint 1 ws2 — 8 个飞书 fixture script `--help` 契约测试。
 *
 * 全部脚本必须支持 `--help`，输出含 `Usage` 字样（验收命令的硬阈值）。
 *
 * Scripts:
 *   seed-feishu-customer.js
 *   seed-feishu-profile.js
 *   seed-feishu-schedule.js
 *   update-feishu-schedule.js
 *   count-feishu-interaction.js
 *   count-feishu-schedule.js
 *   get-feishu-interaction.js
 *   get-feishu-schedule.js
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'apps', 'api', 'scripts');

const SCRIPTS = [
  'seed-feishu-customer.js',
  'seed-feishu-profile.js',
  'seed-feishu-schedule.js',
  'update-feishu-schedule.js',
  'count-feishu-interaction.js',
  'count-feishu-schedule.js',
  'get-feishu-interaction.js',
  'get-feishu-schedule.js',
];

describe('Path 4 ws2 fixture script — 文件存在', () => {
  it.each(SCRIPTS)('apps/api/scripts/%s 存在', (name) => {
    expect(fs.existsSync(path.join(SCRIPTS_DIR, name))).toBe(true);
  });
});

describe('Path 4 ws2 fixture script — node <script> --help 含 Usage', () => {
  it.each(SCRIPTS)('node %s --help 输出含 Usage', (name) => {
    const r = spawnSync('node', [path.join(SCRIPTS_DIR, name), '--help'], {
      encoding: 'utf-8',
      timeout: 8_000,
    });
    expect(r.status).toBe(0);
    const out = (r.stdout || '') + (r.stderr || '');
    expect(out).toMatch(/Usage|usage:/);
  });
});
