import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('appendListenChatLog [BEHAVIOR]', () => {
  let tmpDir: string;
  let origAppData: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-agent-log-test-'));
    origAppData = process.env.APPDATA;
    process.env.APPDATA = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (origAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = origAppData;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('写入 chunk 后日志文件包含该内容', async () => {
    const { appendListenChatLog } = await import('../wechat-rpa');
    appendListenChatLog('[desktop_lease] acquire granted lease_id=test-001\n');

    const logFile = path.join(tmpDir, 'zenithjoy-agent', 'logs', 'listen-chat.log');
    expect(fs.existsSync(logFile)).toBe(true);
    const content = fs.readFileSync(logFile, 'utf-8');
    expect(content).toContain('[desktop_lease] acquire granted lease_id=test-001');
  });

  it('超过轮转阈值 → 旧内容进 .old，新内容进新文件', async () => {
    const { appendListenChatLog } = await import('../wechat-rpa');
    const logDir = path.join(tmpDir, 'zenithjoy-agent', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'listen-chat.log');
    fs.writeFileSync(logFile, 'OLD_CONTENT_MARKER'.repeat(10));

    appendListenChatLog('NEW_LINE_AFTER_ROTATE\n', { maxBytes: 50 });

    const oldFile = path.join(logDir, 'listen-chat.log.old');
    expect(fs.existsSync(oldFile)).toBe(true);
    expect(fs.readFileSync(oldFile, 'utf-8')).toContain('OLD_CONTENT_MARKER');

    const newContent = fs.readFileSync(logFile, 'utf-8');
    expect(newContent).toContain('NEW_LINE_AFTER_ROTATE');
    expect(newContent).not.toContain('OLD_CONTENT_MARKER');
  });

  it('写入失败（mock fs.appendFileSync 抛异常）不向上抛出', async () => {
    const { appendListenChatLog } = await import('../wechat-rpa');
    const spy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    expect(() => appendListenChatLog('irrelevant\n')).not.toThrow();

    spy.mockRestore();
  });
});
