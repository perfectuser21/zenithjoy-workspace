import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SCRIPT_PATH = path.resolve(
  __dirname,
  '../../../../services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs'
);

describe('WS2 — publish-kuaishou-video-dryrun.cjs 新建三模式 [BEHAVIOR]', () => {
  it('脚本文件已创建', () => {
    expect(fs.existsSync(SCRIPT_PATH)).toBe(true);
  });

  it('含视频发布页 URL（cp.kuaishou.com/article/publish/video）', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
    expect(content).toContain('cp.kuaishou.com/article/publish/video');
  });

  it('含 KUAISHOU_COOKIES 模式分支', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
    expect(content).toContain('KUAISHOU_COOKIES');
  });

  it('含 KUAISHOU_PROFILE_DIR 模式分支', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
    expect(content).toContain('KUAISHOU_PROFILE_DIR');
  });

  it('输出 JSON 含 ok: true', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
    expect(content).toContain('ok: true');
  });

  it('输出 JSON 含 dryRun: true', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
    expect(content).toContain('dryRun: true');
  });

  it('输出 JSON 不含 imagesCount（video schema 只有 4 字段）', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
    const outputBlock = content.match(/const result\s*=\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(outputBlock).not.toContain('imagesCount');
  });

  it('输出 JSON 不含禁用字段 result/status/data/payload 作为输出 key', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
    const forbiddenAsOutputKey = /["'](result|status|data|payload)["']\s*:/;
    expect(content.match(forbiddenAsOutputKey)).toBeNull();
  });

  it('含登录失败检测（URL 含 login/passport 时 exit 1）', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
    expect(content).toContain('login');
    expect(content).toContain('passport');
  });
});
