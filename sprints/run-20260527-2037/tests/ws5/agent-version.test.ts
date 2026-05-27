import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

describe('WS5 — Agent v1.1.30 + GHA workflow 更新 [BEHAVIOR]', () => {
  it('services/agent/package.json version = "1.1.30"', () => {
    const pkg = JSON.parse(fs.readFileSync('services/agent/package.json', 'utf8'));
    expect(pkg.version).toBe('1.1.30');
  });

  it('agent-e2e-video.yml 默认版本含 1.1.30', () => {
    const yml = fs.readFileSync('.github/workflows/agent-e2e-video.yml', 'utf8');
    expect(yml).toContain('1.1.30');
  });

  it('agent-e2e-video.yml 默认版本不再是 1.1.29', () => {
    const yml = fs.readFileSync('.github/workflows/agent-e2e-video.yml', 'utf8');
    expect(yml).not.toMatch(/default:\s*["']?1\.1\.29["']?/);
  });

  it('package.json version 是 string 类型', () => {
    const pkg = JSON.parse(fs.readFileSync('services/agent/package.json', 'utf8'));
    expect(typeof pkg.version).toBe('string');
  });
});
