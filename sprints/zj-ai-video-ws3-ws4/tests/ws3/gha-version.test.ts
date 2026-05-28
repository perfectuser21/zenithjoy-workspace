import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const GHA_PATH = path.resolve('.github/workflows/agent-e2e-video.yml');
const PKG_PATH = path.resolve('services/agent/package.json');

const GHA_CONTENT = fs.readFileSync(GHA_PATH, 'utf8');
const AGENT_VERSION: string = (JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')) as { version: string }).version;

const DEFAULT_MATCH = GHA_CONTENT.match(/agent_version:[\s\S]*?default:\s*"([^"]+)"/);
const GHA_DEFAULT = DEFAULT_MATCH ? DEFAULT_MATCH[1] : null;

describe('WS3 — GHA workflow default version 对齐 [BEHAVIOR]', () => {
  it('GHA workflow default version 等于 agent package.json version', () => {
    expect(GHA_DEFAULT).toBe(AGENT_VERSION);
  });

  it('GHA workflow default 具体值为 1.1.31', () => {
    expect(GHA_DEFAULT).toBe('1.1.31');
  });

  it('GHA workflow default 不再是旧版 1.1.30', () => {
    expect(GHA_DEFAULT).not.toBe('1.1.30');
  });

  it('GHA workflow 含必要字段 workflow_dispatch / agent_version / default:', () => {
    expect(GHA_CONTENT).toContain('workflow_dispatch');
    expect(GHA_CONTENT).toContain('agent_version');
    expect(GHA_CONTENT).toContain('default:');
  });
});
