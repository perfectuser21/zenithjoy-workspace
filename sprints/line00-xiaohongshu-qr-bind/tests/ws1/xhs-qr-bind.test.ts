// TDD Red 测试 — 修复前失败，修复后通过
// sprint: line00-xiaohongshu-qr-bind

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

// worktree root = 4 levels up from tests/ws1/
const REPO = path.resolve(__dirname, '../../../../');
const TS_FILE = path.join(REPO, 'services/agent/src/handlers/qr-bind-operator.ts');
const CJS_FILE = path.join(REPO, 'services/agent/publishers/qr-bind-operator.cjs');

describe('xiaohongshu qr-bind cookie 名修复', () => {
  it('[RED] .ts: xiaohongshu 应含 galaxy_creator_session_info，不含 webId', () => {
    const src = fs.readFileSync(TS_FILE, 'utf-8');
    const xhsLine = src.split('\n').find(
      (l) => l.includes('xiaohongshu') && l.includes('web_session'),
    );
    expect(xhsLine).toBeDefined();
    expect(xhsLine).toContain('galaxy_creator_session_info');
    expect(xhsLine).not.toContain('webId');
  });

  it('[RED] .cjs: xiaohongshu 应含 galaxy_creator_session_info，不含 webId', () => {
    const src = fs.readFileSync(CJS_FILE, 'utf-8');
    const xhsLine = src.split('\n').find(
      (l) => l.includes('xiaohongshu') && l.includes('web_session'),
    );
    expect(xhsLine).toBeDefined();
    expect(xhsLine).toContain('galaxy_creator_session_info');
    expect(xhsLine).not.toContain('webId');
  });
});

describe('xiaohongshu CDP 端口注入修复', () => {
  it('[RED] .ts: spawnQrBindOperator 应注入 ZENITHJOY_CHROME_DEBUG_PORT=19224', () => {
    const src = fs.readFileSync(TS_FILE, 'utf-8');
    expect(src).toMatch(/19224/);
    expect(src).toContain('ZENITHJOY_CHROME_DEBUG_PORT');
  });

  it('[REGRESSION] 抖音默认端口 19222 不受影响', () => {
    const src = fs.readFileSync(TS_FILE, 'utf-8');
    expect(src).toMatch(/19222/);
  });
});
