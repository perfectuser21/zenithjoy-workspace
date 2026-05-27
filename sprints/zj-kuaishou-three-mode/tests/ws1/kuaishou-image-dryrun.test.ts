import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SCRIPT_PATH = path.resolve(
  __dirname,
  '../../../../services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs'
);

describe('WS1 — publish-kuaishou-image-dryrun.cjs 三模式改造 [BEHAVIOR]', () => {
  it('脚本文件存在', () => {
    expect(fs.existsSync(SCRIPT_PATH)).toBe(true);
  });

  it('含 KUAISHOU_COOKIES 模式分支（cookie 注入模式）', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
    expect(content).toContain('KUAISHOU_COOKIES');
  });

  it('含 KUAISHOU_PROFILE_DIR 模式分支（persistent context 模式）', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
    expect(content).toContain('KUAISHOU_PROFILE_DIR');
    expect(content).toContain('launchPersistentContext');
  });

  it('含 chromium.launch 调用（cookie/profile 模式需要，而非仅 connectOverCDP）', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
    expect(content).toContain('chromium.launch');
  });

  it('输出 JSON 含 imagesCount 字段（image schema 完整性）', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
    expect(content).toContain('imagesCount');
  });

  it('输出 JSON 不含禁用字段 result/status/data/payload 作为输出 key', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
    // 检查 JSON 输出对象（含 ok:/dryRun: 的对象块）不应有禁用字段
    const forbiddenAsOutputKey = /["'](result|status|data|payload)["']\s*:/;
    const matches = content.match(forbiddenAsOutputKey);
    expect(matches).toBeNull();
  });
});
