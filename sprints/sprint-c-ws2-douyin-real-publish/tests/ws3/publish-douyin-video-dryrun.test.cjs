const { describe, it, expect } = require('vitest');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

describe('Workstream 3 — publish-douyin-video-dryrun.cjs spawn 行为 [BEHAVIOR]', () => {
  const scriptPath = path.resolve(__dirname, '../../../../services/agent/publishers/douyin-publisher/publish-douyin-video-dryrun.cjs');

  it('脚本文件存在', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it('dryrun spawn 后 stdout 含 "等待发布按钮" 字样且 exit 0', () => {
    const fixture = '/tmp/sk-fixture.mp4';
    if (!fs.existsSync(fixture)) {
      fs.writeFileSync(fixture, Buffer.alloc(1024));
    }
    const r = spawnSync('node', [scriptPath, '--video', fixture, '--title', 'smoke', '--cookie-skip'], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, ZENITHJOY_AGENT_DRYRUN_BROWSER: 'mock' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/等待发布按钮|wait.*publish.*button/i);
  });

  it('dryrun 永不点最后发布按钮（stdout 不能含 "click publish"）', () => {
    const fixture = '/tmp/sk-fixture.mp4';
    if (!fs.existsSync(fixture)) {
      fs.writeFileSync(fixture, Buffer.alloc(1024));
    }
    const r = spawnSync('node', [scriptPath, '--video', fixture, '--title', 'smoke', '--cookie-skip'], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, ZENITHJOY_AGENT_DRYRUN_BROWSER: 'mock' },
    });
    expect(r.stdout).not.toMatch(/click.*publish-button|点击.*发布/);
  });
});
